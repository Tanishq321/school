import Attendance from '../models/Attendance.js';
import Meeting from '../models/Meeting.js';
import logger from '../utils/logger.js';

export async function startSession({ meetingId, userId, isHost }) {
  const doc = await Attendance.create({
    meeting: meetingId,
    user: userId,
    role: isHost ? 'host' : 'participant',
    joinedAt: new Date(),
  });
  return doc._id;
}

export async function endSession(attendanceId, reason, at = new Date()) {
  if (!attendanceId) return;
  try {
    const doc = await Attendance.findOne({ _id: attendanceId, leftAt: null });
    if (!doc) return;
    const leftAt = at < doc.joinedAt ? doc.joinedAt : at;
    doc.leftAt = leftAt;
    doc.durationSec = Math.round((leftAt - doc.joinedAt) / 1000);
    doc.leaveReason = reason;
    await doc.save();
  } catch (err) {
    logger.error({ err, attendanceId }, 'Failed to close attendance session');
  }
}

/**
 * After a crash/restart, sessions left open are closed at the meeting's last heartbeat
 * (lastActiveAt is refreshed every minute while a room has people), so durations err by < ~1 minute.
 */
export async function closeOrphanedSessions() {
  const open = await Attendance.find({ leftAt: null }).lean();
  if (!open.length) return 0;
  const meetings = new Map(
    (await Meeting.find({ _id: { $in: [...new Set(open.map((a) => String(a.meeting)))] } }).lean()).map((m) => [
      String(m._id),
      m,
    ]),
  );
  for (const a of open) {
    const m = meetings.get(String(a.meeting));
    const at = m?.lastActiveAt ?? a.joinedAt;
    await endSession(a._id, 'server_restart', at);
  }
  return open.length;
}

/** Per-user totals for a meeting, computed from real join/leave times. */
export async function summarize(meetingId) {
  const sessions = await Attendance.find({ meeting: meetingId }).populate('user', 'name email role').sort('joinedAt').lean();
  const byUser = new Map();
  const now = Date.now();
  for (const s of sessions) {
    if (!s.user) continue;
    const key = String(s.user._id);
    const entry = byUser.get(key) ?? {
      user: { id: key, name: s.user.name, email: s.user.email, role: s.user.role },
      role: s.role,
      firstJoinedAt: s.joinedAt,
      lastLeftAt: null,
      totalSeconds: 0,
      sessions: 0,
      present: false,
    };
    entry.sessions += 1;
    entry.totalSeconds += s.durationSec ?? Math.round((now - new Date(s.joinedAt)) / 1000);
    if (!s.leftAt) entry.present = true;
    else if (!entry.lastLeftAt || s.leftAt > entry.lastLeftAt) entry.lastLeftAt = s.leftAt;
    byUser.set(key, entry);
  }
  return [...byUser.values()];
}
