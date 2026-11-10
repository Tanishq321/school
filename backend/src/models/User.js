import mongoose from 'mongoose';

export const ROLES = Object.freeze(['teacher', 'student', 'admin']);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    emailVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    teacherProfile: {
      bio: { type: String, maxlength: 1000, default: '' },
      subjects: { type: [String], default: [] },
    },
    studentProfile: {
      bio: { type: String, maxlength: 1000, default: '' },
      gradeLevel: { type: String, maxlength: 50, default: '' },
    },
    lastLoginAt: Date,
    // Account protection
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
    sessionsValidAfter: Date, // access tokens issued before this are refused (sign out everywhere)
    twoFactor: {
      enabled: { type: Boolean, default: false },
      enabledAt: Date,
      secret: { type: String, select: false }, // sealed (AES-256-GCM)
      pendingSecret: { type: String, select: false },
      lastStep: { type: Number, default: -1, select: false }, // replay guard
      recoveryHashes: { type: [String], default: [], select: false },
    },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.failedLogins;
    delete ret.lockedUntil;
    delete ret.sessionsValidAfter;
    ret.twoFactor = { enabled: Boolean(ret.twoFactor?.enabled), enabledAt: ret.twoFactor?.enabledAt };
    if (ret.role !== 'teacher') delete ret.teacherProfile;
    if (ret.role !== 'student') delete ret.studentProfile;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
