import mongoose, { Document, Schema } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  suspended: boolean;
  createdAt: Date;
  preferences: {
    defaultDifficulty: number;
    defaultStyle: string;
  };
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    suspended: { type: Boolean, default: false },
    preferences: {
      defaultDifficulty: { type: Number, default: 2, min: 1, max: 4 },
      defaultStyle: { type: String, default: 'neutral' },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>('User', UserSchema);
