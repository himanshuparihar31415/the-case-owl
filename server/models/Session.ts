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
  };
  status: SessionStatus;
  transcript: TranscriptEntry[];
  // Candidate's private working notes, submitted when the session ends.
  scratchpad?: string;
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
    reservedMinutes: { type: Number, default: 0 },
    settled: { type: Boolean, default: false },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    durationSeconds: { type: Number },
  },
  { timestamps: true }
);

export const Session = mongoose.model<ISession>('Session', SessionSchema);
