import mongoose, { Document, Schema } from 'mongoose';

export type SessionStatus = 'active' | 'completed' | 'abandoned';
export type TranscriptRole = 'interviewer' | 'candidate';
export type InterviewerStyle = 'supportive' | 'neutral' | 'stress';

export interface TranscriptEntry {
  role: TranscriptRole;
  text: string;
  timestamp: Date;
}

export interface ISession extends Document {
  userId: mongoose.Types.ObjectId;
  caseId: mongoose.Types.ObjectId;
  config: {
    difficulty: number;
    industry: string;
    caseType: string;
    interviewerStyle: InterviewerStyle;
    durationMinutes: number;
    voiceId?: string; // ElevenLabs voice for pipeline-voiced modules (product / energy-profitability)
  };
  status: SessionStatus;
  transcript: TranscriptEntry[];
  // Candidate's private working notes, submitted when the session ends.
  scratchpad?: string;
  // Silent-supervisor compliance flags (admin-only). Mixed array.
  supervisorFlags?: unknown[];
  // PM pipeline (product module) artifacts — additive, written live by the
  // STT→LLM→TTS engine, consumed by the PM report writer. All optional.
  interviewType?: 'pm' | 'consulting';
  turnAssessments?: unknown[];   // per-turn structured assessments (§7.2)
  stateObject?: unknown;          // final compact state snapshot (§8.2/§16)
  stageTransitions?: unknown[];   // §7.3
  thinkingPauses?: unknown[];     // §7.3 (positive signal)
  reprompts?: unknown[];          // §7.3
  integrityFlags?: unknown[];     // §13
  // Credits (minutes) held for this session at start; settled (consumed +
  // released) exactly once when the session ends or is abandoned.
  reservedMinutes?: number;
  settled?: boolean;
  startedAt: Date;
  endedAt?: Date;
  durationSeconds?: number;
}

const SessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    caseId: { type: Schema.Types.ObjectId, ref: 'Case', required: true },
    config: {
      difficulty: { type: Number, required: true },
      industry: { type: String, required: true },
      caseType: { type: String, required: true },
      interviewerStyle: {
        type: String,
        enum: ['supportive', 'neutral', 'stress'],
        default: 'neutral',
      },
      durationMinutes: { type: Number, default: 45 },
      voiceId: { type: String },
    },
    status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
    transcript: [
      {
        role: { type: String, enum: ['interviewer', 'candidate'], required: true },
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    scratchpad: { type: String },
    // Silent-supervisor flags (LED / FED_DATA) — admin-only debug/compliance.
    supervisorFlags: { type: [Schema.Types.Mixed], default: [] },
    // PM pipeline artifacts (product module). Flexible Mixed — no migration.
    interviewType: { type: String, enum: ['pm', 'consulting'] },
    turnAssessments: { type: [Schema.Types.Mixed], default: undefined },
    stateObject: { type: Schema.Types.Mixed },
    stageTransitions: { type: [Schema.Types.Mixed], default: undefined },
    thinkingPauses: { type: [Schema.Types.Mixed], default: undefined },
    reprompts: { type: [Schema.Types.Mixed], default: undefined },
    integrityFlags: { type: [Schema.Types.Mixed], default: undefined },
    reservedMinutes: { type: Number, default: 0 },
    settled: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    durationSeconds: { type: Number },
  },
  { timestamps: true }
);

export const Session = mongoose.model<ISession>('Session', SessionSchema);
