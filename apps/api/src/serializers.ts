import { displayStatus, maxPaymentCents, type OrderDTO, type PaymentDTO, type RefundDTO } from '@orders/core';
import type { OrderDoc } from './models/order.js';
import type { PaymentDoc } from './models/payment.js';
import type { RefundDoc } from './models/refund.js';

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toOrderDTO(order: OrderDoc, today = todayUtc()): OrderDTO {
  return {
    id: order._id.toString(),
    customer: order.customer,
    dueDate: order.dueDate,
    lineItems: order.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    })),
    subtotalCents: order.subtotalCents,
    totalCents: order.totalCents,
    amountPaidCents: order.amountPaidCents,
    amountDueCents: maxPaymentCents(order.totalCents, order.amountPaidCents),
    paymentStatus: order.paymentStatus,
    displayStatus: displayStatus(order.totalCents, order.amountPaidCents, order.dueDate, today),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toRefundDTO(refund: RefundDoc): RefundDTO {
  return {
    id: refund._id.toString(),
    orderId: refund.orderId.toString(),
    amountCents: refund.amountCents,
    date: refund.date,
    note: refund.note ?? undefined,
    createdAt: refund.createdAt.toISOString(),
  };
}

export function toPaymentDTO(payment: PaymentDoc): PaymentDTO {
  return {
    id: payment._id.toString(),
    orderId: payment.orderId.toString(),
    amountCents: payment.amountCents,
    date: payment.date,
    note: payment.note ?? undefined,
    createdAt: payment.createdAt.toISOString(),
  };
}
