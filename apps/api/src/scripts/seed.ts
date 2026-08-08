import bcrypt from 'bcryptjs';
import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/user.js';
import { Order } from '../models/order.js';
import { Payment } from '../models/payment.js';
import { AuditLog } from '../models/audit-log.js';
import { recordPayment } from '../services/record-payment.js';
import { computeOrderTotals } from '@orders/core';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo12345';

const config = loadConfig();
await connectDb(config.MONGO_URL);

const existing = await User.findOne({ email: DEMO_EMAIL });
if (existing) {
  const orderIds = (await Order.find({ userId: existing._id }).select('_id')).map((o) => o._id);
  await Payment.deleteMany({ orderId: { $in: orderIds } });
  await AuditLog.deleteMany({ orderId: { $in: orderIds } });
  await Order.deleteMany({ userId: existing._id });
  await User.deleteOne({ _id: existing._id });
}

const user = await User.create({
  email: DEMO_EMAIL,
  passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
});

const today = new Date();
const iso = (daysFromNow: number) =>
  new Date(today.getTime() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

async function seedOrder(
  customer: string,
  dueInDays: number,
  lines: { description: string; quantity: number; unitPriceCents: number }[],
  paymentsCents: number[] = [],
) {
  const order = await Order.create({
    userId: user._id,
    customer,
    dueDate: iso(dueInDays),
    lineItems: lines,
    ...computeOrderTotals(lines),
  });
  for (const amountCents of paymentsCents) {
    await recordPayment({
      userId: user._id.toString(),
      orderId: order._id,
      amountCents,
      date: iso(-1),
    });
  }
  return order;
}

await seedOrder('Acme LLC', 7, [{ description: 'Consulting', quantity: 2, unitPriceCents: 50000 }], [40000]);
await seedOrder('Globex FZ-LLC', 14, [
  { description: 'Platform license', quantity: 1, unitPriceCents: 250000 },
  { description: 'Onboarding', quantity: 10, unitPriceCents: 15000 },
]);
await seedOrder('Initech DMCC', -3, [{ description: 'Audit support', quantity: 5, unitPriceCents: 30000 }], [50000]);
await seedOrder(
  'Umbrella Trading',
  -10,
  [{ description: 'Data migration', quantity: 1, unitPriceCents: 80000 }],
  [80000],
);

console.log(`Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD} with 4 orders (partial, pending, overdue, paid)`);
await disconnectDb();
