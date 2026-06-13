import mongoose, { Document, Schema } from 'mongoose';

// Every admin action that touches money or rules writes a line here:
// who did it, what changed, when. Survives billing disputes and teammates.
export interface IAuditLog extends Document {
  adminId: mongoose.Types.ObjectId;
  action: string;            // e.g. "grant_credits", "edit_plan", "suspend_user"
  targetUserId?: mongoose.Types.ObjectId;
  details: Record<string, unknown>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    details: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
