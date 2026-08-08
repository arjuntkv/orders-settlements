export type DomainErrorCode =
  | 'INVALID_AMOUNT'
  | 'INVALID_QUANTITY'
  | 'INVALID_LINE_ITEMS'
  | 'OVERPAYMENT'
  | 'ORDER_NOT_PAYABLE';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
