import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const lineItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 500 },
    quantity: { type: Number, required: true },
    unitPriceCents: { type: Number, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    customer: { type: String, required: true, trim: true, maxlength: 200 },
    // calendar date, YYYY-MM-DD — lexicographic order == chronological order,
    // so range queries and the overdue filter work on plain string compares
    dueDate: { type: String, required: true },
    // line items are embedded: always read with the order, bounded count,
    // never queried independently. Payments live in their own collection
    // because they grow without bound and have their own history view.
    lineItems: { type: [lineItemSchema], required: true },
    subtotalCents: { type: Number, required: true },
    totalCents: { type: Number, required: true },
    // denormalized running total, only ever moved inside the payment
    // transaction — this is what the over-payment guard conditions on
    amountPaidCents: { type: Number, required: true, default: 0 },
    paymentStatus: {
      type: String,
      enum: ['pending', 'partially_paid', 'paid'],
      required: true,
      default: 'pending',
    },
  },
  { timestamps: true },
);

// dashboard: filter by status (+ overdue = status != paid AND dueDate < today)
orderSchema.index({ userId: 1, paymentStatus: 1, dueDate: 1 });
// default listing, newest first
orderSchema.index({ userId: 1, createdAt: -1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: mongoose.Types.ObjectId };
export const Order = mongoose.model('Order', orderSchema);
