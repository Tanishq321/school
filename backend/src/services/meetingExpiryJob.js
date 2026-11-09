import env from '../config/env.js';
import Meeting, { MEETING_STATUS } from '../models/Meeting.js';
import { rooms } from '../sockets/realtime.js';
import { endMeeting } from './meetingService.js';
import logger from '../utils/logger.js';

/**
 * Runs every minute:
 *  - heartbeats lastActiveAt for rooms with people in them (used for crash recovery)
 *  - expires scheduled meetings that never started
 *  - ends live meetings that have been empty for MEETING_IDLE_END_MINUTES
 */
export async function sweep(now = Date.now()) {
  const activeIds = [...rooms.values()].filter((r) => r.members.size > 0).map((r) => r.meetingId);
  if (activeIds.length) await Meeting.updateMany({ _id: { $in: activeIds } }, { $set: { lastActiveAt: new Date(now) } });

  const expireBefore = new Date(now - env.MEETING_EXPIRY_GRACE_MINUTES * 60_000);
  const neverStarted = await Meeting.find({ status: MEETING_STATUS.SCHEDULED, scheduledEnd: { $lt: expireBefore } });
  for (const m of neverStarted) {
    if (rooms.get(String(m._id))?.members.size) continue;
    await endMeeting(m, 'expired');
  }

  const idleMs = env.MEETING_IDLE_END_MINUTES * 60_000;
  const live = await Meeting.find({ status: MEETING_STATUS.LIVE });
  for (const m of live) {
    const room = rooms.get(String(m._id));
    if (room?.members.size) continue;
    const emptySince = room?.emptySince ?? (m.lastActiveAt ?? m.startedAt ?? m.updatedAt).getTime();
    if (now - emptySince > idleMs) await endMeeting(m, 'idle');
  }
}

export function startMeetingExpiryJob() {
  const timer = setInterval(() => sweep().catch((err) => logger.error({ err }, 'meeting sweep failed')), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
