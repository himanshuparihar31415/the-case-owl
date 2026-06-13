import mongoose, { Document, Schema } from 'mongoose';

// Maps a Razorpay order to the user + what they're buying, so the webhook can
// fulfil reliably (by order id) instead of trusting client-sent data.
export interface IPaymentIntent extends Document {
  orderId: string;
  userId: mongoose.Types.ObjectId;
  kind: 'subscription' | 'topup';
  planCode?: string;
  topupCredits?: number;
  amountMinor: number;
  currency: string;
  status: 'created' | 'paid' | 'failed';
  paymentId?: string;
  createdAt: Date;
}

const PaymentIntentSchema = new Schema<IPaymentIntent>(
  {
    orderId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['subscription', 'topup'], required: true },
    planCode: { type: String },
    topupCredits: { type: Number },
    amountMinor: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created' },
    paymentId: { type: String },
  },
  { timestamps: true }
);

export const PaymentIntent = mongoose.model<IPaymentIntent>('PaymentIntent', PaymentIntentSchema);
