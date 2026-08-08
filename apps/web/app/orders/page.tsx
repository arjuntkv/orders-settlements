'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { formatCents, type OrderDTO } from '@orders/core';
import { Shell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { useApi } from '@/lib/use-api';
import { API_BASE } from '@/lib/api';

const FILTERS = ['all', 'pending', 'partially_paid', 'paid', 'overdue'] as const;

function ExportControls() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = new URLSearchParams({ ...(from && { from }), ...(to && { to }) }).toString();

  return (
    <div className="flex items-center gap-2 text-sm">
      <input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 outline-none focus:border-slate-500"
        aria-label="Export from due date"
      />
      <span className="text-slate-400">–</span>
      <input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 outline-none focus:border-slate-500"
        aria-label="Export to due date"
      />
      <a
        href={`${API_BASE}/orders/export${params ? `?${params}` : ''}`}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
      >
        Export CSV
      </a>
    </div>
  );
}

function Dashboard() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const query = filter === 'all' ? '' : `?status=${filter}`;
  const { data, error, loading } = useApi<{ orders: OrderDTO[] }>(`/orders${query}`);

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <Link
          href="/orders/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          New order
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              filter === f ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
        </div>
        <ExportControls />
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {data && data.orders.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
          No orders {filter !== 'all' ? `with status "${filter.replace('_', ' ')}"` : 'yet'}.
        </p>
      )}

      {data && data.orders.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Due</th>
                <th className="px-4 py-3">Due date</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                      {o.customer}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.displayStatus} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(o.totalCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCents(o.amountPaidCents)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCents(o.amountDueCents)}</td>
                  <td className="px-4 py-3 tabular-nums">{o.dueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

export default function OrdersPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
