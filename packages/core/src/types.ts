import type { DisplayStatus, PaymentStatus } from './payments.js';

export interface LineItemDTO {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderDTO {
  id: string;
  customer: string;
  dueDate: string;
  lineItems: LineItemDTO[];
  subtotalCents: number;
  totalCents: number;
  amountPaidCents: number;
  amountDueCents: number;
  paymentStatus: PaymentStatus;
  displayStatus: DisplayStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDTO {
  id: string;
  orderId: string;
  amountCents: number;
  date: string;
  note?: string;
  createdAt: string;
}

export interface RefundDTO {
  id: string;
  orderId: string;
  amountCents: number;
  date: string;
  note?: string;
  createdAt: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
