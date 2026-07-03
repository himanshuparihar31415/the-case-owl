import mongoose, { Document, Schema } from 'mongoose';

// A lightweight record that a user opened a focus lesson. Used to close the
// coaching loop: after the next case, the report references the lesson the user
// reviewed beforehand ("you practiced X, here's how it changed your case").
export interface ILessonView extends Document {
  userId: mongoose.Types.ObjectId;
  habitTag: string;
  viewedAt: Date;
}

const LessonViewSchema = new Schema<ILessonView>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    habitTag: { type: String, required: true },
    viewedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const LessonView = mongoose.model<ILessonView>('LessonView', LessonViewSchema);
