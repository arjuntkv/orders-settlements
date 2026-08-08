import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrder, resetDb, signupAndGetCookie, startTestApp, stopTestApp } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp(app);
});

beforeEach(async () => {
  await resetDb();
});

describe('auth and tenant isolation', () => {
  it('signs up, reads /auth/me, and scopes data per user', async () => {
    const alice = await signupAndGetCookie(app, 'alice@example.com');
    const bob = await signupAndGetCookie(app, 'bob@example.com');

    const me = await app.inject({ method: 'GET', url: '/auth/me', cookies: { token: alice } });
    expect(me.json().email).toBe('alice@example.com');

    const order = await createOrder(app, alice);

    // bob cannot see or pay alice's order — 404, not 403, to avoid leaking existence
    const asBob = await app.inject({ method: 'GET', url: `/orders/${order.id}`, cookies: { token: bob } });
    expect(asBob.statusCode).toBe(404);
    const payAsBob = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token: bob },
      payload: { amountCents: 100, date: '2026-08-08' },
    });
    expect(payAsBob.statusCode).toBe(404);

    const list = await app.inject({ method: 'GET', url: '/orders', cookies: { token: bob } });
    expect(list.json().orders).toHaveLength(0);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await app.inject({ method: 'GET', url: '/orders' });
    expect(res.statusCode).toBe(401);
  });
});

describe('assignment sample scenario', () => {
  it('runs the full $1,000 flow from the spec', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token); // 2 x $500
    expect(order.totalCents).toBe(100000);
    expect(order.paymentStatus).toBe('pending');

    const pay1 = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 40000, date: '2026-08-08' },
    });
    expect(pay1.statusCode).toBe(201);
    expect(pay1.json().order.paymentStatus).toBe('partially_paid');
    expect(pay1.json().order.amountDueCents).toBe(60000);

    const pay2 = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 60000, date: '2026-08-08' },
    });
    expect(pay2.json().order.paymentStatus).toBe('paid');
    expect(pay2.json().order.amountDueCents).toBe(0);

    const pay3 = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 100, date: '2026-08-08' },
    });
    expect(pay3.statusCode).toBe(422);
    expect(pay3.json().code).toBe('OVERPAYMENT');
    expect(pay3.json().details.maxAllowedCents).toBe(0);
  });

  it('reports the maximum allowed amount on partial overpayment', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);
    await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 40000, date: '2026-08-08' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 60001, date: '2026-08-08' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().details.maxAllowedCents).toBe(60000);
    expect(res.json().message).toContain('$600.00');
  });
});

describe('order lifecycle', () => {
  it('locks edits and deletes after the first payment', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);

    const patchBody = {
      customer: 'Changed',
      dueDate: '2099-02-01',
      lineItems: [{ description: 'X', quantity: 1, unitPriceCents: 100 }],
    };
    const patchBefore = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}`,
      cookies: { token },
      payload: patchBody,
    });
    expect(patchBefore.statusCode).toBe(200);
    expect(patchBefore.json().order.totalCents).toBe(100);

    await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 50, date: '2026-08-08' },
    });

    const patchAfter = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}`,
      cookies: { token },
      payload: patchBody,
    });
    expect(patchAfter.statusCode).toBe(409);
    expect(patchAfter.json().code).toBe('ORDER_LOCKED');

    const del = await app.inject({ method: 'DELETE', url: `/orders/${order.id}`, cookies: { token } });
    expect(del.statusCode).toBe(409);
  });

  it('derives overdue at read time and filters on it', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    await createOrder(app, token, { dueDate: '2020-01-01' });
    await createOrder(app, token, { dueDate: '2099-01-01' });

    const overdue = await app.inject({ method: 'GET', url: '/orders?status=overdue', cookies: { token } });
    expect(overdue.json().orders).toHaveLength(1);
    expect(overdue.json().orders[0].displayStatus).toBe('overdue');

    // paying the overdue order makes it paid, not overdue
    const id = overdue.json().orders[0].id;
    await app.inject({
      method: 'POST',
      url: `/orders/${id}/payments`,
      cookies: { token },
      payload: { amountCents: 100000, date: '2026-08-08' },
    });
    const after = await app.inject({ method: 'GET', url: '/orders?status=overdue', cookies: { token } });
    expect(after.json().orders).toHaveLength(0);
  });
});

