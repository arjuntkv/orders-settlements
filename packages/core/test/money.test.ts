import { describe, expect, it } from 'vitest';
import { assertCents, formatCents, parseMoneyToCents } from '../src/money.js';
import { DomainError } from '../src/errors.js';

describe('parseMoneyToCents', () => {
  it('parses plain and formatted inputs', () => {
    expect(parseMoneyToCents('500')).toBe(50000);
    expect(parseMoneyToCents('500.5')).toBe(50050);
    expect(parseMoneyToCents('500.05')).toBe(50005);
    expect(parseMoneyToCents('$1,000')).toBeNull(); // commas not accepted, keep grammar strict
    expect(parseMoneyToCents(' $12.34 ')).toBe(1234);
    expect(parseMoneyToCents('0.01')).toBe(1);
  });

  it('rejects garbage and negative values', () => {
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('-5')).toBeNull();
    expect(parseMoneyToCents('12.345')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
  });

  it('never produces a float', () => {
    // 0.1 + 0.2 style drift is impossible if we only ever hold integers
    expect(parseMoneyToCents('0.10')).toBe(10);
    expect(parseMoneyToCents('0.20')).toBe(20);
    expect(parseMoneyToCents('0.30')).toBe(30);
  });
});

describe('assertCents', () => {
  it('accepts non-negative safe integers', () => {
    expect(() => assertCents(0, 'x')).not.toThrow();
    expect(() => assertCents(99_999_999, 'x')).not.toThrow();
  });

  it('rejects floats, negatives, and unsafe integers', () => {
    for (const bad of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
      expect(() => assertCents(bad, 'x')).toThrow(DomainError);
    }
  });
});

describe('formatCents', () => {
  it('formats to currency', () => {
    expect(formatCents(50000)).toBe('$500.00');
    expect(formatCents(1)).toBe('$0.01');
  });
});
