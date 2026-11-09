import mongoose from 'mongoose';

/**
 * Opaque refresh tokens, stored only as sha256 hashes.
 * Rotation: each use revokes the token and issues a new one in the same family.
 * Reuse of a revoked token revokes the whole family (theft detection).
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
    userAgent: { type: String, maxlength: 300 },
    ip: String,
  },
  { timestamps: true },
);

// MongoDB removes expired docs automatically; code also checks expiresAt.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('RefreshToken', refreshTokenSchema);
