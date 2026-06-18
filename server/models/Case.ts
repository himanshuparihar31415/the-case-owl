import mongoose, { Document, Schema } from 'mongoose';

export type CaseType = 'profitability' | 'market_entry' | 'ma' | 'growth' | 'pricing' | 'operations';
export type Industry = 'tech' | 'cpg' | 'pharma' | 'finance' | 'energy' | 'automotive' | 'retail';

export interface ICase extends Document {
  title: string;
  type: CaseType;
  industry: Industry;
  difficulty: number;
  description: string;
  scenario: string;
  keyDataPoints: Array<{ label: string; value: string }>;
  questions: string[];
  // Pre-generated "answer key" — used to steer the live interview toward a
  // meaningful conclusion, then shown to the user in the report. Optional:
  // seeded/custom/legacy cases won't have these.
  plausibleSolution?: string;
  solutionTree?: unknown; // recursive { label, insight?, children? }
  idealScript?: Array<{ stage: string; interviewer: string; idealResponse: string }>;
  openingHook?: { reference: string; bridge: string }; // real-world hook to open the interview naturally
  isSeeded: boolean;
  generatedAt: Date;
  isCustom: boolean;
  createdBy?: mongoose.Types.ObjectId | null;
}

const CaseSchema = new Schema<ICase>(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      required: true,
      enum: ['profitability', 'market_entry', 'ma', 'growth', 'pricing', 'operations'],
    },
    industry: {
      type: String,
      required: true,
      enum: ['tech', 'cpg', 'pharma', 'finance', 'energy', 'automotive', 'retail'],
    },
    difficulty: { type: Number, required: true, min: 1, max: 4 },
    description: { type: String, required: true },
    scenario: { type: String, required: true },
    keyDataPoints: [{ label: String, value: String }],
    questions: [String],
    plausibleSolution: { type: String },
    solutionTree: { type: Schema.Types.Mixed },
    idealScript: { type: Schema.Types.Mixed },
    openingHook: { type: Schema.Types.Mixed },
    isSeeded: { type: Boolean, default: false },
    generatedAt: { type: Date, default: Date.now },
    isCustom: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

CaseSchema.index({ type: 1, industry: 1, difficulty: 1 });
CaseSchema.index({ createdBy: 1 });

export const Case = mongoose.model<ICase>('Case', CaseSchema);
