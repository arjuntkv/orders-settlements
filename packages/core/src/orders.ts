import { DomainError } from './errors.js';
import { assertCents } from './money.js';

export interface LineItemInput {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  totalCents: number;
}

// Quantities are whole units. Fractional quantities (2.5 hours of a service)
// would force a rounding policy on qty * unitPrice; keeping them integral
// keeps every stored amount exact. Documented tradeoff in the README.
export function computeOrderTotals(lines: LineItemInput[]): OrderTotals {
  if (lines.length === 0) {
    throw new DomainError('INVALID_LINE_ITEMS', 'An order needs at least one line item');
  }
  let subtotalCents = 0;
  for (const [i, line] of lines.entries()) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      throw new DomainError('INVALID_QUANTITY', `Line ${i + 1}: quantity must be an integer >= 1`, {
        line: i + 1,
        received: line.quantity,
      });
    }
    assertCents(line.unitPriceCents, `line ${i + 1} unit price`);
    subtotalCents += line.quantity * line.unitPriceCents;
    if (!Number.isSafeInteger(subtotalCents)) {
      throw new DomainError('INVALID_AMOUNT', 'Order total exceeds the maximum representable amount');
    }
  }
  // No order-level tax or discount in scope, so total === subtotal. Kept as
  // two fields so adding either later doesn't ripple through the schema.
  return { subtotalCents, totalCents: subtotalCents };
}
