'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents, parseMoneyToCents, type OrderDTO } from '@orders/core';
import { Shell } from '@/components/shell';
import { api, ApiError } from '@/lib/api';

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const emptyLine = (): LineDraft => ({ description: '', quantity: '1', unitPrice: '' });

export default function NewOrderPage() {
  const router = useRouter();
  const [customer, setCustomer] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  // preview only — the API recomputes totals and is the source of truth
  const previewCents = lines.reduce((sum, l) => {
    const cents = parseMoneyToCents(l.unitPrice);
    const qty = Number(l.quantity);
    return cents !== null && Number.isInteger(qty) && qty >= 1 ? sum + qty * cents : sum;
  }, 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const lineItems = [];
    for (const [i, l] of lines.entries()) {
      const unitPriceCents = parseMoneyToCents(l.unitPrice);
      if (unitPriceCents === null) {
        setError(`Line ${i + 1}: enter a valid price like 500 or 499.99`);
        return;
      }
      lineItems.push({ description: l.description, quantity: Number(l.quantity), unitPriceCents });
    }

    setBusy(true);
    try {
      const res = await api<{ order: OrderDTO }>('/orders', {
        method: 'POST',
        body: JSON.stringify({ customer, dueDate, lineItems }),
      });
      router.push(`/orders/${res.order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Network error, try again');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="mb-4 text-xl font-semibold">New order</h1>
      <form onSubmit={submit} className="max-w-2xl space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Customer</span>
            <input
              required
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Due date</span>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
            />
          </label>
        </div>

        <div>
          <div className="mb-1 grid grid-cols-[1fr_5rem_8rem_2rem] gap-2 text-sm font-medium">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price ($)</span>
            <span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_5rem_8rem_2rem] gap-2">
              <input
                required
                value={l.description}
                onChange={(e) => setLine(i, { description: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <input
                required
                type="number"
                min={1}
                step={1}
                value={l.quantity}
                onChange={(e) => setLine(i, { quantity: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <input
                required
                inputMode="decimal"
                placeholder="500.00"
                value={l.unitPrice}
                onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button
                type="button"
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                disabled={lines.length === 1}
                className="text-slate-400 hover:text-red-600 disabled:opacity-30"
                aria-label={`Remove line ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
            className="text-sm text-slate-600 underline hover:text-slate-900"
          >
            + Add line
          </button>
        </div>

        <p className="text-sm text-slate-500">
          Order total: <span className="font-medium text-slate-900">{formatCents(previewCents)}</span>
        </p>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create order'}
        </button>
      </form>
    </Shell>
  );
}
