import mongoose from 'mongoose';

export const MEETING_STATUS = Object.freeze({
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  ENDED: 'ended',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
});

export const CLOSED_STATUSES = [MEETING_STATUS.ENDED, MEETING_STATUS.CANCELLED, MEETING_STATUS.EXPIRED];

const meetingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['instant', 'scheduled'], required: true },
    status: {
      type: String,
      enum: Object.values(MEETING_STATUS),
      default: MEETING_STATUS.SCHEDULED,
      index: true,
    },
    scheduledStart: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, min: 5, max: 600, default: 60 },
    scheduledEnd: { type: Date, required: true },
    startedAt: Date,
    endedAt: Date,
    lastActiveAt: Date,
    endedReason: { type: String, enum: ['host_ended', 'idle', 'expired', 'admin', null], default: null },
    settings: {
      waitingRoom: { type: Boolean, default: true },
      passwordHash: { type: String, select: false },
      hasPassword: { type: Boolean, default: false },
      allowScreenShare: { type: Boolean, default: false },
      allowDrawing: { type: Boolean, default: false },
      chatMode: { type: String, enum: ['everyone', 'host'], default: 'everyone' },
      saveChat: { type: Boolean, default: true },
    },
    locked: { type: Boolean, default: false },
    // The invited student (by email): sees the class on their pages and skips the waiting room.
    invitees: { type: [String], default: [], validate: (v) => v.length <= 1 },
    notes: { type: String, maxlength: 20000, default: '' }, // the host's private class notes
    bannedUsers: { type: [mongoose.Schema.Types.ObjectId], default: [], select: false },
    inviteNonce: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

meetingSchema.index({ status: 1, scheduledEnd: 1 });
meetingSchema.index({ invitees: 1, scheduledStart: 1 });

meetingSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.inviteNonce;
    delete ret.bannedUsers;
    delete ret.notes; // served only to the host, explicitly
    if (ret.settings) delete ret.settings.passwordHash;
    return ret;
  },
});

export default mongoose.model('Meeting', meetingSchema);
