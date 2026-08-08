import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { computeOrderTotals, displayStatus, maxPaymentCents } from '@orders/core';
import { csvLine } from '../csv.js';
import { Order } from '../models/order.js';
import { AuditLog } from '../models/audit-log.js';
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

  app.get('/orders/export', async (req, reply) => {
    const { from, to } = z
      .object({ from: dateSchema.optional(), to: dateSchema.optional() })
      .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'from must be <= to' })
      .parse(req.query);

    // range is on the due date — "orders due in a period" is the business
    // question a finance user asks of this export
    const filter: Record<string, unknown> = { userId: req.userId };
    if (from || to) {
      filter.dueDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
    }

    const today = todayUtc();
    const cursor = Order.find(filter).sort({ dueDate: 1 }).lean().cursor();
    const dollars = (cents: number) => (cents / 100).toFixed(2);

    async function* rows() {
      yield csvLine(['id', 'customer', 'due_date', 'status', 'total', 'amount_paid', 'amount_due', 'created_at']) + '\n';
      for await (const o of cursor) {
        yield csvLine([
          o._id.toString(),
          o.customer,
          o.dueDate,
          displayStatus(o.totalCents, o.amountPaidCents, o.dueDate, today),
          dollars(o.totalCents),
          dollars(o.amountPaidCents),
          dollars(maxPaymentCents(o.totalCents, o.amountPaidCents)),
          o.createdAt.toISOString(),
        ]) + '\n';
      }
    }

    const range = [from && `from-${from}`, to && `to-${to}`].filter(Boolean).join('-');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="orders${range ? `-${range}` : ''}.csv"`)
      .send(Readable.from(rows()));
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
        'Orders are read-only while any net amount is paid. Refund payments first, or record a correcting order.',
      );
    }
    return { order: toOrderDTO(order) };
  });

  // due date is exempt from the payment lock: it's a commercial term
  // (renegotiable, like Stripe/Xero treat it), not a monetary fact. amounts
  // lock at first payment; term changes stay honest via the audit trail.
  app.patch('/orders/:id/due-date', async (req) => {
    const { id } = req.params as { id: string };
    const { dueDate } = z.object({ dueDate: dateSchema }).parse(req.body);
    const orderId = objectId(id, 'Order');

    const session = await mongoose.startSession();
    try {
      let order: InstanceType<typeof Order> | null = null;
      await session.withTransaction(async () => {
        order = await Order.findOne({ _id: orderId, userId: req.userId }).session(session);
        if (!order) throw notFound('Order');
        if (order.dueDate === dueDate) return; // no-op: no write, no audit entry
        const before = order.dueDate;
        order.dueDate = dueDate;
        await order.save({ session });
        await AuditLog.create(
          [
            {
              userId: req.userId,
              orderId,
              event: 'due_date_changed',
              before: { dueDate: before },
              after: { dueDate },
            },
          ],
          { session },
        );
      });
      return { order: toOrderDTO(order!) };
    } finally {
      await session.endSession();
    }
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