describe('due date changes', () => {
  it('allows due date edits after partial payment, audited, while amounts stay locked', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);
    await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 40000, date: '2026-08-08' },
    });

    const change = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}/due-date`,
      cookies: { token },
      payload: { dueDate: '2099-06-01' },
    });
    expect(change.statusCode).toBe(200);
    expect(change.json().order.dueDate).toBe('2099-06-01');

    // the body lock is untouched: generic PATCH still rejected
    const patch = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}`,
      cookies: { token },
      payload: {
        customer: 'X',
        dueDate: '2099-06-01',
        lineItems: [{ description: 'X', quantity: 1, unitPriceCents: 1 }],
      },
    });
    expect(patch.statusCode).toBe(409);

    const audit = await app.inject({ method: 'GET', url: `/orders/${order.id}/audit`, cookies: { token } });
    const entry = audit.json().entries.find((e: { event: string }) => e.event === 'due_date_changed');
    expect(entry.before.dueDate).toBe('2099-01-01');
    expect(entry.after.dueDate).toBe('2099-06-01');
  });

  it('recomputes overdue immediately and skips audit on a no-op change', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);

    // moving the due date into the past flips derived status to overdue
    const toPast = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}/due-date`,
      cookies: { token },
      payload: { dueDate: '2020-01-01' },
    });
    expect(toPast.json().order.displayStatus).toBe('overdue');

    const noop = await app.inject({
      method: 'PATCH',
      url: `/orders/${order.id}/due-date`,
      cookies: { token },
      payload: { dueDate: '2020-01-01' },
    });
    expect(noop.statusCode).toBe(200);
    const audit = await app.inject({ method: 'GET', url: `/orders/${order.id}/audit`, cookies: { token } });
    const entries = audit.json().entries.filter((e: { event: string }) => e.event === 'due_date_changed');
    expect(entries).toHaveLength(1);
  });
});

describe('idempotency', () => {
  it('replays instead of double-recording on the same key', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);

    const inject = () =>
      app.inject({
        method: 'POST',
        url: `/orders/${order.id}/payments`,
        cookies: { token },
        headers: { 'idempotency-key': 'retry-123' },
        payload: { amountCents: 40000, date: '2026-08-08' },
      });

    const first = await inject();
    const second = await inject();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().payment.id).toBe(first.json().payment.id);
    expect(second.json().order.amountPaidCents).toBe(40000);

    const history = await app.inject({ method: 'GET', url: `/orders/${order.id}/payments`, cookies: { token } });
    expect(history.json().payments).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('never overshoots the total when parallel payments race', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token); // $1,000

    // 10 x $300 fired concurrently: at most 3 can fit into $1,000
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: `/orders/${order.id}/payments`,
          cookies: { token },
          payload: { amountCents: 30000, date: '2026-08-08' },
        }),
      ),
    );

    const succeeded = results.filter((r) => r.statusCode === 201);
    const rejected = results.filter((r) => r.statusCode === 422);
    expect(succeeded).toHaveLength(3);
    expect(rejected).toHaveLength(7);

    const final = await app.inject({ method: 'GET', url: `/orders/${order.id}`, cookies: { token } });
    expect(final.json().order.amountPaidCents).toBe(90000);
    expect(final.json().order.paymentStatus).toBe('partially_paid');

    const history = await app.inject({ method: 'GET', url: `/orders/${order.id}/payments`, cookies: { token } });
    expect(history.json().payments).toHaveLength(3);
  });
});

describe('audit log', () => {
  it('appends before/after for every recorded payment', async () => {
    const token = await signupAndGetCookie(app, 'user@example.com');
    const order = await createOrder(app, token);
    await app.inject({
      method: 'POST',
      url: `/orders/${order.id}/payments`,
      cookies: { token },
      payload: { amountCents: 100000, date: '2026-08-08' },
    });
    const audit = await app.inject({ method: 'GET', url: `/orders/${order.id}/audit`, cookies: { token } });
    const entries = audit.json().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].event).toBe('payment_recorded');
    expect(entries[0].before.paymentStatus).toBe('pending');
    expect(entries[0].after.paymentStatus).toBe('paid');
  });
});
