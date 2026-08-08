import { DomainError } from './errors.js';

// All money is integer cents. Floats never touch arithmetic; parsing and
// formatting are the only places a decimal representation exists.

// single-currency today; multi-currency would move this onto the order
export const DEFAULT_CURRENCY = 'USD';

export function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DomainError('INVALID_AMOUNT', `${field} must be a non-negative integer amount in cents`, {
      field,
      received: value,
    });
  }
}

export function parseMoneyToCents(input: string): number | null {
  const match = /^\s*\$?\s*(\d{1,13})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0') || '0');
  const total = dollars * 100 + cents;
  return Number.isSafeInteger(total) ? total : null;
}

export function formatCents(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
