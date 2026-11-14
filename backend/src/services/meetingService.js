import bcrypt from 'bcrypt';
import env from '../config/env.js';
import Meeting, { CLOSED_STATUSES, MEETING_STATUS } from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import { generateMeetingCode, hmac, randomToken, safeEqual } from '../utils/crypto.js';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors.js';
import { closeRoom, rooms } from '../sockets/realtime.js';
import { workerPool } from '../mediasoup/workerPool.js';
import { audit } from './auditService.js';
import { cancellationEmail, invitationEmail, lessonNotesEmail, rescheduleEmail, sendMail } from './mailer.js';
import { buildIcs, buildIcsMany } from './calendarService.js';
import logger from '../utils/logger.js';
import User from '../models/User.js';

/** Lower-case, trimmed, de-duplicated invitee emails. */
export const normalizeInvitees = (list = []) => [...new Set(list.map((e) => String(e).trim().toLowerCase()).filter(Boolean))].slice(0, 100);

/** The time zones of the people behind these emails (null when unknown: emails then show UTC). */
export async function zonesFor(emails) {
  if (!emails.length) return new Map();
  const users = await User.find({ email: { $in: emails } }).select('email timeZone').lean();
  return new Map(users.map((u) => [u.email.toLowerCase(), u.timeZone || null]));
}

const ICS_TYPE = (method) => `text/calendar; charset=utf-8; method=${method}`;

/**
 * Email each new invitee a link (that skips the password) and a calendar file. A weekly series
 * goes out as one email with every lesson in one calendar file. Never throws.
 */
export async function sendInvitations(meeting, hostName, emails, { series } = {}) {
  if (!emails.length) return;
  const all = series?.length ? series : [meeting];
  const link = inviteUrlFor(all[0]);
  const ics = buildIcsMany(
    all.map((m) => ({ meeting: m, url: inviteUrlFor(m) })),
    { hostName, method: all.length > 1 ? 'PUBLISH' : 'REQUEST' },
  );
  const zones = await zonesFor(emails).catch(() => new Map());
  for (const to of emails) {
    try {
      const mail = invitationEmail({ hostName, title: all[0].title, when: all[0].scheduledStart, link, description: all[0].description, timeZone: zones.get(to), series: all.length > 1 ? { count: all.length } : null });
      await sendMail({ to, ...mail, attachments: [{ filename: all.length > 1 ? 'lessons.ics' : 'class.ics', content: ics, contentType: ICS_TYPE(all.length > 1 ? 'PUBLISH' : 'REQUEST') }] });
    } catch (err) {
      logger.error({ err }, 'invitation email failed');
    }
  }
  await Meeting.updateMany({ _id: { $in: all.map((m) => m._id) } }, { $set: { noticeSentAt: new Date() } }).catch(() => {});
}

/** Tell the student a class moved. The calendar file updates the same entry (same UID, higher SEQUENCE). */
async function sendReschedule(meeting, previousStart, hostName) {
  const zones = await zonesFor(meeting.invitees).catch(() => new Map());
  const link = inviteUrlFor(meeting);
  const ics = buildIcs(meeting, { url: link, hostName, method: 'REQUEST' });
  for (const to of meeting.invitees) {
    try {
      const mail = rescheduleEmail({ hostName, title: meeting.title, when: meeting.scheduledStart, previous: previousStart, link, timeZone: zones.get(to) });
      await sendMail({ to, ...mail, attachments: [{ filename: 'class.ics', content: ics, contentType: ICS_TYPE('REQUEST') }] });
    } catch (err) {
      logger.error({ err }, 'reschedule email failed');
    }
  }
}

