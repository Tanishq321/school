import mongoose from 'mongoose';

/** One document per continuous presence session (join → leave). Short reconnects don't split a session. */
const attendanceSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['host', 'participant'], required: true },
    joinedAt: { type: Date, required: true },
    leftAt: Date,
    durationSec: Number,
    leaveReason: { type: String, enum: ['left', 'disconnected', 'meeting_ended', 'replaced', 'server_restart'] },
  },
  { timestamps: true },
);

attendanceSchema.index({ meeting: 1, user: 1 });

export default mongoose.model('Attendance', attendanceSchema);
