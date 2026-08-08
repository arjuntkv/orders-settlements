# Orders & Settlements

Small B2B-style app: create orders with line items, record full or partial payments against them, and track status (`pending` / `partially_paid` / `paid` / `overdue`) on a dashboard.

**Live demo:** https://orders-web-omed.onrender.com
Demo login: `demo@example.com` / `demo12345` — or sign up with any email.
*Hosted on free tiers: the first request after ~15 minutes of idle cold-starts in roughly a minute; subsequent requests are instant.*

Built as a take-home assignment. The interesting parts are the payment write path (transactional, race-safe, idempotent), the derived-status model, and the index design — details below.

## Stack

- **API** — Node.js, TypeScript, Fastify, Mongoose, Zod
- **DB** — MongoDB (single-node replica set locally; transactions need a replset)
- **Web** — Next.js (App Router), React, Tailwind
- **Shared** — `packages/core`: pure domain logic + DTO types used by both apps
- **Tests** — Vitest; API tests run against a real in-memory MongoDB replica set

```
apps/web  (Next.js, :3000) ──HTTP, JWT cookie──▶ apps/api (Fastify, :4000) ──txn──▶ MongoDB
                                                    │
                              routes ─▶ services ─▶ models
                                    │
                        packages/core (pure functions:
                        money, totals, status, payment rules)
```

## Quickstart

Prereqs: Docker with compose.

```sh
docker compose up -d          # mongo + api + web
```

Then open http://localhost:3000 and sign up, or seed demo data:

```sh
# from the repo root, with node 20+ and pnpm installed:
pnpm install
JWT_SECRET=$(openssl rand -hex 32) pnpm --filter @orders/api seed
# login: demo@example.com / demo12345
```

### Local development (hot reload)

```sh
docker compose up -d mongo
pnpm install
pnpm --filter @orders/core build
cp apps/api/.env.example apps/api/.env   # fill JWT_SECRET (openssl rand -hex 32)
pnpm --filter @orders/api dev            # :4000
pnpm --filter @orders/web dev            # :3000
```

### Tests

```sh
pnpm test        # domain unit tests + API integration tests
```

The API suite spins up a real MongoDB replica set in memory (first run downloads a mongod binary). It covers tenant isolation, the full sample scenario from the spec, lifecycle locking, idempotent replay, and a genuine concurrency race: 10 parallel $300 payments against a $1,000 order — exactly 3 must land.

