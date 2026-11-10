import mongoose from 'mongoose';

/** In-class chat. Text only; rendered as text on the client (never as HTML). */
const chatMessageSchema = new mongoose.Schema(
  {
    meeting: { type: mongoose.Schema.Types.ObjectId, ref: 'Meeting', required: true, index: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderName: { type: String, required: true, maxlength: 80 },
    senderIsHost: { type: Boolean, default: false },
    text: { type: String, required: true, maxlength: 2000 },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

chatMessageSchema.index({ meeting: 1, createdAt: 1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
