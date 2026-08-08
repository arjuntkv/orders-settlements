import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const paymentSchema = new Schema(
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

paymentSchema.index({ orderId: 1, createdAt: -1 });
// retried request with the same key can't double-record; partial index so
// payments recorded without a key don't collide on null
paymentSchema.index(
  { orderId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: mongoose.Types.ObjectId };
export const Payment = mongoose.model('Payment', paymentSchema);
