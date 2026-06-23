import mongoose, { Document, Schema } from 'mongoose';

export type CaseType = 'profitability' | 'market_entry' | 'ma' | 'growth' | 'pricing' | 'operations';
export type Industry = 'tech' | 'cpg' | 'pharma' | 'finance' | 'energy' | 'automotive' | 'retail';

export type InterviewModule = 'case' | 'product' | 'guesstimate';

export interface ICase extends Document {
  title: string;
  // 'case' = consulting case (uses `type`/`industry`); 'product'/'guesstimate'
  // are the PM & estimation modules (use `subType` instead of `type`).
  module: InterviewModule;
  subType?: string; // product format ('design'|'strategy'|'rootcause'|'prioritization') or guesstimate tag
  // PM module: the single neutral question the interviewer poses (§12.1.2).
  // Falls back to `scenario` when absent. Other PM authoring fields land in P6.
  prompt?: string;
  type?: CaseType;
  industry?: Industry;
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
  // Pharma-profitability exhibit cases (specialized generator): reconciled
  // exhibits revealed only when earned + a quant task + the private mechanism.
  exhibits?: Array<{ id?: number; label?: string; visual?: string; data?: string; whenToShow?: string; doNotShowIf?: string; insight?: string }>;
  quant?: { task?: string; whenToShow?: string; derivation?: string; answer?: string };
  privateMechanismNote?: string;
  answerKey?: string;
  commonWrongTurns?: string[];
  forbiddenTerms?: string[]; // mechanism jargon + key figures the candidate must self-discover (supervisor)
  isSeeded: boolean;
  generatedAt: Date;
  isCustom: boolean;
  createdBy?: mongoose.Types.ObjectId | null;
}

const CaseSchema = new Schema<ICase>(
  {
    title: { type: String, required: true },
    module: { type: String, enum: ['case', 'product', 'guesstimate'], default: 'case', index: true },
    subType: { type: String },
    prompt: { type: String },
    // Optional: consulting cases set these; product/guesstimate modules don't.
    type: {
      type: String,
      enum: ['profitability', 'market_entry', 'ma', 'growth', 'pricing', 'operations'],
    },
    industry: {
      type: String,
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
    exhibits: { type: Schema.Types.Mixed },
    quant: { type: Schema.Types.Mixed },
    privateMechanismNote: { type: String },
    answerKey: { type: String },
    commonWrongTurns: { type: [String] },
    forbiddenTerms: { type: [String] },
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
