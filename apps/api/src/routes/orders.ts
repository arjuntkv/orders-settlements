import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { computeOrderTotals } from '@orders/core';
import { Order } from '../models/order.js';
import { HttpError, notFound } from '../errors.js';
import { todayUtc, toOrderDTO } from '../serializers.js';

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Not a valid calendar date');

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number(),
  unitPriceCents: z.number(),
});

const orderBodySchema = z.object({
  customer: z.string().trim().min(1).max(200),
  dueDate: dateSchema,
  lineItems: z.array(lineItemSchema).max(100),
});

const listQuerySchema = z.object({
  status: z.enum(['pending', 'partially_paid', 'paid', 'overdue']).optional(),
});

function objectId(id: string, what: string): mongoose.Types.ObjectId {
  if (!mongoose.isValidObjectId(id)) throw notFound(what);
  return new mongoose.Types.ObjectId(id);
}

export async function orderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/orders', async (req) => {
    const { status } = listQuerySchema.parse(req.query);
    const today = todayUtc();
    const filter: Record<string, unknown> = { userId: req.userId };
    if (status === 'overdue') {
      // overdue is derived, so the filter is expressed in stored fields —
      // it still hits the (userId, paymentStatus, dueDate) index
      filter.paymentStatus = { $in: ['pending', 'partially_paid'] };
      filter.dueDate = { $lt: today };
    } else if (status) {
      filter.paymentStatus = status;
    }
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(200);
    return { orders: orders.map((o) => toOrderDTO(o, today)) };
  });

  app.post('/orders', async (req, reply) => {
    const body = orderBodySchema.parse(req.body);
    const totals = computeOrderTotals(body.lineItems);
    const order = await Order.create({ userId: req.userId, ...body, ...totals });
    return reply.status(201).send({ order: toOrderDTO(order) });
  });

  app.get('/orders/:id', async (req) => {
    const { id } = req.params as { id: string };
    const order = await Order.findOne({ _id: objectId(id, 'Order'), userId: req.userId });
    if (!order) throw notFound('Order');
    return { order: toOrderDTO(order) };
  });

  app.patch('/orders/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = orderBodySchema.parse(req.body);
    const totals = computeOrderTotals(body.lineItems);
    // amountPaidCents: 0 in the filter makes "editable until first payment"
    // atomic — a payment landing in parallel can't race this update
    const order = await Order.findOneAndUpdate(
      { _id: objectId(id, 'Order'), userId: req.userId, amountPaidCents: 0 },
      { $set: { ...body, ...totals } },
      { new: true, runValidators: true },
    );
    if (!order) {
      const exists = await Order.exists({ _id: objectId(id, 'Order'), userId: req.userId });
      if (!exists) throw notFound('Order');
      throw new HttpError(
        409,
        'ORDER_LOCKED',
        'Orders with recorded payments are read-only. Delete is also blocked; record a correcting order instead.',
      );
    }
    return { order: toOrderDTO(order) };
  });

  app.delete('/orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const res = await Order.deleteOne({ _id: objectId(id, 'Order'), userId: req.userId, amountPaidCents: 0 });
    if (res.deletedCount === 0) {
      const exists = await Order.exists({ _id: objectId(id, 'Order'), userId: req.userId });
      if (!exists) throw notFound('Order');
      throw new HttpError(409, 'ORDER_LOCKED', 'Orders with recorded payments cannot be deleted');
    }
    return reply.status(204).send();
  });
}
