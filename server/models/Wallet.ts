import mongoose, { Document, Schema } from 'mongoose';

// One wallet per user. Credits are the abstract entitlement unit: 1 credit = 1
// minute of interview time. The wallet is the running total; the LedgerEntry
// collection is the append-only source of truth (never edit balances directly,
// always go through the quota service which writes a ledger line).
export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  subscriptionCredits: number; // reset each renewal cycle
  topupCredits: number;        // one-time purchases, do not reset
  reserved: number;            // held for in-flight sessions
  unlimited: boolean;          // plan grants unlimited interviews (still capped per-interview)
  planCode: string | null;     // e.g. "pro_v1"
  perInterviewCapMinutes: number; // hard cap per single session (copied from plan)
  currency: string;
  renewalAt: Date | null;
}

const WalletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    subscriptionCredits: { type: Number, default: 0, min: 0 },
    topupCredits: { type: Number, default: 0, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    unlimited: { type: Boolean, default: false },
    planCode: { type: String, default: null },
    perInterviewCapMinutes: { type: Number, default: 30 },
    currency: { type: String, default: 'INR' },
    renewalAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const Wallet = mongoose.model<IWallet>('Wallet', WalletSchema);
