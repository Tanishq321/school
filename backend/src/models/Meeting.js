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
      maxParticipants: { type: Number, min: 2, max: 100, default: 20 },
    },
    inviteNonce: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

meetingSchema.index({ status: 1, scheduledEnd: 1 });

meetingSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.inviteNonce;
    if (ret.settings) delete ret.settings.passwordHash;
    return ret;
  },
});

export default mongoose.model('Meeting', meetingSchema);
