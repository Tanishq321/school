import mongoose from 'mongoose';

export const RECORDING_STATUS = Object.freeze({
  RECORDING: 'recording',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  DELETED: 'deleted',
});

/**
 * A server-side recording of one class. Files live in RECORDINGS_DIR (never under the web root)
 * and are only streamed through short-lived signed playback URLs.
 */
const recordingSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, maxlength: 160 },
    status: { type: String, enum: Object.values(RECORDING_STATUS), default: RECORDING_STATUS.RECORDING, index: true },
    startedAt: { type: Date, required: true },
    endedAt: Date,
    durationSec: Number,
    sizeBytes: Number,
    file: { type: String, select: false }, // relative path inside RECORDINGS_DIR
    thumbnail: { type: String, select: false },
    segments: { type: Number, default: 0 },
    shareWithParticipants: { type: Boolean, default: false },
    // Who agreed / declined to be recorded (decliners are excluded from the media).
    consent: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        name: String,
        decision: { type: String, enum: ['accepted', 'declined'] },
        at: Date,
      },
    ],
    error: String,
    deletedAt: Date,
  },
  { timestamps: true },
);

recordingSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.file;
    delete ret.thumbnail;
    return ret;
  },
});

export default mongoose.model('Recording', recordingSchema);