/** Tell the student lessons were cancelled; the calendar file (METHOD:CANCEL) removes them. */
async function sendCancellation(cancelled, hostName) {
  const first = cancelled[0];
  const to = first?.invitees?.[0];
  if (!to) return;
  try {
    const zones = await zonesFor([to]);
    const ics = buildIcsMany(
      cancelled.map((m) => ({ meeting: m, url: `${env.APP_URL}/m/${m.code}` })),
      { hostName },
    );
    const mail = cancellationEmail({ hostName, title: first.title, when: first.scheduledStart, count: cancelled.length, timeZone: zones.get(to) });
    await sendMail({ to, ...mail, attachments: [{ filename: 'cancelled.ics', content: ics, contentType: ICS_TYPE('CANCEL') }] });
  } catch (err) {
    logger.error({ err }, 'cancellation email failed');
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
  const weeks = input.type === 'scheduled' ? Math.max(1, input.repeatWeeks ?? 1) : 1;
  const seriesId = weeks > 1 ? randomToken(12) : undefined;
  const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : undefined;
  const invitees = normalizeInvitees(input.invitees).filter((e) => e !== user.email?.toLowerCase());
  const created = [];
  for (let i = 0; i < weeks; i += 1) {
    // Same wall-clock time every week in UTC terms (a daylight-saving change shifts it by an hour locally;
    // the teacher can move a single lesson).
    const at = new Date(start.getTime() + i * 7 * 86_400_000);
    created.push(
      await Meeting.create({
        code: await uniqueCode(),
        title: input.title || (input.type === 'instant' ? `${user.name}'s meeting` : 'Class'),
        description: input.description ?? '',
        host: user.id,
        type: input.type,
        scheduledStart: at,
        durationMinutes,
        scheduledEnd: new Date(at.getTime() + durationMinutes * 60_000),
        settings: {
          allowScreenShare: input.allowScreenShare ?? false,
          allowDrawing: input.allowDrawing ?? false,
          chatMode: input.chatMode ?? 'everyone',
          saveChat: input.saveChat ?? true,
          waitingRoom: input.waitingRoom ?? true,
          hasPassword: Boolean(input.password),
          passwordHash,
        },
        inviteNonce: randomToken(12),
        invitees,
        seriesId,
        seriesIndex: seriesId ? i : undefined,
      }),
    );
  }
  const [meeting] = created;
  audit('meeting.create', { actor: user.id, targetType: 'meeting', targetId: meeting._id, meta: { type: input.type, invitees: meeting.invitees.length, weeks } });
  const full = await Meeting.find({ _id: { $in: created.map((m) => m._id) } }).select('+inviteNonce').sort({ scheduledStart: 1 });
  sendInvitations(full[0], user.name, full[0].invitees, { series: full.length > 1 ? full : null });
  return full[0];
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
  const previousStart = meeting.scheduledStart;
  const previousDuration = meeting.durationMinutes;
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
  const moved = meeting.status === MEETING_STATUS.SCHEDULED && (meeting.scheduledStart.getTime() !== previousStart.getTime() || meeting.durationMinutes !== previousDuration);
  if (moved) meeting.reminderSentAt = null; // remind again before the new time
  await meeting.save();
  const hostName = actor?.name || meeting.host?.name || 'Your teacher';
  if (added.length) sendInvitations(meeting, hostName, added);
  const told = meeting.invitees.filter((e) => !added.includes(e));
  if (moved && told.length) {
    sendReschedule({ ...meeting.toObject(), _id: meeting._id, invitees: told, inviteNonce: meeting.inviteNonce }, previousStart, hostName);
    Meeting.updateOne({ _id: meeting._id }, { $set: { noticeSentAt: new Date() } }).catch(() => {});
  }
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

const lessonInfo = (m) => {
  const hw = m.lesson?.homework ?? [];
  return {
    seriesId: m.seriesId ?? null,
    seriesIndex: m.seriesIndex ?? null,
    hasLessonNotes: Boolean(m.lesson?.summary || hw.length),
    homeworkTotal: hw.length,
    homeworkOpen: hw.filter((h) => !h.done).length,
  };
};

function serializeForViewer(m, user) {
  return isHostOf(m, user.id)
    ? { ...serializeForHost(m), ...lessonInfo(m), isHost: true }
    : { ...serializeSummary(m), ...lessonInfo(m), id: String(m._id), status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, isHost: false, invited: Boolean(user.email && m.invitees?.includes(user.email.toLowerCase())) };
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

/**
 * Cancel a class, or this and every later lesson of its series (`scope: 'following'`). Only lessons
 * not yet started are cancelled; the student gets one email that removes them from their calendar.
 */
export async function cancelClasses(meeting, scope, actor) {
  if (meeting.status === MEETING_STATUS.LIVE) throw new AppError(409, 'meeting_live', 'End the live meeting instead of deleting it');
  let targets = [meeting];
  if (scope === 'following' && meeting.seriesId) {
    targets = await Meeting.find({ seriesId: meeting.seriesId, host: meeting.host._id ?? meeting.host, seriesIndex: { $gte: meeting.seriesIndex ?? 0 }, status: MEETING_STATUS.SCHEDULED }).sort({ scheduledStart: 1 });
  }
  const cancelled = [];
  for (const m of targets) {
    if (m.status !== MEETING_STATUS.SCHEDULED) continue;
    const after = await endMeeting(m, 'host_ended', actor.id);
    if (after?.status === MEETING_STATUS.CANCELLED) cancelled.push(after);
  }
  const upcoming = cancelled.filter((m) => m.type === 'scheduled' && m.scheduledEnd > new Date() && m.invitees?.length);
  if (upcoming.length) sendCancellation(upcoming, actor.name);
  return cancelled.length;
}

/** The lesson summary and homework, as both teacher and student see it. */
export const serializeLesson = (m) => ({
  summary: m.lesson?.summary || '',
  homework: (m.lesson?.homework ?? []).map((h) => ({ id: String(h._id), text: h.text, done: Boolean(h.done), doneAt: h.doneAt ?? null })),
  updatedAt: m.lesson?.updatedAt ?? null,
});

/**
 * The teacher writes the summary and homework. Items keep their ticks when the teacher edits around
 * them (matched by id); `notify` emails the student the notes.
 */
export async function saveLesson(meeting, { summary, homework, notify }, actor) {
  const prior = new Map((meeting.lesson?.homework ?? []).map((h) => [String(h._id), h]));
  meeting.lesson = {
    summary: summary ?? meeting.lesson?.summary ?? '',
    homework: (homework ?? []).map((h) => {
      const old = h.id && prior.get(h.id);
      return old ? { _id: old._id, text: h.text, done: old.done, doneAt: old.doneAt } : { text: h.text };
    }),
    updatedAt: new Date(),
  };
  await meeting.save();
  audit('meeting.lesson_saved', { actor: actor.id, targetType: 'meeting', targetId: meeting._id, meta: { homework: meeting.lesson.homework.length, notify: Boolean(notify) } });
  const to = meeting.invitees?.[0];
  if (notify && to) {
    const lesson = serializeLesson(meeting);
    sendMail({ to, ...lessonNotesEmail({ hostName: actor.name, title: meeting.title, summary: lesson.summary, homework: lesson.homework, link: `${env.APP_URL}/classes/${meeting.code}` }) }).catch((err) =>
      logger.error({ err }, 'lesson notes email failed'),
    );
  }
  return serializeLesson(meeting);
}

/** The student (or the teacher) ticks a piece of homework. */
export async function setHomeworkDone(meeting, itemId, done, actor) {
  // Read-modify-save (not a positional update): works on MongoDB and its compatible servers alike.
  const doc = await Meeting.findById(meeting._id);
  const item = doc?.lesson?.homework?.id(itemId);
  if (!item) throw notFound('That homework item no longer exists', 'homework_not_found');
  item.done = done;
  item.doneAt = done ? new Date() : null;
  await doc.save();
  audit('meeting.homework', { actor: actor.id, targetType: 'meeting', targetId: meeting._id, meta: { done } });
  return serializeLesson(doc);
}
