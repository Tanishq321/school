import bcrypt from 'bcrypt';
import env from '../config/env.js';
import Meeting, { CLOSED_STATUSES, MEETING_STATUS } from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import { generateMeetingCode, hmac, randomToken, safeEqual } from '../utils/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
import { closeRoom, rooms } from '../sockets/realtime.js';
import { workerPool } from '../mediasoup/workerPool.js';
import { audit } from './auditService.js';
import { invitationEmail, sendMail } from './mailer.js';
import { buildIcs } from './calendarService.js';
import logger from '../utils/logger.js';
import User from '../models/User.js';

/** Lower-case, trimmed, de-duplicated invitee emails. */
export const normalizeInvitees = (list = []) => [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 100);

/** Email each new invitee a link (that skips the password) and a calendar file. Never throws. */
export async function sendInvitations(meeting, hostName, emails) {
  if (!emails.length) return;
  const link = inviteUrlFor(meeting);
  const ics = buildIcs(meeting, { url: link, hostName, method: 'REQUEST' });
  const mail = invitationEmail({ hostName, title: meeting.title, when: meeting.scheduledStart, link, description: meeting.description });
  for (const to of emails) {
    try {
      await sendMail({ to, ...mail, attachments: [{ filename: 'class.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=REQUEST' }] });
    } catch (err) {
      logger.error({ err }, 'invitation email failed');
    }
  }
}

/** Every class is one-to-one: the teacher (host) and exactly one student. Enforced on the server. */
export const CLASS_SIZE = 2;
export const effectiveCapacity = () => CLASS_SIZE;

export const inviteTokenFor = (meeting) => hmac(env.INVITE_SECRET, `${meeting._id}.${meeting.inviteNonce}`).slice(0, 32);
export const inviteUrlFor = (meeting) => `${env.APP_URL}/m/${meeting.code}?invite=${inviteTokenFor(meeting)}`;

const isHostOf = (meeting, userId) => String(meeting.host?._id ?? meeting.host) === String(userId);

export function serializeForHost(meeting) {
  return {
    ...meeting.toJSON(),
    inviteUrl: inviteUrlFor(meeting),
    effectiveMaxParticipants: effectiveCapacity(meeting),
    mediaMode: workerPool.ready ? 'sfu' : 'p2p',
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
      allowScreenShare: input.allowScreenShare ?? false,
      allowDrawing: input.allowDrawing ?? false,
      chatMode: input.chatMode ?? 'everyone',
      saveChat: input.saveChat ?? true,
      waitingRoom: input.waitingRoom ?? true,
      hasPassword: Boolean(input.password),
      passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
    },
    inviteNonce: randomToken(12),
    invitees: normalizeInvitees(input.invitees).filter((e) => e !== user.email?.toLowerCase()),
  });
  audit('meeting.create', { actor: user.id, targetType: 'meeting', targetId: meeting._id, meta: { type: input.type, invitees: meeting.invitees.length } });
  const full = await Meeting.findById(meeting._id).select('+inviteNonce');
  sendInvitations(full, user.name, full.invitees);
  return full;
}

