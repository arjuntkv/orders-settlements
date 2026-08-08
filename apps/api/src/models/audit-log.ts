import mongoose, { Schema, type InferSchemaType } from 'mongoose';

// append-only: no updates, no deletes anywhere in the codebase
const auditLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true },
    event: { type: String, required: true },
    // set on money events; amounts without a currency are ambiguous in an audit trail
    currency: { type: String },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: 'at', updatedAt: false } },
);

auditLogSchema.index({ orderId: 1, at: -1 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: mongoose.Types.ObjectId };
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
