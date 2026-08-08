import { DomainError } from './errors.js';
import { formatCents } from './money.js';

export type PaymentStatus = 'pending' | 'partially_paid' | 'paid';
export type DisplayStatus = PaymentStatus | 'overdue';

export function derivePaymentStatus(totalCents: number, amountPaidCents: number): PaymentStatus {
  if (amountPaidCents <= 0) return 'pending';
  if (amountPaidCents < totalCents) return 'partially_paid';
  return 'paid';
}

// Due dates are calendar dates (YYYY-MM-DD), not instants — an order due
// "2026-08-15" is overdue on the 16th regardless of timezone. Comparing the
// strings lexicographically avoids TZ math entirely.
export function isOverdue(dueDate: string, status: PaymentStatus, today: string): boolean {
  return status !== 'paid' && dueDate < today;
}

// overdue is derived at read time, never stored: it changes with the clock,
// and a stored copy would go stale the moment midnight passes.
export function displayStatus(totalCents: number, amountPaidCents: number, dueDate: string, today: string): DisplayStatus {
  const status = derivePaymentStatus(totalCents, amountPaidCents);
  return isOverdue(dueDate, status, today) ? 'overdue' : status;
}

export function maxPaymentCents(totalCents: number, amountPaidCents: number): number {
  return Math.max(0, totalCents - amountPaidCents);
}

// refunds are reversal entries against what was actually paid — payments are
// never mutated or deleted. Net paid can go back to zero, never below.
export function maxRefundableCents(amountPaidCents: number): number {
  return Math.max(0, amountPaidCents);
}

export function validateRefundAmount(amountCents: number, amountPaidCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    throw new DomainError('INVALID_AMOUNT', 'Refund amount must be at least $0.01', {
      received: amountCents,
    });
  }
  const max = maxRefundableCents(amountPaidCents);
  if (amountCents > max) {
    throw new DomainError(
      'REFUND_EXCEEDS_PAID',
      max === 0
        ? 'Nothing has been paid on this order, so there is nothing to refund'
        : `Refund exceeds the net amount paid. Maximum refundable is ${formatCents(max)}`,
      { maxRefundableCents: max },
    );
  }
}

export function validatePaymentAmount(amountCents: number, totalCents: number, amountPaidCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    throw new DomainError('INVALID_AMOUNT', 'Payment amount must be at least $0.01', {
      received: amountCents,
    });
  }
  const maxAllowed = maxPaymentCents(totalCents, amountPaidCents);
  if (amountCents > maxAllowed) {
    if (maxAllowed === 0) {
      throw new DomainError('OVERPAYMENT', 'This order is already fully paid', {
        maxAllowedCents: 0,
      });
    }
    throw new DomainError(
      'OVERPAYMENT',
      `Payment exceeds the amount due. Maximum allowed is ${formatCents(maxAllowed)}`,
      { maxAllowedCents: maxAllowed },
    );
  }
}
