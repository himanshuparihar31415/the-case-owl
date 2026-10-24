import mongoose, { Document, Schema } from 'mongoose';
import type { ResumeBrief } from '../ai/prompts.js';

// A resume a user has uploaded for resume interviews. We keep the structured
// interviewer brief (what the AI needs), not the file or its raw text, so a
// returning user can start again without re-uploading.
export interface ISavedResume extends Document {
  userId: mongoose.Types.ObjectId;
  fileName: string;
  fileSize: number;
  fileHash: string; // sha256 of the file: re-uploading the same file reuses this record
  brief: ResumeBrief;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SavedResumeSchema = new Schema<ISavedResume>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    fileHash: { type: String, required: true },
    brief: { type: Schema.Types.Mixed, required: true },
    lastUsedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

SavedResumeSchema.index({ userId: 1, fileHash: 1 }, { unique: true });

export const SavedResume = mongoose.model<ISavedResume>('SavedResume', SavedResumeSchema);
