'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents, parseMoneyToCents, type OrderDTO, type PaymentDTO, type RefundDTO } from '@orders/core';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/use-api';

function DueDate({ order, onSaved }: { order: OrderDTO; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.dueDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/due-date`, {
        method: 'PATCH',
        body: JSON.stringify({ dueDate: value }),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <p className="mb-4 text-sm text-slate-500">
        Due {order.dueDate}{' '}
        <button
          onClick={() => {
            setValue(order.dueDate);
            setEditing(true);
          }}
          className="ml-1 underline hover:text-slate-900"
        >
          change
        </button>
      </p>
    );
  }

  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <input
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 outline-none focus:border-slate-500"
      />
      <button
        onClick={save}
        disabled={busy}
        className="rounded-md bg-slate-900 px-3 py-1 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={() => setEditing(false)} className="text-slate-500 hover:text-slate-900">
        Cancel
      </button>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}

function RefundForm({ order, onRecorded }: { order: OrderDTO; onRecorded: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // one key per attempt-until-success: retries of a failed submit reuse it
  // (that's the point), a NEW submission after success gets a fresh key
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = parseMoneyToCents(amount);
    if (amountCents === null || amountCents < 1) {
      setError('Enter a valid amount like 400 or 400.50');
      return;
    }
    setBusy(true);
    try {
      await api(`/orders/${order.id}/refunds`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ amountCents, date, note: note || undefined }),
      });
      setAmount('');
      setNote('');
      setIdempotencyKey(crypto.randomUUID());
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error, try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Record refund</h2>
      <p className="text-sm text-slate-500">
        Refundable: <span className="font-medium text-slate-900">{formatCents(order.amountPaidCents)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount ($)</span>
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Date</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
      </label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Recording…' : 'Record refund'}
      </button>
    </form>
  );
}

function PaymentForm({ order, onRecorded }: { order: OrderDTO; onRecorded: () => void }) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // one key per attempt-until-success: a double-click or retry records once,
  // but the next intentional payment gets a fresh key
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountCents = parseMoneyToCents(amount);
    if (amountCents === null || amountCents < 1) {
      setError('Enter a valid amount like 400 or 400.50');
      return;
    }
    setBusy(true);
    try {
      await api(`/orders/${order.id}/payments`, {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ amountCents, date, note: note || undefined }),
      });
      setAmount('');
      setNote('');
      setIdempotencyKey(crypto.randomUUID());
      onRecorded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error, try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-medium">Record payment</h2>
      <p className="text-sm text-slate-500">
        Amount due: <span className="font-medium text-slate-900">{formatCents(order.amountDueCents)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Amount ($)</span>
          <input
            required
            inputMode="decimal"
            placeholder="400.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Date</span>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">Note (optional)</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
      </label>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? 'Recording…' : 'Record payment'}
      </button>
    </form>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const orderRes = useApi<{ order: OrderDTO }>(`/orders/${id}`);
  const paymentsRes = useApi<{ payments: PaymentDTO[] }>(`/orders/${id}/payments`);
  const refundsRes = useApi<{ refunds: RefundDTO[] }>(`/orders/${id}/refunds`);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const order = orderRes.data?.order;

  async function remove() {
    if (!confirm('Delete this order?')) return;
    try {
      await api(`/orders/${id}`, { method: 'DELETE' });
      router.push('/orders');
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Network error');
    }
  }

  return (
    <Shell>
      {orderRes.error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{orderRes.error}</p>}
      {!order && !orderRes.error && <p className="text-sm text-slate-500">Loading…</p>}
      {order && (
        <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <h1 className="text-xl font-semibold">{order.customer}</h1>
              <StatusBadge status={order.displayStatus} />
            </div>
            <DueDate order={order} onSaved={() => void orderRes.reload()} />

            <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Unit price</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3">{l.description}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatCents(l.unitPriceCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatCents(l.quantity * l.unitPriceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 font-medium">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-right">Total</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(order.totalCents)}</td>
                  </tr>
                  <tr className="text-slate-500">
                    <td colSpan={3} className="px-4 py-2 text-right">Paid</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(order.amountPaidCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-right">Amount due</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatCents(order.amountDueCents)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <h2 className="mb-2 font-medium">Payment history</h2>
            {paymentsRes.data && paymentsRes.data.payments.length === 0 && (
              <p className="text-sm text-slate-500">No payments recorded.</p>
            )}
            {paymentsRes.data && paymentsRes.data.payments.length > 0 && (
              <ul className="space-y-2">
                {paymentsRes.data.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium tabular-nums">{formatCents(p.amountCents)}</span>
                      <span className="ml-2 text-slate-500">{p.date}</span>
                    </span>
                    {p.note && <span className="text-slate-500">{p.note}</span>}
                  </li>
                ))}
              </ul>
            )}

            {refundsRes.data && refundsRes.data.refunds.length > 0 && (
              <>
                <h2 className="mb-2 mt-6 font-medium">Refunds</h2>
                <ul className="space-y-2">
                  {refundsRes.data.refunds.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between rounded-md border border-red-100 bg-red-50/50 px-4 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium tabular-nums text-red-700">
                          −{formatCents(r.amountCents)}
                        </span>
                        <span className="ml-2 text-slate-500">{r.date}</span>
                      </span>
                      {r.note && <span className="text-slate-500">{r.note}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {order.amountPaidCents === 0 && (
              <div className="mt-6">
                <button onClick={remove} className="text-sm text-red-600 underline hover:text-red-800">
                  Delete order
                </button>
                {deleteError && <p className="mt-2 text-sm text-red-700">{deleteError}</p>}
              </div>
            )}
          </div>

          <div>
            {order.paymentStatus === 'paid' ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Fully paid.
              </p>
            ) : (
              <PaymentForm
                order={order}
                onRecorded={() => {
                  void orderRes.reload();
                  void paymentsRes.reload();
                }}
              />
            )}
            {order.amountPaidCents > 0 && (
              <RefundForm
                order={order}
                onRecorded={() => {
                  void orderRes.reload();
                  void refundsRes.reload();
                }}
              />
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
