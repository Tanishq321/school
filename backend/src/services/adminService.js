import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';
import Attendance from '../models/Attendance.js';
import AuditLog from '../models/AuditLog.js';
import Meeting, { MEETING_STATUS } from '../models/Meeting.js';
import Recording, { RECORDING_STATUS } from '../models/Recording.js';
import RefreshToken from '../models/RefreshToken.js';
import User from '../models/User.js';
import { getIo, rooms } from '../sockets/realtime.js';
import { AppError, badRequest, notFound } from '../utils/errors.js';
import { audit } from './auditService.js';
import { endMeeting } from './meetingService.js';
import { snapshot } from './metrics.js';

/**
 * Administration. Deliberately limited to accounts, schedules and system health:
 * administrators never see chat, notes, whiteboards or recordings of a class.
 */
const DAY = 86_400_000;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function perDay(dates, days, now) {
  const start = new Date(now - (days - 1) * DAY);
  start.setUTCHours(0, 0, 0, 0);
  const out = Array.from({ length: days }, (_, i) => ({ day: new Date(start.getTime() + i * DAY).toISOString().slice(0, 10), n: 0 }));
  for (const d of dates) {
    const i = Math.floor((new Date(d).getTime() - start.getTime()) / DAY);
    if (i >= 0 && i < days) out[i].n += 1;
  }
  return out;
}

export async function overview(now = Date.now()) {
  const since14 = new Date(now - 14 * DAY);
  const since7 = new Date(now - 7 * DAY);
  const [teachers, students, admins, suspended, twoFactor, classesTotal, classesLive, upcoming, recordings, signups, held, minutes, failed] = await Promise.all([
    User.countDocuments({ role: 'teacher' }),
    User.countDocuments({ role: 'student' }),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ status: 'suspended' }),
    User.countDocuments({ 'twoFactor.enabled': true }),
    Meeting.countDocuments({ status: { $in: [MEETING_STATUS.ENDED, MEETING_STATUS.LIVE] } }),
    Meeting.countDocuments({ status: MEETING_STATUS.LIVE }),
    Meeting.countDocuments({ status: MEETING_STATUS.SCHEDULED, scheduledStart: { $gt: new Date(now) } }),
    Recording.find({ status: { $in: [RECORDING_STATUS.READY, RECORDING_STATUS.PROCESSING, RECORDING_STATUS.RECORDING] } }).select('sizeBytes status durationSec').lean(),
    User.find({ createdAt: { $gte: since14 } }).select('createdAt').limit(5000).lean(),
    Meeting.find({ startedAt: { $gte: since14 } }).select('startedAt').limit(5000).lean(),
    Attendance.find({ joinedAt: { $gte: since7 }, role: { $ne: 'host' } }).select('durationSec').limit(20000).lean(),
    AuditLog.countDocuments({ action: { $in: ['auth.login_failed', 'auth.2fa_failed'] }, createdAt: { $gte: new Date(now - DAY) } }),
  ]);
  let disk = null;
  try {
    const dir = path.resolve(env.RECORDINGS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const s = await fs.statfs(dir);
    disk = { freeMb: Math.round((s.bavail * s.bsize) / 1048576), totalMb: Math.round((s.blocks * s.bsize) / 1048576) };
  } catch {
    /* statfs unavailable */
  }
  const live = [...rooms.values()]
    .filter((r) => r.members.size > 0)
    .map((r) => {
      const host = [...r.members.values()].find((m) => m.isHost);
      const since = Math.min(...[...r.members.values()].map((m) => new Date(m.joinedAt).getTime()));
      // No title, code or content: an administrator only sees that a class is in session.
      return { id: r.meetingId, teacher: host?.name ?? null, people: r.members.size, waiting: r.waiting.size, recording: Boolean(r.recording), since: new Date(since), mode: r.mode };
    });
  return {
    people: { teachers, students, admins, suspended, twoFactor },
    classes: { held: classesTotal, live: classesLive, upcoming, hoursTaught7d: Math.round(minutes.reduce((a, m) => a + (m.durationSec || 0), 0) / 360) / 10 },
    recordings: {
      count: recordings.length,
      bytes: recordings.reduce((a, r) => a + (r.sizeBytes || 0), 0),
      hours: Math.round(recordings.reduce((a, r) => a + (r.durationSec || 0), 0) / 360) / 10,
      processing: recordings.filter((r) => r.status === RECORDING_STATUS.PROCESSING).length,
      enabled: env.RECORDING_ENABLED,
      retentionDays: env.RECORDING_RETENTION_DAYS,
    },
    security: { failedSignIns24h: failed },
    series: { signups: perDay(signups.map((u) => u.createdAt), 14, now), classes: perDay(held.map((m) => m.startedAt), 14, now) },
    live,
    system: { ...snapshot(getIo()), disk, turnConfigured: env.TURN_URLS.length > 0, smtpConfigured: Boolean(env.SMTP_HOST), version: process.env.npm_package_version },
  };
}

