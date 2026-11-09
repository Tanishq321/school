import mongoose from 'mongoose';

export const TOKEN_PURPOSES = Object.freeze({
  EMAIL_VERIFY: 'email_verify',
  PASSWORD_RESET: 'password_reset',
});

const oneTimeTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: Object.values(TOKEN_PURPOSES), required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);

oneTimeTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('OneTimeToken', oneTimeTokenSchema);
