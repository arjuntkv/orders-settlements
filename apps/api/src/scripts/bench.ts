import os from 'node:os';
import { performance } from 'node:perf_hooks';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { loadConfig } from '../config.js';
import { connectDb, disconnectDb } from '../db.js';
import { User } from '../models/user.js';
import { Order } from '../models/order.js';
import { Payment } from '../models/payment.js';
import { AuditLog } from '../models/audit-log.js';
import { recordPayment } from '../services/record-payment.js';

// measures the queries the dashboard actually runs, plus the payment race.
// run against a throwaway db:
//   MONGO_URL="mongodb://localhost:27017/orders-bench?replicaSet=rs0&directConnection=true" \
//   JWT_SECRET=$(openssl rand -hex 32) pnpm --filter @orders/api exec tsx src/scripts/bench.ts

const BENCH_ORDERS = 50_000;
const FILLER_ORDERS = 150_000;

const config = loadConfig();
await connectDb(config.MONGO_URL);
// deleteMany instead of dropDatabase: a two-phase replset drop leaves the db
// in DropPending and immediate collection creation fails
await Promise.all([User.init(), Order.init(), Payment.init(), AuditLog.init()]);
await Promise.all([User.deleteMany({}), Order.deleteMany({}), Payment.deleteMany({}), AuditLog.deleteMany({})]);

const passwordHash = await bcrypt.hash('benchmark', 4);
const [benchUser, ...fillers] = await User.create(
  ['bench', 'filler1', 'filler2', 'filler3'].map((n) => ({ email: `${n}@example.com`, passwordHash })),
);

const STATUSES = ['pending', 'partially_paid', 'paid'] as const;
const today = new Date().toISOString().slice(0, 10);

function makeOrders(userId: mongoose.Types.ObjectId, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const totalCents = 10000 + (i % 990) * 100;
    const status = STATUSES[i % 3]!;
    const paid = status === 'paid' ? totalCents : status === 'partially_paid' ? Math.floor(totalCents / 2) : 0;
    const due = new Date(Date.now() + ((i % 120) - 60) * 86_400_000).toISOString().slice(0, 10);
    return {
      userId,
      customer: `Customer ${i}`,
      dueDate: due,
      lineItems: [{ description: 'Item', quantity: 1, unitPriceCents: totalCents }],
      subtotalCents: totalCents,
      totalCents,
      amountPaidCents: paid,
      paymentStatus: status,
    };
  });
}

console.log(`inserting ${BENCH_ORDERS} bench + ${FILLER_ORDERS} filler orders…`);
const t0 = performance.now();
for (const [user, count] of [
  [benchUser!, BENCH_ORDERS],
  ...fillers.map((f) => [f, FILLER_ORDERS / fillers.length] as const),
] as const) {
  const docs = makeOrders(user._id, count);
  for (let i = 0; i < docs.length; i += 10_000) {
    await Order.insertMany(docs.slice(i, i + 10_000), { ordered: false });
  }
}
console.log(`insert took ${((performance.now() - t0) / 1000).toFixed(1)}s`);

async function measure(name: string, fn: () => Promise<unknown>, iterations = 100) {
  for (let i = 0; i < 5; i++) await fn(); // warmup
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p = (q: number) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  return { name, p50: p(0.5), p95: p(0.95) };
}

const uid = benchUser!._id;
const queries = {
  'list all (limit 200)': () => Order.find({ userId: uid }).sort({ createdAt: -1 }).limit(200).lean(),
  'filter status=pending': () =>
    Order.find({ userId: uid, paymentStatus: 'pending' }).sort({ createdAt: -1 }).limit(200).lean(),
  'filter status=overdue': () =>
    Order.find({
      userId: uid,
      paymentStatus: { $in: ['pending', 'partially_paid'] },
      dueDate: { $lt: today },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean(),
};

const rows: { name: string; p50: number; p95: number; keys?: number; docs?: number }[] = [];
for (const [name, fn] of Object.entries(queries)) {
  const row = await measure(name, fn);
  const explain = (await (fn() as ReturnType<typeof Order.find>).explain('executionStats')) as unknown as {
    executionStats: { totalKeysExamined: number; totalDocsExamined: number };
  };
  rows.push({
    ...row,
    keys: explain.executionStats.totalKeysExamined,
    docs: explain.executionStats.totalDocsExamined,
  });
}

// payment race: 50 concurrent $300 payments into a $1,000 order
const raceOrder = await Order.create({
  userId: uid,
  customer: 'Race Co',
  dueDate: today,
  lineItems: [{ description: 'X', quantity: 2, unitPriceCents: 50000 }],
  subtotalCents: 100000,
  totalCents: 100000,
  amountPaidCents: 0,
  paymentStatus: 'pending',
});
const raceStart = performance.now();
const settled = await Promise.allSettled(
  Array.from({ length: 50 }, () =>
    recordPayment({
      userId: uid.toString(),
      orderId: raceOrder._id,
      amountCents: 30000,
      date: today,
    }),
  ),
);
const raceMs = performance.now() - raceStart;
const ok = settled.filter((s) => s.status === 'fulfilled').length;
const finalOrder = await Order.findById(raceOrder._id);

console.log(`\nnode ${process.version}, ${os.cpus()[0]?.model ?? 'unknown cpu'}, mongo in docker`);
console.log(
  `dataset: ${BENCH_ORDERS.toLocaleString()} orders for bench user, ${(FILLER_ORDERS + BENCH_ORDERS).toLocaleString()} total\n`,
);
console.log('| query | p50 ms | p95 ms | keys examined | docs examined |');
console.log('|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.name} | ${r.p50.toFixed(1)} | ${r.p95.toFixed(1)} | ${r.keys} | ${r.docs} |`);
}
console.log(
  `\npayment race: 50 concurrent $300 payments on a $1,000 order -> ` +
    `${ok} accepted, ${50 - ok} rejected, final paid $${(finalOrder!.amountPaidCents / 100).toFixed(2)}, ` +
    `${raceMs.toFixed(0)}ms total`,
);
if (ok !== 3 || finalOrder!.amountPaidCents !== 90000) {
  console.error('RACE INVARIANT VIOLATED');
  process.exitCode = 1;
}

await disconnectDb();
