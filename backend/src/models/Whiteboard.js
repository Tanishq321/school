import mongoose from 'mongoose';

/** The shared board of a meeting: an ordered list of drawing operations (normalised 0..1 coordinates). */
const whiteboardSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, unique: true },
    ops: { type: [mongoose.Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

export default mongoose.model('Whiteboard', whiteboardSchema);
