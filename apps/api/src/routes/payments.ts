import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Payment } from '../models/payment.js';
import { AuditLog } from '../models/audit-log.js';
import { Order } from '../models/order.js';
import { notFound } from '../errors.js';
import { recordPayment } from '../services/record-payment.js';
import { recordRefund } from '../services/record-refund.js';
import { Refund } from '../models/refund.js';
import { toOrderDTO, toPaymentDTO, toRefundDTO } from '../serializers.js';

const paymentBodySchema = z.object({
  amountCents: z.number().int('Amount must be integer cents').min(1, 'Payment amount must be at least $0.01'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  note: z.string().trim().max(1000).optional(),
});

function objectId(id: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw notFound('Order');
  return new mongoose.Types.ObjectId(id);
}

export async function paymentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/orders/:id/payments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = paymentBodySchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 200);

    const { order, payment, replayed } = await recordPayment({
      userId: req.userId,
      orderId: objectId(id),
      ...body,
      idempotencyKey,
    });

    return reply
      .status(replayed ? 200 : 201)
      .send({ order: toOrderDTO(order), payment: toPaymentDTO(payment), replayed });
  });

  app.get('/orders/:id/payments', async (req) => {
    const { id } = req.params as { id: string };
    const orderId = objectId(id);
    const order = await Order.exists({ _id: orderId, userId: req.userId });
    if (!order) throw notFound('Order');
    const payments = await Payment.find({ orderId }).sort({ createdAt: -1 });
    return { payments: payments.map(toPaymentDTO) };
  });

  app.post('/orders/:id/refunds', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = paymentBodySchema.parse(req.body);
    const idempotencyKey = (req.headers['idempotency-key'] as string | undefined)?.slice(0, 200);

    const { order, refund, replayed } = await recordRefund({
      userId: req.userId,
      orderId: objectId(id),
      ...body,
      idempotencyKey,
    });

    return reply
      .status(replayed ? 200 : 201)
      .send({ order: toOrderDTO(order), refund: toRefundDTO(refund), replayed });
  });

  app.get('/orders/:id/refunds', async (req) => {
    const { id } = req.params as { id: string };
    const orderId = objectId(id);
    const order = await Order.exists({ _id: orderId, userId: req.userId });
    if (!order) throw notFound('Order');
    const refunds = await Refund.find({ orderId }).sort({ createdAt: -1 });
    return { refunds: refunds.map(toRefundDTO) };
  });

  app.get('/orders/:id/audit', async (req) => {
    const { id } = req.params as { id: string };
    const orderId = objectId(id);
    const order = await Order.exists({ _id: orderId, userId: req.userId });
    if (!order) throw notFound('Order');
    const entries = await AuditLog.find({ orderId }).sort({ at: -1 }).limit(200);
    return {
      entries: entries.map((e) => ({
        id: e._id.toString(),
        event: e.event,
        currency: e.currency ?? undefined,
        before: e.before,
        after: e.after,
        at: e.at?.toISOString(),
      })),
    };
  });
}
