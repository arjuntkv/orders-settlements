import bcrypt from 'bcryptjs';
import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/user.js';
import { Order } from '../models/order.js';
import { Payment } from '../models/payment.js';
import { AuditLog } from '../models/audit-log.js';
import { recordPayment } from '../services/record-payment.js';
import { recordRefund } from '../services/record-refund.js';
import { Refund } from '../models/refund.js';
import { computeOrderTotals } from '@orders/core';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'demo12345';

const config = loadConfig();
await connectDb(config.MONGO_URL);

const existing = await User.findOne({ email: DEMO_EMAIL });
if (existing) {
  const orderIds = (await Order.find({ userId: existing._id }).select('_id')).map((o) => o._id);
  await Payment.deleteMany({ orderId: { $in: orderIds } });
  await Refund.deleteMany({ orderId: { $in: orderIds } });
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
  refundsCents: number[] = [],
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
      date: iso(-2),
    });
  }
  for (const amountCents of refundsCents) {
    await recordRefund({
      userId: user._id.toString(),
      orderId: order._id,
      amountCents,
      date: iso(-1),
      note: 'partial return',
    });
  }
  return order;
}

// one order per dashboard state a reviewer should see, plus refund history
await seedOrder('Falcon Logistics FZ-LLC', 21, [
  { description: 'Fleet tracking platform license', quantity: 12, unitPriceCents: 25000 },
  { description: 'Driver onboarding', quantity: 40, unitPriceCents: 4500 },
]);
await seedOrder(
  'Qamar Tech Solutions FZE',
  7,
  [
    { description: 'API integration sprint', quantity: 2, unitPriceCents: 600000 },
    { description: 'Code review retainer', quantity: 1, unitPriceCents: 150000 },
  ],
  [500000],
);
// was overdue, then settled in full — shows paid wins over overdue
await seedOrder(
  'Zafran Foods Trading LLC',
  -12,
  [{ description: 'Cold-chain compliance audit', quantity: 3, unitPriceCents: 120000 }],
  [360000],
);
await seedOrder(
  'Serai Hospitality Group',
  -5,
  [
    { description: 'Booking engine setup', quantity: 1, unitPriceCents: 850000 },
    { description: 'Staff training session', quantity: 6, unitPriceCents: 30000 },
  ],
  [400000],
);
await seedOrder('Northline Freight LLC', -2, [
  { description: 'Customs clearance batch', quantity: 15, unitPriceCents: 22000 },
]);
await seedOrder(
  'Pearl District Realty',
  14,
  [
    { description: 'CRM migration', quantity: 1, unitPriceCents: 720000 },
    { description: 'Data cleanup', quantity: 20, unitPriceCents: 8500 },
  ],
  [890000],
);
await seedOrder(
  'Harbor Lane Interiors',
  30,
  [{ description: 'Showroom fit-out consultation', quantity: 5, unitPriceCents: 90000 }],
  [200000],
  [50000],
);
// paid then fully refunded: net zero, order unlocked again
await seedOrder(
  'Atlas Marine Services DMCC',
  3,
  [{ description: 'Vessel inspection', quantity: 2, unitPriceCents: 175000 }],
  [350000],
  [350000],
);

console.log(
  `Seeded ${DEMO_EMAIL} / ${DEMO_PASSWORD}: 8 orders covering pending, partially paid, paid, overdue, overdue-then-paid, and refund histories`,
);
await disconnectDb();
