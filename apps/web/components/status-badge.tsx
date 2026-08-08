import type { DisplayStatus } from '@orders/core';

const STYLES: Record<DisplayStatus, string> = {
  pending: 'bg-slate-100 text-slate-700',
  partially_paid: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
  overdue: 'bg-red-100 text-red-800',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
