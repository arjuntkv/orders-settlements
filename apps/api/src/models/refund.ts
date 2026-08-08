import mongoose, { Schema, type InferSchemaType } from 'mongoose';

// a refund is a reversal entry, not a negative payment: payments stay
// immutable and the audit story stays append-only on both sides
const refundSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountCents: { type: Number, required: true },
    date: { type: String, required: true },
    note: { type: String, trim: true, maxlength: 1000 },
    idempotencyKey: { type: String },
  },
  { timestamps: true },
);

refundSchema.index({ orderId: 1, createdAt: -1 });
refundSchema.index(
  { orderId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type RefundDoc = InferSchemaType<typeof refundSchema> & { _id: mongoose.Types.ObjectId };
export const Refund = mongoose.model('Refund', refundSchema);
