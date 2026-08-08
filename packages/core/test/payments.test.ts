import { describe, expect, it } from 'vitest';
import {
  derivePaymentStatus,
  displayStatus,
  isOverdue,
  maxPaymentCents,
  validatePaymentAmount,
  validateRefundAmount,
} from '../src/payments.js';
import { DomainError } from '../src/errors.js';

describe('derivePaymentStatus', () => {
  it('follows the assignment sample flow', () => {
    // $1,000 order: pay $400 -> partially_paid, pay $600 more -> paid
    expect(derivePaymentStatus(100000, 0)).toBe('pending');
    expect(derivePaymentStatus(100000, 40000)).toBe('partially_paid');
    expect(derivePaymentStatus(100000, 100000)).toBe('paid');
  });

  it('treats a single cent as partially paid', () => {
    expect(derivePaymentStatus(100000, 1)).toBe('partially_paid');
  });
});

describe('isOverdue / displayStatus', () => {
  const today = '2026-08-08';

  it('is overdue only when past due and not fully paid', () => {
    expect(isOverdue('2026-08-07', 'pending', today)).toBe(true);
    expect(isOverdue('2026-08-07', 'partially_paid', today)).toBe(true);
    expect(isOverdue('2026-08-08', 'pending', today)).toBe(false); // due today is not overdue
    expect(isOverdue('2026-08-09', 'pending', today)).toBe(false);
  });

  it('an order that was overdue reads paid once settled', () => {
    expect(displayStatus(100000, 100000, '2026-01-01', today)).toBe('paid');
    expect(displayStatus(100000, 99999, '2026-01-01', today)).toBe('overdue');
  });
});

describe('validatePaymentAmount', () => {
  it('accepts a payment up to the exact amount due', () => {
    expect(() => validatePaymentAmount(60000, 100000, 40000)).not.toThrow();
  });

  it('rejects overpayment and reports the maximum allowed', () => {
    try {
      validatePaymentAmount(60001, 100000, 40000);
      expect.unreachable();
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe('OVERPAYMENT');
      expect(e.details?.maxAllowedCents).toBe(60000);
      expect(e.message).toContain('$600.00');
    }
  });

  it('rejects any payment on a fully paid order', () => {
    try {
      validatePaymentAmount(100, 100000, 100000);
      expect.unreachable();
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe('OVERPAYMENT');
      expect(e.details?.maxAllowedCents).toBe(0);
    }
  });

  it('rejects zero, negative, and fractional amounts', () => {
    for (const amount of [0, -100, 0.5]) {
      expect(() => validatePaymentAmount(amount, 100000, 0)).toThrow(/at least \$0\.01/);
    }
  });
});

describe('validateRefundAmount', () => {
  it('accepts refunds up to the net amount paid', () => {
    expect(() => validateRefundAmount(40000, 40000)).not.toThrow();
    expect(() => validateRefundAmount(1, 40000)).not.toThrow();
  });

  it('rejects refunds beyond net paid with the maximum refundable', () => {
    try {
      validateRefundAmount(40001, 40000);
      expect.unreachable();
    } catch (err) {
      const e = err as DomainError;
      expect(e.code).toBe('REFUND_EXCEEDS_PAID');
      expect(e.details?.maxRefundableCents).toBe(40000);
      expect(e.message).toContain('$400.00');
    }
  });

  it('rejects refunds when nothing was paid, and bad amounts', () => {
    expect(() => validateRefundAmount(100, 0)).toThrow(/nothing to refund/i);
    for (const amount of [0, -5, 1.5]) {
      expect(() => validateRefundAmount(amount, 40000)).toThrow(/at least \$0\.01/);
    }
  });
});

describe('maxPaymentCents', () => {
  it('never goes negative even if paid somehow exceeds total', () => {
    expect(maxPaymentCents(100000, 100001)).toBe(0);
  });
});
