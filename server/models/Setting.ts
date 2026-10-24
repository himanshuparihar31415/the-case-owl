import mongoose, { Document, Schema } from 'mongoose';

// Editable global rules — change these WITHOUT a redeploy (in Atlas's data
// browser, or via PATCH /api/admin/settings). One singleton doc, key='global'.
export interface ISetting extends Document {
  key: string;
  signupPromoCredits: number; // free credit-minutes granted at signup (1 credit = 1 min)
  promoEnabled: boolean;
  // Interview engine pilot (docs/engine-contract.md, section 4). A consulting-case session goes to the
  // engine only for these users, and only while ENGINE_URL is set; everyone else keeps today's pipeline.
  enginePilotUserIds: mongoose.Types.ObjectId[];
  // The one case the pilot runs, whatever the user picked (decided 24 Oct): a platform Case whose
  // `engine.caseId` names the engine's case, so the report grades the case that was actually run.
  enginePilotCaseId: mongoose.Types.ObjectId | null;
}

const SettingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    signupPromoCredits: { type: Number, default: 90 }, // 3 interviews × 30-min cap
    promoEnabled: { type: Boolean, default: true },
    enginePilotUserIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    enginePilotCaseId: { type: Schema.Types.ObjectId, ref: 'Case', default: null },
  },
  { timestamps: true }
);

export const Setting = mongoose.model<ISetting>('Setting', SettingSchema);

// Reads the singleton, creating it with defaults on first access.
export async function getSettings(): Promise<ISetting> {
  return Setting.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global', signupPromoCredits: 90, promoEnabled: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ) as Promise<ISetting>;
}
