import { describe, expect, it } from 'vitest';
import { computeOrderTotals } from '../src/orders.js';
import { DomainError } from '../src/errors.js';

describe('computeOrderTotals', () => {
  it('matches the assignment sample: 2 x $500 = $1,000', () => {
    const totals = computeOrderTotals([{ description: 'Consulting', quantity: 2, unitPriceCents: 50000 }]);
    expect(totals).toEqual({ subtotalCents: 100000, totalCents: 100000 });
  });

  it('sums across multiple lines', () => {
    const totals = computeOrderTotals([
      { description: 'A', quantity: 3, unitPriceCents: 1999 },
      { description: 'B', quantity: 1, unitPriceCents: 5 },
    ]);
    expect(totals.subtotalCents).toBe(3 * 1999 + 5);
  });

  it('rejects empty line items', () => {
    expect(() => computeOrderTotals([])).toThrow(DomainError);
  });

  it('rejects non-integer or below-1 quantities', () => {
    for (const quantity of [0, -1, 1.5, NaN]) {
      expect(() => computeOrderTotals([{ description: 'A', quantity, unitPriceCents: 100 }])).toThrow(
        /quantity/i,
      );
    }
  });

  it('rejects negative and fractional unit prices', () => {
    for (const unitPriceCents of [-1, 10.5]) {
      expect(() => computeOrderTotals([{ description: 'A', quantity: 1, unitPriceCents }])).toThrow(
        DomainError,
      );
    }
  });

  it('rejects totals that overflow safe integers', () => {
    expect(() =>
      computeOrderTotals([
        { description: 'A', quantity: 2, unitPriceCents: Number.MAX_SAFE_INTEGER - 1 },
      ]),
    ).toThrow(/maximum representable/);
  });
});
