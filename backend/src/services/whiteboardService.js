import Whiteboard from '../models/Whiteboard.js';
import logger from '../utils/logger.js';

export const MAX_OPS = 5000;

// Stored as a flat [x0, y0, x1, y1, ...] list: compact, and portable to MongoDB-compatible
// stores that don't support nested arrays. The wire format keeps [[x, y], ...].
const toDb = (op) => {
  const { points, ...rest } = op;
  return { ...rest, flat: points.flat() };
};
const fromDb = (doc) => {
  const { flat = [], ...rest } = doc;
  const points = [];
  for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
  return { ...rest, points };
};

/** Load a meeting's board once per live room (survives server restarts). */
export async function ensureBoardLoaded(room) {
  if (room.board.loaded) return room.board;
  const doc = await Whiteboard.findOne({ meeting: room.meetingId }).lean();
  room.board.ops = (doc?.ops ?? []).map(fromDb);
  room.board.loaded = true;
  return room.board;
}

/** Debounced persistence: drawing produces many small changes. */
export function scheduleBoardSave(room) {
  clearTimeout(room.board.saveTimer);
  room.board.saveTimer = setTimeout(() => saveBoard(room), 1500);
  room.board.saveTimer.unref?.();
}

export async function saveBoard(room) {
  clearTimeout(room.board.saveTimer);
  room.board.saveTimer = null;
  if (!room.board.loaded) return;
  try {
    await Whiteboard.updateOne({ meeting: room.meetingId }, { $set: { ops: room.board.ops.map(toDb) } }, { upsert: true });
  } catch (err) {
    logger.error({ err, meeting: room.meetingId }, 'failed to save whiteboard');
  }
}