const publicUser = (u) => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  emailVerified: u.emailVerified,
  twoFactor: Boolean(u.twoFactor?.enabled),
  locked: Boolean(u.lockedUntil && u.lockedUntil > new Date()),
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

export async function listUsers({ q, role, status, page = 1, limit = 25 }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (q) filter.$or = [{ name: { $regex: esc(q), $options: 'i' } }, { email: { $regex: esc(q), $options: 'i' } }];
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).select('+lockedUntil').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / limit)), users: users.map(publicUser) };
}

/** Sign a user out of every device and drop their live connections. */
export async function revokeAllSessions(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await User.updateOne({ _id: userId }, { $set: { sessionsValidAfter: new Date() } });
  const io = getIo();
  if (io) for (const s of io.sockets.sockets.values()) if (s.data.user?.id === String(userId)) s.disconnect(true);
}

export async function updateUser(admin, userId, { status, role, unlock }, ctx = {}) {
  const user = await User.findById(userId).select('+lockedUntil');
  if (!user) throw notFound('Account not found');
  if (String(user._id) === admin.id && (status === 'suspended' || (role && role !== 'admin'))) {
    throw badRequest('You cannot suspend or demote your own account. Ask another administrator.');
  }
  const losingAdmin = user.role === 'admin' && user.status === 'active' && (status === 'suspended' || (role && role !== 'admin'));
  if (losingAdmin && (await User.countDocuments({ role: 'admin', status: 'active' })) <= 1) {
    throw new AppError(409, 'last_admin', 'This is the only active administrator.');
  }
  const changes = {};
  if (status && status !== user.status) changes.status = status;
  if (role && role !== user.role) changes.role = role;
  if (changes.status) user.status = changes.status;
  if (changes.role) user.role = changes.role;
  if (unlock) {
    user.lockedUntil = undefined;
    user.failedLogins = 0;
    changes.unlock = true;
  }
  await user.save();
  // A suspended or re-roled account must not keep working on old credentials.
  if (changes.status === 'suspended' || changes.role) await revokeAllSessions(user._id);
  if (Object.keys(changes).length) audit('admin.user_update', { actor: admin.id, targetType: 'user', targetId: user._id, ip: ctx.ip, meta: changes });
  return publicUser(user);
}

export async function forceSignOut(admin, userId, ctx = {}) {
  if (!(await User.exists({ _id: userId }))) throw notFound('Account not found');
  await revokeAllSessions(userId);
  audit('admin.user_sign_out', { actor: admin.id, targetType: 'user', targetId: userId, ip: ctx.ip });
}

/** Class metadata only: who, when, how long, how many. Never titles' contents, chat, notes or media. */
export async function listClasses({ status, page = 1, limit = 25 }) {
  const filter = status ? { status } : {};
  const [total, items] = await Promise.all([
    Meeting.countDocuments(filter),
    Meeting.find(filter).populate('host', 'name email').sort({ scheduledStart: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  const ids = items.map((m) => m._id);
  const [att, recs] = await Promise.all([
    Attendance.find({ meeting: { $in: ids }, role: { $ne: 'host' } }).select('meeting user').lean(),
    Recording.find({ meeting: { $in: ids }, status: { $ne: RECORDING_STATUS.DELETED } }).select('meeting').lean(),
  ]);
  const students = new Map();
  for (const a of att) (students.get(String(a.meeting)) || students.set(String(a.meeting), new Set()).get(String(a.meeting))).add(String(a.user));
  const recCount = new Map();
  for (const r of recs) recCount.set(String(r.meeting), (recCount.get(String(r.meeting)) || 0) + 1);
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    classes: items.map((m) => ({
      id: String(m._id),
      teacher: m.host ? { name: m.host.name, email: m.host.email } : null,
      status: m.status,
      scheduledStart: m.scheduledStart,
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      durationMinutes: m.durationMinutes,
      attended: students.get(String(m._id))?.size ?? 0,
      recordings: recCount.get(String(m._id)) ?? 0,
      inRoom: rooms.get(String(m._id))?.members.size ?? 0,
    })),
  };
}

export async function endClass(admin, meetingId, ctx = {}) {
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw notFound('Class not found');
  if (![MEETING_STATUS.LIVE, MEETING_STATUS.SCHEDULED].includes(meeting.status)) throw new AppError(409, 'meeting_closed', 'This class is already closed');
  await endMeeting(meeting, 'admin', admin.id);
  audit('admin.class_end', { actor: admin.id, targetType: 'meeting', targetId: meetingId, ip: ctx.ip });
}

export async function listAudit({ action, actor, from, to, page = 1, limit = 50 }) {
  const filter = {};
  if (action) filter.action = { $regex: `^${esc(action)}` };
  if (actor) filter.actor = actor;
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name email role').lean(),
  ]);
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    logs: logs.map((l) => ({
      id: String(l._id),
      at: l.createdAt,
      action: l.action,
      actor: l.actor ? { id: String(l.actor._id), name: l.actor.name, email: l.actor.email, role: l.actor.role } : null,
      targetType: l.targetType,
      targetId: l.targetId,
      ip: l.ip,
      meta: l.meta,
    })),
  };
}
