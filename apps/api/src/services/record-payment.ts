import mongoose from 'mongoose';
import {
  DEFAULT_CURRENCY,
  DomainError,
  derivePaymentStatus,
  maxPaymentCents,
  validatePaymentAmount,
} from '@orders/core';
import { Order, type OrderDoc } from '../models/order.js';
import { Payment, type PaymentDoc } from '../models/payment.js';
import { AuditLog } from '../models/audit-log.js';
import { notFound } from '../errors.js';

export interface RecordPaymentInput {
  userId: string;
  orderId: mongoose.Types.ObjectId;
  amountCents: number;
  date: string;
  note?: string;
  idempotencyKey?: string;
}

export interface RecordPaymentResult {
  order: OrderDoc;
  payment: PaymentDoc;
  replayed: boolean;
}

function overpaymentError(order: OrderDoc): DomainError {
  const max = maxPaymentCents(order.totalCents, order.amountPaidCents);
  // reuse the domain error shape by re-running the validator against a
  // deliberately failing amount is uglier than constructing it here
  return new DomainError(
    'OVERPAYMENT',
    max === 0
      ? 'This order is already fully paid'
      : `Payment exceeds the amount due. Maximum allowed is $${(max / 100).toFixed(2)}`,
    { maxAllowedCents: max },
  );
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const { userId, orderId, amountCents, date, note, idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await Payment.findOne({ orderId, idempotencyKey });
    if (existing) {
      const order = await Order.findOne({ _id: orderId, userId });
      if (!order) throw notFound('Order');
      return { order, payment: existing, replayed: true };
    }
  }

  const session = await mongoose.startSession();
  try {
    let result: RecordPaymentResult | undefined;

    // withTransaction retries on transient write conflicts, which is exactly
    // what happens when two payments hit the same order concurrently
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, userId }).session(session);
      if (!order) throw notFound('Order');

      // friendly pre-check; the conditional update below is the real guard
      validatePaymentAmount(amountCents, order.totalCents, order.amountPaidCents);

      const before = { amountPaidCents: order.amountPaidCents, paymentStatus: order.paymentStatus };

      // the $expr filter makes over-payment impossible even under
      // concurrency: the increment only applies if it still fits
      const updated = await Order.findOneAndUpdate(
        {
          _id: orderId,
          userId,
          $expr: { $lte: [{ $add: ['$amountPaidCents', amountCents] }, '$totalCents'] },
        },
        { $inc: { amountPaidCents: amountCents } },
        { new: true, session },
      );
      if (!updated) throw overpaymentError(order);

      updated.paymentStatus = derivePaymentStatus(updated.totalCents, updated.amountPaidCents);
      await updated.save({ session });

      const [payment] = await Payment.create(
        [{ orderId, userId, amountCents, date, note, idempotencyKey }],
        { session },
      );

      await AuditLog.create(
        [
          {
            userId,
            orderId,
            event: 'payment_recorded',
            currency: DEFAULT_CURRENCY,
            before,
            after: {
              amountPaidCents: updated.amountPaidCents,
              paymentStatus: updated.paymentStatus,
              paymentId: payment!._id,
              amountCents,
            },
          },
        ],
        { session },
      );

      result = { order: updated, payment: payment!, replayed: false };
    });

    return result!;
  } catch (err: unknown) {
    // a concurrent retry with the same idempotency key can slip past the
    // pre-check; the unique index turns that into a replay, not a duplicate
    if (idempotencyKey && typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const payment = await Payment.findOne({ orderId, idempotencyKey });
      const order = await Order.findOne({ _id: orderId, userId });
      if (payment && order) return { order, payment, replayed: true };
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
