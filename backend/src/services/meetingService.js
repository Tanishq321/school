import bcrypt from 'bcrypt';
import env from '../config/env.js';
import Meeting, { CLOSED_STATUSES, MEETING_STATUS } from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import { generateMeetingCode, hmac, randomToken, safeEqual } from '../utils/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
import { closeRoom, rooms } from '../sockets/realtime.js';
import { audit } from './auditService.js';

export const effectiveCapacity = (meeting) =>
  // Phase 1 media is peer-to-peer (mesh), so cap at P2P_MAX_PARTICIPANTS until the SFU lands (Phase 2).
  Math.min(meeting.settings?.maxParticipants ?? 2, env.P2P_MAX_PARTICIPANTS);

export const inviteTokenFor = (meeting) => hmac(env.INVITE_SECRET, `${meeting._id}.${meeting.inviteNonce}`).slice(0, 32);
export const inviteUrlFor = (meeting) => `${env.APP_URL}/m/${meeting.code}?invite=${inviteTokenFor(meeting)}`;

const isHostOf = (meeting, userId) => String(meeting.host?._id ?? meeting.host) === String(userId);

export function serializeForHost(meeting) {
  return {
    ...meeting.toJSON(),
    inviteUrl: inviteUrlFor(meeting),
    effectiveMaxParticipants: effectiveCapacity(meeting),
    liveParticipants: rooms.get(String(meeting._id))?.members.size ?? 0,
  };
}

export function serializeSummary(meeting) {
  return {
    code: meeting.code,
    title: meeting.title,
    status: meeting.status,
    hostName: meeting.host?.name,
    scheduledStart: meeting.scheduledStart,
    durationMinutes: meeting.durationMinutes,
    hasPassword: Boolean(meeting.settings?.hasPassword),
    waitingRoom: Boolean(meeting.settings?.waitingRoom),
  };
}

async function uniqueCode() {
  for (let i = 0; i < 5; i += 1) {
    const code = generateMeetingCode();
    if (!(await Meeting.exists({ code }))) return code;
  }
  throw new AppError(500, 'code_generation_failed', 'Could not allocate a meeting code');
}

export async function createMeeting(user, input) {
  const start = input.type === 'scheduled' ? input.scheduledStart : new Date();
  if (input.type === 'scheduled' && start.getTime() < Date.now() - 5 * 60_000) {
    throw badRequest('Scheduled start must be in the future');
  }
  const durationMinutes = input.durationMinutes ?? 60;
  const meeting = await Meeting.create({
    code: await uniqueCode(),
    title: input.title || (input.type === 'instant' ? `${user.name}'s meeting` : 'Class'),
    description: input.description ?? '',
    host: user.id,
    type: input.type,
    scheduledStart: start,
    durationMinutes,
    scheduledEnd: new Date(start.getTime() + durationMinutes * 60_000),
    settings: {
      waitingRoom: input.waitingRoom ?? true,
      maxParticipants: input.maxParticipants ?? 20,
      hasPassword: Boolean(input.password),
      passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
    },
    inviteNonce: randomToken(12),
  });
  audit('meeting.create', { actor: user.id, targetType: 'meeting', targetId: meeting._id, meta: { type: input.type } });
  return Meeting.findById(meeting._id).select('+inviteNonce');
}

export async function getByCode(code, { withSecrets = false } = {}) {
  const q = Meeting.findOne({ code }).populate('host', 'name role');
  if (withSecrets) q.select('+inviteNonce +settings.passwordHash');
  const meeting = await q;
  if (!meeting) throw notFound('Meeting not found. Check the code and try again.', 'meeting_not_found');
  return meeting;
}

export async function getForHost(code, user) {
  const meeting = await getByCode(code, { withSecrets: true });
  if (!isHostOf(meeting, user.id)) throw forbidden('Only the host can do that', 'not_host');
  return meeting;
}