## API overview

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` `/auth/login` `/auth/logout` | JWT in an httpOnly cookie |
| GET | `/auth/me` | |
| GET | `/orders?status=` | `pending`, `partially_paid`, `paid`, or `overdue` |
| POST | `/orders` | totals computed server-side |
| GET/PATCH/DELETE | `/orders/:id` | PATCH/DELETE rejected with `409 ORDER_LOCKED` once a payment exists |
| PATCH | `/orders/:id/due-date` | allowed in any payment state; audit-logged |
| POST | `/orders/:id/payments` | supports `Idempotency-Key` header; `422 OVERPAYMENT` includes `maxAllowedCents` |
| GET | `/orders/:id/payments` | payment history |
| POST | `/orders/:id/refunds` | reversal entry, same idempotency + concurrency guarantees; `422 REFUND_EXCEEDS_PAID` includes `maxRefundableCents` |
| GET | `/orders/:id/refunds` | refund history |
| GET | `/orders/:id/audit` | append-only audit trail |
| GET | `/orders/export?from=&to=` | CSV download, filtered by due date range, streamed from a cursor |

Errors are always `{ code, message, details? }` with actionable messages — an over-payment tells you the maximum you can still record.

## Design notes

### Money

All amounts are **integer cents** end to end — request bodies, database, arithmetic. Floats exist only at the UI edge (`parseMoneyToCents` / `formatCents` in `packages/core`). Quantities are integers ≥ 1; fractional quantities would force a rounding policy on `qty × unitPrice`, so they're deliberately out of scope (documented tradeoff, easy to add with a stated policy).

### Status

`pending` / `partially_paid` / `paid` is **stored** and only ever changed inside the payment transaction. `overdue` is **derived at read time** (`dueDate < today && not paid`) because it changes with the clock — a stored copy goes stale at midnight. The dashboard's overdue filter is expressed in stored fields (`paymentStatus ∈ {pending, partially_paid} AND dueDate < today`) so it still uses an index.

Edge case from the spec: an order that was overdue and is then fully paid shows `paid`, not `overdue` — overdue is a lens on unpaid orders, not a historical fact.

Due dates are calendar dates (`YYYY-MM-DD` strings), not instants: "due Aug 15" means the same thing in every timezone, and lexicographic order equals chronological order, so range queries are plain string compares.

### Concurrency (the over-payment guard)

Two $600 payments racing on a $1,000 order must not both land. The guard is a **conditional atomic update** — not an application-level check:

```ts
Order.findOneAndUpdate(
  { _id, userId, $expr: { $lte: [{ $add: ['$amountPaidCents', amountCents] }, '$totalCents'] } },
  { $inc: { amountPaidCents: amountCents } },
  { new: true, session },
)
```

The increment applies only if it still fits; the loser of the race gets `null` back and a 422. The whole write path (order update + payment insert + audit entry) runs in a **multi-document transaction**, and `withTransaction` retries transient write conflicts. A read-then-write check alone would have a TOCTOU window; the conditional update closes it regardless of how many API instances are running.

Verified two ways: an integration test (10 parallel payments) and the benchmark harness (50 parallel payments, invariant asserted).

### Idempotency

`POST /orders/:id/payments` accepts an `Idempotency-Key` header. A retried request (timeout, double-click, network blip) returns the **original** payment with `200` + `replayed: true` instead of double-charging. Enforced by a unique partial index on `(orderId, idempotencyKey)` — the pre-check is a fast path, the index is the guarantee. The web payment form generates one UUID per form fill.

### Lifecycle

Orders are **editable while the net amount paid is zero, read-only otherwise** (including delete). The spec allows either choice; this one keeps the paid amount and the order total from drifting apart — editing a $1,000 order down to $500 after a $700 payment has no sane answer. A fully refunded order (net paid back to zero) becomes editable again: the money invariant `paid ≤ total` can't be violated from that state. The lock is enforced atomically (the `amountPaidCents: 0` condition is part of the update filter), so an edit racing a first payment can't slip through. Corrections are modeled the way accounting systems do it: a new correcting order (refund entities would be the production version).

The **due date is exempt** from the lock: it's a commercial term (renegotiating payment terms on a partially paid invoice is routine AR — Stripe and Xero both allow it), not a monetary fact. It has its own endpoint so the body-lock rule stays absolute, and every change writes a `due_date_changed` audit entry with before/after. Because `overdue` is derived, the status recomputes instantly on the next read.

### Refunds

Refunds are **reversal entries, not negative payments**: payments stay immutable, refunds are their own append-only collection, and both sides of the ledger read like a bank statement. Recording one is the mirror image of the payment path — same transaction, same idempotency-key handling, and a conditional decrement (`paid − refund ≥ 0`) so parallel refunds can't take net paid below zero. Status walks back down (`paid → partially_paid → pending`) from the same `derivePaymentStatus` function, and every refund writes a `refund_recorded` audit entry.

### Data model

| Collection | Shape | Why |
|---|---|---|
| `orders` | line items **embedded**, `amountPaidCents` + `paymentStatus` denormalized | line items are always read with the order, bounded (≤100), never queried alone; the denormalized fields are what the guard conditions on and are only written inside the transaction |
| `payments` / `refunds` | **separate** collections | unbounded growth, own history views, immutable entries; unique partial index on `(orderId, idempotencyKey)` |
| `audit_logs` | append-only `{event, before, after, at}` | written in the same transaction as the payment, so the trail can't miss a write |

Indexes on `orders` — every one leads with `userId`, so tenant scoping is never a scan:

| Index | Serves |
|---|---|
| `(userId, createdAt desc)` | unfiltered listing |
| `(userId, paymentStatus, createdAt desc)` | status filter — equality + equality + sort, no blocking sort |
| `(userId, paymentStatus, dueDate)` | overdue filter |

### Security

- bcrypt password hashing; JWT in an **httpOnly, sameSite=lax** cookie (not readable by JS)
- every query is scoped by `userId` from the verified token; cross-tenant access returns **404, not 403** (no existence leak), covered by tests
- login returns the same error for unknown email and wrong password (no account enumeration)
- config is validated at boot and **fails fast** on a missing/short `JWT_SECRET` — no silent defaults in production

## Benchmarks

Measured on Apple M4, Node 21, MongoDB 7 in Docker. Dataset: 200,000 orders total, 50,000 for the benchmarked user (rest is other-tenant noise to prove scoping doesn't degrade). 100 iterations after warmup.

| Query | p50 | p95 | keys examined | docs examined |
|---|---|---|---|---|
| list all (limit 200) | 1.5 ms | 2.4 ms | 200 | 200 |
| filter status=pending | 1.6 ms | 2.4 ms | 200 | 200 |
| filter status=overdue | 1.7 ms | 1.9 ms | 604 | 604 |

`keys examined == docs returned` on the first two means the indexes cover the queries exactly. The overdue query examines 3× its result set because `$in` over two statuses fans out and the top-200-by-createdAt sort runs over the matches — fine at this scale, and the fix at larger scale (a computed `isOverdueCandidate` field or a `(userId, dueDate)` index with status filtering) is a known tradeoff, not a surprise.

Payment race: **50 concurrent $300 payments against a $1,000 order → 3 accepted, 47 rejected, final paid exactly $900.00** (~170 ms total including 47 transaction aborts).

Reproduce with:

```sh
MONGO_URL="mongodb://localhost:27017/orders-bench?replicaSet=rs0&directConnection=true" \
JWT_SECRET=$(openssl rand -hex 32) pnpm --filter @orders/api exec tsx src/scripts/bench.ts
```

## Scaling to production

What changes as this grows, in order:

1. **Payments hot-spotting.** One order = one document = one lock. Payments against *different* orders never contend, so throughput scales with order cardinality. A single order absorbing thousands of concurrent payments (not a realistic B2B pattern) would need a different design — payment intents + async settlement.
2. **Read scale.** Dashboard reads can move to secondaries (`readPreference=secondaryPreferred`) — the denormalized `amountPaidCents` makes eventual reads harmless for lists; the detail page and payment path stay on the primary.
3. **Listing pagination.** The 200-row cap becomes cursor pagination on `(createdAt, _id)` — the indexes already support it.
4. **Idempotency store.** If payment recording moves behind a queue or webhook ingestion, the idempotency key store gets a TTL and moves ahead of the queue, not inside the transaction.
5. **Ops.** Health checks already exist; add structured log shipping, alarms on p95 and transaction-abort rate, backups with tested restore (Atlas handles PITR), and rate limiting on auth endpoints.

## Deployment

Deployed at **https://orders-web-omed.onrender.com** — web and API as Docker services on Render (via the `render.yaml` Blueprint), MongoDB on Atlas (free M0 replica set).

The browser only ever talks to the web app: Next.js proxies `/api/*` to the API server-side (`apps/web/next.config.ts`). That keeps the auth cookie first-party (`sameSite=lax` works with no cross-site exceptions), removes CORS from production entirely, and means one public URL. With `output: 'standalone'` the rewrite target is baked at build time, so it's a Docker build arg (`API_PROXY_TARGET`).

`render.yaml` is a Render Blueprint that creates both services (Docker, free plan, health check wired). The click-path: push to GitHub → Render → New → Blueprint → select the repo → enter `MONGO_URL` and `JWT_SECRET` when prompted → after `orders-api` is live, set `API_PROXY_TARGET` on `orders-web` to its URL and redeploy.

The stack is a stateless API container + a Next container + MongoDB, so any container platform works:

- **DB**: MongoDB Atlas (free M0 works) — a real replica set, so transactions work with no local-dev workarounds. Create a database user with `readWrite` on the app database only (not a cluster-admin user), and set `MONGO_URL` to the `mongodb+srv://` string. The same URL works for local dev too — the bundled Docker mongo is a convenience, not a requirement.
- **API**: deploy `apps/api/Dockerfile` (build context = repo root) with `MONGO_URL`, `JWT_SECRET`, `CORS_ORIGIN` set from the platform's secret store. Works as-is on Render, Railway, Fly, or AWS App Runner via ECR.
- **Web**: deploy `apps/web/Dockerfile` with the `API_PROXY_TARGET` build arg pointing at the API service's URL — or skip Docker and put it on Vercel (root directory `apps/web`, build command `pnpm --filter @orders/core build && next build`, `API_PROXY_TARGET` env var). The API stays a long-running server either way; it isn't shaped for serverless.

## Assumptions & tradeoffs

- Currency is a display concern (`USD` formatting); amounts are currency-agnostic integers. Multi-currency would add a `currency` field per order and forbid mixing.
- Customer is a plain string per the spec — no customer entity.
- Payments are strictly positive and capped at the amount due; refunds are strictly positive and capped at net paid. Nothing in the ledger is ever mutated or deleted.
- CSV export ranges filter on the **due date** — "orders due in a period" is the question a finance user asks of that report.
- Payment `date` is caller-supplied (back-dating a bank settlement is legitimate); `createdAt` records when it was entered — the audit log keeps both honest.
- Sessions are stateless JWTs (7-day expiry). Revocation before expiry would need a denylist or short-lived tokens + refresh.

## What I'd improve before production

- Refresh-token rotation and rate limiting on `/auth/*`
- Credit notes and cross-order payment allocation (the step beyond simple refunds)
- Cursor pagination and order search
- OpenAPI spec generated from the Zod schemas (single source of truth)
- CI: lint + typecheck + tests on PR, image build on main
- Metrics (request latency, transaction abort rate) and alerting
