import mongoose, { Document, Schema } from 'mongoose';

// Pricing rules live as data, not code. Plans are VERSIONED (code like
// "pro_v1"): never overwrite a plan people are paying on — create a new version
// so existing customers keep what they bought. When a user subscribes, the
// quota service COPIES these numbers onto their wallet (doesn't read live).
export interface IPlan extends Document {
  code: string;            // unique, versioned e.g. "starter_v1"
  family: string;          // "starter" | "pro" | "sprint"
  name: string;
  priceMinor: number;      // base price in paise (INR minor units), GST-exclusive
  currency: string;        // "INR"
  gstPercent: number;      // 18 for Indian SaaS
  interval: 'month' | '2week';
  credits: number;         // subscription credits granted per cycle (minutes)
  unlimited: boolean;      // if true, credits ignored; only per-interview cap applies
  perInterviewCapMinutes: number;
  rollover: boolean;       // do unused subscription credits carry over (default false)
  active: boolean;         // shown for new purchases
  createdAt: Date;
}

const PlanSchema = new Schema<IPlan>(
  {
    code: { type: String, required: true, unique: true },
    family: { type: String, required: true },
    name: { type: String, required: true },
    priceMinor: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    gstPercent: { type: Number, default: 18 },
    interval: { type: String, enum: ['month', '2week'], default: 'month' },
    credits: { type: Number, default: 0 },
    unlimited: { type: Boolean, default: false },
    perInterviewCapMinutes: { type: Number, default: 30 },
    rollover: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Plan = mongoose.model<IPlan>('Plan', PlanSchema);
