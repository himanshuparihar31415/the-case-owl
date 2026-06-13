import mongoose, { Document, Schema } from 'mongoose';

// Append-only accounting truth. Every credit movement writes one line; balances
// are derived. `amount` is signed (positive = credit in, negative = out).
export type LedgerType =
  | 'subscription_grant'
  | 'topup'
  | 'admin_grant'
  | 'promo_grant'
  | 'reserve'
  | 'release'
  | 'consume'
  | 'refund_reversal';

export interface ILedgerEntry extends Document {
  userId: mongoose.Types.ObjectId;
  type: LedgerType;
  amount: number;          // signed credits
  balanceAfter: number;    // total spendable (sub + topup) after this entry
  reason?: string;
  sessionId?: mongoose.Types.ObjectId;
  paymentId?: string;      // Razorpay payment/order id
  adminId?: mongoose.Types.ObjectId;
  // Idempotency: every grant carries a unique key (e.g. the payment id) so a
  // duplicate webhook can't double-credit. Unique sparse index below.
  idempotencyKey?: string;
  createdAt: Date;
}

const LedgerEntrySchema = new Schema<ILedgerEntry>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String },
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session' },
    paymentId: { type: String },
    adminId: { type: Schema.Types.ObjectId, ref: 'User' },
    idempotencyKey: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A grant with a given idempotency key can only ever be written once.
LedgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
LedgerEntrySchema.index({ userId: 1, createdAt: -1 });

export const LedgerEntry = mongoose.model<ILedgerEntry>('LedgerEntry', LedgerEntrySchema);
