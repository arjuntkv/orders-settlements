import mongoose from 'mongoose';
import { DomainError, derivePaymentStatus, maxRefundableCents, validateRefundAmount } from '@orders/core';
import { Order, type OrderDoc } from '../models/order.js';
import { Refund, type RefundDoc } from '../models/refund.js';
import { AuditLog } from '../models/audit-log.js';
import { notFound } from '../errors.js';

export interface RecordRefundInput {
  userId: string;
  orderId: mongoose.Types.ObjectId;
  amountCents: number;
  date: string;
  note?: string;
  idempotencyKey?: string;
}

export interface RecordRefundResult {
  order: OrderDoc;
  refund: RefundDoc;
  replayed: boolean;
}

function refundExceedsError(order: OrderDoc): DomainError {
  const max = maxRefundableCents(order.amountPaidCents);
  return new DomainError(
    'REFUND_EXCEEDS_PAID',
    max === 0
      ? 'Nothing has been paid on this order, so there is nothing to refund'
      : `Refund exceeds the net amount paid. Maximum refundable is $${(max / 100).toFixed(2)}`,
    { maxRefundableCents: max },
  );
}

// mirror image of record-payment: the conditional decrement makes
// over-refunding impossible under concurrency, the transaction keeps the
// refund row and audit entry atomic with the order update
export async function recordRefund(input: RecordRefundInput): Promise<RecordRefundResult> {
  const { userId, orderId, amountCents, date, note, idempotencyKey } = input;

  if (idempotencyKey) {
    const existing = await Refund.findOne({ orderId, idempotencyKey });
    if (existing) {
      const order = await Order.findOne({ _id: orderId, userId });
      if (!order) throw notFound('Order');
      return { order, refund: existing, replayed: true };
    }
  }

  const session = await mongoose.startSession();
  try {
    let result: RecordRefundResult | undefined;

    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: orderId, userId }).session(session);
      if (!order) throw notFound('Order');

      validateRefundAmount(amountCents, order.amountPaidCents);

      const before = { amountPaidCents: order.amountPaidCents, paymentStatus: order.paymentStatus };

      const updated = await Order.findOneAndUpdate(
        {
          _id: orderId,
          userId,
          $expr: { $gte: [{ $subtract: ['$amountPaidCents', amountCents] }, 0] },
        },
        { $inc: { amountPaidCents: -amountCents } },
        { new: true, session },
      );
      if (!updated) throw refundExceedsError(order);

      updated.paymentStatus = derivePaymentStatus(updated.totalCents, updated.amountPaidCents);
      await updated.save({ session });

      const [refund] = await Refund.create(
        [{ orderId, userId, amountCents, date, note, idempotencyKey }],
        { session },
      );

      await AuditLog.create(
        [
          {
            userId,
            orderId,
            event: 'refund_recorded',
            before,
            after: {
              amountPaidCents: updated.amountPaidCents,
              paymentStatus: updated.paymentStatus,
              refundId: refund!._id,
              amountCents,
            },
          },
        ],
        { session },
      );

      result = { order: updated, refund: refund!, replayed: false };
    });

    return result!;
  } catch (err: unknown) {
    if (idempotencyKey && typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      const refund = await Refund.findOne({ orderId, idempotencyKey });
      const order = await Order.findOne({ _id: orderId, userId });
      if (refund && order) return { order, refund, replayed: true };
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
