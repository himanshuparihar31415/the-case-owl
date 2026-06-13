import mongoose, { Document, Schema } from 'mongoose';

// Cached cross-session narrative for the dashboard. Regenerated when the
// user's report count changes (i.e. they complete a new scored interview).
export interface IProgressInsight extends Document {
  userId: mongoose.Types.ObjectId;
  reportCount: number;
  insight: Record<string, unknown>;
  generatedAt: Date;
}

const ProgressInsightSchema = new Schema<IProgressInsight>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    reportCount: { type: Number, required: true },
    insight: { type: Schema.Types.Mixed },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const ProgressInsight = mongoose.model<IProgressInsight>('ProgressInsight', ProgressInsightSchema);