/** All REST-side checks before a user may open a socket session for this meeting. */
export async function authorizeJoin(user, code, { password, invite } = {}) {
  const meeting = await getByCode(code, { withSecrets: true });
  if (CLOSED_STATUSES.includes(meeting.status)) {
    throw new AppError(410, 'meeting_closed', `This meeting has ${meeting.status === 'cancelled' ? 'been cancelled' : 'ended'}.`);
  }
  const isHost = isHostOf(meeting, user.id);
  if (!isHost && meeting.settings.hasPassword) {
    const inviteOk = invite && safeEqual(invite, inviteTokenFor(meeting));
    if (!inviteOk) {
      if (!password) throw new AppError(401, 'password_required', 'This meeting requires a password');
      const ok = await bcrypt.compare(String(password), meeting.settings.passwordHash || '');
      if (!ok) {
        audit('meeting.join_bad_password', { actor: user.id, targetType: 'meeting', targetId: meeting._id });
        throw new AppError(403, 'invalid_meeting_password', 'Incorrect meeting password');
      }
    }
  }
  return { meeting, isHost };
}

export async function updateMeeting(meeting, input) {
  if (CLOSED_STATUSES.includes(meeting.status)) throw new AppError(409, 'meeting_closed', 'This meeting is closed');
  if (input.title !== undefined) meeting.title = input.title;
  if (input.description !== undefined) meeting.description = input.description;
  if (input.scheduledStart || input.durationMinutes) {
    if (meeting.status === MEETING_STATUS.LIVE && input.scheduledStart) throw badRequest('Cannot reschedule a live meeting');
    if (input.scheduledStart) meeting.scheduledStart = input.scheduledStart;
    if (input.durationMinutes) meeting.durationMinutes = input.durationMinutes;
    meeting.scheduledEnd = new Date(meeting.scheduledStart.getTime() + meeting.durationMinutes * 60_000);
  }
  if (input.waitingRoom !== undefined) meeting.settings.waitingRoom = input.waitingRoom;
  if (input.maxParticipants !== undefined) meeting.settings.maxParticipants = input.maxParticipants;
  if (input.password !== undefined) {
    meeting.settings.hasPassword = Boolean(input.password);
    meeting.settings.passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
  }
  if (input.rotateInvite) meeting.inviteNonce = randomToken(12);
  await meeting.save();
  const room = rooms.get(String(meeting._id));
  if (room) room.settings = { waitingRoom: meeting.settings.waitingRoom, maxParticipants: effectiveCapacity(meeting) };
  return meeting;
}

/** End (or cancel, if never started) a meeting and close its live room. Idempotent. */
export async function endMeeting(meeting, reason, actorId) {
  const wasLive = meeting.status === MEETING_STATUS.LIVE;
  const status = wasLive
    ? MEETING_STATUS.ENDED
    : reason === 'expired'
      ? MEETING_STATUS.EXPIRED
      : reason === 'idle'
        ? MEETING_STATUS.ENDED
        : MEETING_STATUS.CANCELLED;
  // Conditional update makes concurrent end calls (host + idle job) safe.
  const res = await Meeting.updateOne(
    { _id: meeting._id, status: { $in: [MEETING_STATUS.SCHEDULED, MEETING_STATUS.LIVE] } },
    { $set: { status, endedAt: new Date(), endedReason: reason } },
  );
  await closeRoom(meeting._id, reason);
  if (res.modifiedCount) audit('meeting.end', { actor: actorId, targetType: 'meeting', targetId: meeting._id, meta: { reason, status } });
  return Meeting.findById(meeting._id).populate('host', 'name');
}

export async function listForUser(user, scope) {
  const attended = await Attendance.distinct('meeting', { user: user.id });
  const or = [{ host: user.id }, { _id: { $in: attended } }];
  const filter =
    scope === 'past'
      ? { $or: or, status: { $in: CLOSED_STATUSES } }
      : { $or: or, status: { $in: [MEETING_STATUS.SCHEDULED, MEETING_STATUS.LIVE] } };
  const sort = scope === 'past' ? { scheduledStart: -1 } : { scheduledStart: 1 };
  const meetings = await Meeting.find(filter).select('+inviteNonce').populate('host', 'name').sort(sort).limit(100);
  return meetings.map((m) =>
    isHostOf(m, user.id) ? { ...serializeForHost(m), isHost: true } : { ...serializeSummary(m), id: String(m._id), status: m.status, endedAt: m.endedAt, isHost: false },
  );
}
