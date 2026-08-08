import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { User } from '../src/models/user.js';
import { Order } from '../src/models/order.js';
import { Payment } from '../src/models/payment.js';
import { AuditLog } from '../src/models/audit-log.js';

let replSet: MongoMemoryReplSet;

export async function startTestApp(): Promise<FastifyInstance> {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 't'.repeat(64),
    MONGO_URL: replSet.getUri('orders-test'),
  } as NodeJS.ProcessEnv);
  await connectDb(config.MONGO_URL);
  // unique/partial indexes must exist before tests that rely on them
  await Promise.all([User.init(), Order.init(), Payment.init(), AuditLog.init()]);
  return buildApp(config);
}

export async function stopTestApp(app: FastifyInstance): Promise<void> {
  await app.close();
  await disconnectDb();
  await replSet.stop();
}

export async function resetDb(): Promise<void> {
  await mongoose.connection.db!.dropDatabase();
}

export async function signupAndGetCookie(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'password123' },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'token');
  if (!cookie) throw new Error('no auth cookie set');
  return cookie.value;
}

export async function createOrder(
  app: FastifyInstance,
  token: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    cookies: { token },
    payload: {
      customer: 'Acme LLC',
      dueDate: '2099-01-01',
      lineItems: [{ description: 'Consulting', quantity: 2, unitPriceCents: 50000 }],
      ...overrides,
    },
  });
  if (res.statusCode !== 201) throw new Error(`createOrder failed: ${res.body}`);
  return res.json().order;
}