export async function getByCode(code, { withSecrets = false } = {}) {
  const q = Meeting.findOne({ code }).populate('host', 'name role');
  if (withSecrets) q.select('+inviteNonce +settings.passwordHash +bannedUsers');
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
  if (!isHost && meeting.bannedUsers?.some((id) => String(id) === String(user.id))) {
    throw new AppError(403, 'removed_from_meeting', 'The host removed you from this meeting.');
  }
  if (!isHost && meeting.locked && !(await Attendance.exists({ meeting: meeting._id, user: user.id }))) {
    throw new AppError(423, 'meeting_locked', 'The host has locked this meeting. Ask them to unlock it.');
  }
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

export async function updateMeeting(meeting, input, actor) {
  if (CLOSED_STATUSES.includes(meeting.status)) throw new AppError(409, 'meeting_closed', 'This meeting is closed');
  let added = [];
  if (input.invitees !== undefined) {
    const next = normalizeInvitees(input.invitees).filter((e) => e !== actor?.email?.toLowerCase());
    added = next.filter((e) => !meeting.invitees.includes(e));
    meeting.invitees = next;
  }
  if (input.title !== undefined) meeting.title = input.title;
  if (input.description !== undefined) meeting.description = input.description;
  if (input.scheduledStart || input.durationMinutes) {
    if (meeting.status === MEETING_STATUS.LIVE && input.scheduledStart) throw badRequest('Cannot reschedule a live meeting');
    if (input.scheduledStart) meeting.scheduledStart = input.scheduledStart;
    if (input.durationMinutes) meeting.durationMinutes = input.durationMinutes;
    meeting.scheduledEnd = new Date(meeting.scheduledStart.getTime() + meeting.durationMinutes * 60_000);
  }
  if (input.waitingRoom !== undefined) meeting.settings.waitingRoom = input.waitingRoom;
  for (const k of ['allowScreenShare', 'allowDrawing', 'chatMode', 'saveChat']) {
    if (input[k] !== undefined) meeting.settings[k] = input[k];
  }
  if (input.password !== undefined) {
    meeting.settings.hasPassword = Boolean(input.password);
    meeting.settings.passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
  }
  if (input.rotateInvite) meeting.inviteNonce = randomToken(12);
  await meeting.save();
  if (added.length) sendInvitations(meeting, actor?.name || meeting.host?.name || 'Your teacher', added);
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

async function visibleTo(user) {
  const attended = await Attendance.distinct('meeting', { user: user.id });
  const or = [{ host: user.id }, { _id: { $in: attended } }];
  if (user.email) or.push({ invitees: user.email.toLowerCase() });
  return or;
}

function serializeForViewer(m, user) {
  return isHostOf(m, user.id)
    ? { ...serializeForHost(m), isHost: true }
    : { ...serializeSummary(m), id: String(m._id), status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, isHost: false, invited: Boolean(user.email && m.invitees?.includes(user.email.toLowerCase())) };
}

export async function listForUser(user, scope, { from, to } = {}) {
  const or = await visibleTo(user);
  let filter;
  let sort;
  if (scope === 'range') {
    // Calendar: anything (not cancelled) that overlaps the requested window.
    filter = { $or: or, status: { $ne: MEETING_STATUS.CANCELLED }, scheduledStart: { $lt: to }, scheduledEnd: { $gt: from } };
    sort = { scheduledStart: 1 };
  } else if (scope === 'past') {
    filter = { $or: or, status: { $in: CLOSED_STATUSES } };
    sort = { scheduledStart: -1 };
  } else {
    filter = { $or: or, status: { $in: [MEETING_STATUS.SCHEDULED, MEETING_STATUS.LIVE] } };
    sort = { scheduledStart: 1 };
  }
  const meetings = await Meeting.find(filter).select('+inviteNonce').populate('host', 'name').sort(sort).limit(scope === 'range' ? 500 : 100);
  return meetings.map((m) => serializeForViewer(m, user));
}

/** May this user see the class page (summary, calendar file)? Host, invitee, or someone who attended. */
export async function canSeeMeeting(meeting, user) {
  if (isHostOf(meeting, user.id)) return true;
  if (user.email && meeting.invitees?.includes(user.email.toLowerCase())) return true;
  return Boolean(await Attendance.exists({ meeting: meeting._id, user: user.id }));
}

export { serializeForViewer, isHostOf };

/** Resolve invitee emails to names for the host's guest list (no other account details). */
export async function inviteeDirectory(meeting) {
  if (!meeting.invitees?.length) return [];
  const users = await User.find({ email: { $in: meeting.invitees } }).select('name email').lean();
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.name]));
  return meeting.invitees.map((email) => ({ email, name: byEmail.get(email) || null, hasAccount: byEmail.has(email) }));
}
