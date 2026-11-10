import fs from 'node:fs/promises';
import path from 'node:path';
import env from '../config/env.js';
import Attendance from '../models/Attendance.js';
import Meeting from '../models/Meeting.js';
import Recording, { RECORDING_STATUS } from '../models/Recording.js';
import { Recorder } from '../recording/recorder.js';
import { compose, probe, thumbnail } from '../recording/composer.js';
import { AppError, forbidden, notFound } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { audit } from './auditService.js';

const root = () => path.resolve(env.RECORDINGS_DIR);
export const recordingDir = (id) => path.join(root(), String(id));

/** Resolve a stored relative path, refusing anything that escapes the recordings directory. */
export function safePath(rel) {
  if (!rel) return null;
  const full = path.resolve(root(), rel);
  if (!full.startsWith(root() + path.sep)) return null;
  return full;
}

export function recordingAvailability(room) {
  if (!env.RECORDING_ENABLED) return { available: false, reason: 'Recording is turned off on this server.' };
  if (room && room.mode !== 'sfu') return { available: false, reason: 'Recording needs the media server (group mode).' };
  return { available: true };
}

// ------------------------------------------------------------------------------ live state

/** What a participant needs to know about the recording right now. */
export function recordingState(room, userId) {
  const r = room.recording;
  if (!r) return { active: false, ...recordingAvailability(room) };
  return {
    active: true,
    id: r.id,
    startedAt: r.startedAt,
    startedBy: r.startedByName,
    myConsent: userId ? r.consent.get(userId) ?? 'pending' : undefined,
    ...recordingAvailability(room),
  };
}

/** Host view: who agreed, who declined, who has not answered yet. */
export function consentSummary(room) {
  const r = room.recording;
  if (!r) return [];
  return [...room.members.values()].map((m) => ({ userId: m.userId, name: m.name, decision: r.consent.get(m.userId) ?? 'pending' }));
}

function broadcast(io, room) {
  if (!io) return;
  const state = recordingState(room);
  for (const m of room.members.values()) {
    if (m.socketId) io.to(m.socketId).emit('recording:state', { ...state, myConsent: room.recording ? room.recording.consent.get(m.userId) ?? 'pending' : undefined });
  }
  io.to(room.hostKey).emit('recording:consents', { consents: consentSummary(room) });
}

async function persistConsent(room) {
  const r = room.recording;
  if (!r) return;
  const consent = [...r.consent.entries()]
    .filter(([, d]) => d !== 'pending')
    .map(([user, decision]) => ({ user, decision, name: r.names.get(user), at: r.decidedAt.get(user) }));
  await Recording.updateOne({ _id: r.id }, { $set: { consent } }).catch((err) => logger.error({ err }, 'consent persist failed'));
}

async function hasDiskSpace() {
  if (!env.RECORDING_MIN_FREE_MB) return true;
  try {
    await fs.mkdir(root(), { recursive: true });
    const s = await fs.statfs(root());
    return (s.bavail * s.bsize) / 1048576 >= env.RECORDING_MIN_FREE_MB;
  } catch {
    return true;
  }
}

/** Host starts recording. The host's own consent is implied; everyone else is asked. */
export async function startRecording(io, room, host) {
  const avail = recordingAvailability(room);
  if (!avail.available) throw new AppError(409, 'recording_unavailable', avail.reason);
  if (room.recording) throw new AppError(409, 'already_recording', 'This class is already being recorded');
  if (room.recordingStarting) throw new AppError(409, 'already_recording', 'Recording is starting');
  if (!(await hasDiskSpace())) throw new AppError(507, 'storage_full', 'The server is low on storage, so recording cannot start.');
  room.recordingStarting = true;
  try {
    const meeting = await Meeting.findById(room.meetingId).select('title host');
    const startedAt = new Date();
    const doc = await Recording.create({
      meeting: room.meetingId,
      host: meeting.host,
      startedBy: host.userId,
      title: meeting.title,
      status: RECORDING_STATUS.RECORDING,
      startedAt,
    });
    const id = String(doc._id);
    const r = {
      id,
      startedAt,
      startedByName: host.name,
      consent: new Map([[host.userId, 'accepted']]),
      names: new Map([[host.userId, host.name]]),
      decidedAt: new Map([[host.userId, startedAt]]),
      recorder: null,
      maxTimer: null,
    };
    for (const m of room.members.values()) {
      if (!r.consent.has(m.userId)) r.consent.set(m.userId, 'pending');
      r.names.set(m.userId, m.name);
    }
    room.recording = r;
    try {
      r.recorder = new Recorder({ room, dir: recordingDir(id) });
      await r.recorder.start();
    } catch (err) {
      room.recording = null;
      await Recording.updateOne({ _id: id }, { $set: { status: RECORDING_STATUS.FAILED, error: 'Could not start the recorder', endedAt: new Date() } });
      await fs.rm(recordingDir(id), { recursive: true, force: true });
      logger.error({ err }, 'recorder failed to start');
      throw new AppError(500, 'recording_failed', 'The recorder could not start. Please try again.');
    }
    r.maxTimer = setTimeout(() => {
      stopRecording(io, room, { reason: 'time_limit' }).catch((err) => logger.error({ err }, 'auto stop failed'));
    }, env.RECORDING_MAX_MINUTES * 60_000);
    r.maxTimer.unref?.();
    await persistConsent(room);
    audit('recording.start', { actor: host.userId, targetType: 'recording', targetId: id, meta: { meeting: room.meetingId } });
    broadcast(io, room);
    return recordingState(room, host.userId);
  } finally {
    room.recordingStarting = false;
  }
}

/** A participant answers the consent prompt (or changes their mind later). */
export async function setConsent(io, room, member, accept) {
  const r = room.recording;
  if (!r) throw new AppError(409, 'not_recording', 'This class is not being recorded');
  if (member.userId === room.hostId && !accept) throw new AppError(400, 'host_must_consent', 'Stop the recording instead.');
  const decision = accept ? 'accepted' : 'declined';
  r.consent.set(member.userId, decision);
  r.names.set(member.userId, member.name);
  r.decidedAt.set(member.userId, new Date());
  r.recorder?.schedule(0);
  await persistConsent(room);
  audit(`recording.consent.${decision}`, { actor: member.userId, targetType: 'recording', targetId: r.id });
  if (io) io.to(room.hostKey).emit('recording:consents', { consents: consentSummary(room) });
  return recordingState(room, member.userId);
}

/** Somebody joined while recording: they start as 'pending' (not captured) until they answer. */
export function onMemberJoined(room, member) {
  const r = room.recording;
  if (!r) return;
  if (!r.consent.has(member.userId)) r.consent.set(member.userId, 'pending');
  r.names.set(member.userId, member.name);
  r.recorder?.schedule();
}

/** Stop capturing and queue the final file. Safe to call when nothing is recording. */
export async function stopRecording(io, room, { by, reason = 'host_stopped' } = {}) {
  const r = room.recording;
  if (!r) return null;
  room.recording = null;
  clearTimeout(r.maxTimer);
  broadcast(io, room);
  if (io) io.to(room.key).emit('recording:stopped', { id: r.id, reason });
  let manifest = null;
  try {
    manifest = await r.recorder.stop();
  } catch (err) {
    logger.error({ err, rec: r.id }, 'recorder stop failed');
  }
  const endedAt = new Date();
  const hasMedia = manifest && (manifest.audio.some((a) => a.packets > 0) || manifest.video.some((v) => v.frames > 0));
  await Recording.updateOne(
    { _id: r.id },
    hasMedia
      ? { $set: { status: RECORDING_STATUS.PROCESSING, endedAt } }
      : { $set: { status: RECORDING_STATUS.FAILED, endedAt, error: 'Nothing was captured: nobody had agreed to be recorded, or no audio/video was flowing.' } },
  );
  audit('recording.stop', { actor: by, targetType: 'recording', targetId: r.id, meta: { reason } });
  if (hasMedia) enqueue(r.id);
  else await fs.rm(recordingDir(r.id), { recursive: true, force: true });
  return { id: r.id };
}

// ------------------------------------------------------------------------------ processing

const queue = [];
let busy = false;
const listeners = new Set();
/** Tests and the socket layer can observe when a recording finishes processing. */
export const onProcessed = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function enqueue(id) {
  if (!queue.includes(id)) queue.push(id);
  pump();
}

async function pump() {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  busy = true;
  try {
    await processRecording(id);
  } finally {
    busy = false;
    setImmediate(pump);
  }
}

async function processRecording(id) {
  const dir = recordingDir(id);
  let status = RECORDING_STATUS.FAILED;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const out = path.join(dir, 'recording.mp4');
    const started = Date.now();
    await compose(dir, manifest, out);
    const info = await probe(out);
    const thumbFile = path.join(dir, 'poster.jpg');
    await thumbnail(out, thumbFile, info.durationSec).catch(() => null);
    const hasThumb = await fs.stat(thumbFile).then(() => true, () => false);
    // Raw tracks are no longer needed once the final file exists.
    for (const t of [...manifest.audio, ...manifest.video]) await fs.rm(path.join(dir, t.file), { force: true });
    await Recording.updateOne(
      { _id: id, status: RECORDING_STATUS.PROCESSING },
      {
        $set: {
          status: RECORDING_STATUS.READY,
          file: path.relative(root(), out),
          thumbnail: hasThumb ? path.relative(root(), thumbFile) : undefined,
          durationSec: info.durationSec,
          sizeBytes: info.sizeBytes,
          segments: manifest.timeline.length,
        },
      },
    );
    status = RECORDING_STATUS.READY;
    logger.info({ rec: id, ms: Date.now() - started, sec: info.durationSec }, 'recording ready');
  } catch (err) {
    logger.error({ err, rec: id }, 'recording processing failed');
    await Recording.updateOne({ _id: id }, { $set: { status: RECORDING_STATUS.FAILED, error: 'Processing failed' } }).catch(() => {});
  }
  for (const fn of listeners) fn({ id, status });
}

/** On boot: recordings interrupted by a restart either resume processing or are marked failed. */
export async function recoverRecordings() {
  const interrupted = await Recording.find({ status: RECORDING_STATUS.RECORDING }).select('_id');
  for (const r of interrupted) {
    await Recording.updateOne({ _id: r._id }, { $set: { status: RECORDING_STATUS.FAILED, error: 'The server restarted while this class was being recorded.', endedAt: new Date() } });
    await fs.rm(recordingDir(r._id), { recursive: true, force: true });
  }
  const pending = await Recording.find({ status: RECORDING_STATUS.PROCESSING }).select('_id');
  for (const r of pending) enqueue(String(r._id));
}

// ------------------------------------------------------------------------------ library & access

/** Can this user watch the recording? Host always; attendees/invitees only if the host shared it. */
export async function canView(rec, user) {
  if (String(rec.host) === user.id) return true;
  if (!rec.shareWithParticipants) return false;
  const meeting = await Meeting.findById(rec.meeting).select('invitees host');
  if (!meeting) return false;
  if (user.email && meeting.invitees?.includes(user.email.toLowerCase())) return true;
  return Boolean(await Attendance.exists({ meeting: rec.meeting, user: user.id }));
}

export async function getViewable(id, user, { withFiles = false } = {}) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) throw notFound('Recording not found');
  const q = Recording.findById(id);
  if (withFiles) q.select('+file +thumbnail');
  const rec = await q;
  if (!rec || rec.status === RECORDING_STATUS.DELETED) throw notFound('Recording not found');
  if (!(await canView(rec, user))) throw notFound('Recording not found'); // don't reveal existence
  return rec;
}

export async function listForUser(user, { meetingId } = {}) {
  const filter = { status: { $ne: RECORDING_STATUS.DELETED } };
  if (meetingId) filter.meeting = meetingId;
  const own = await Recording.find({ ...filter, host: user.id }).sort({ startedAt: -1 }).limit(200);
  // Recordings shared with me: classes I attended or was invited to.
  const attended = await Attendance.distinct('meeting', { user: user.id });
  const invited = user.email ? await Meeting.find({ invitees: user.email.toLowerCase() }).distinct('_id') : [];
  const meetingIds = [...new Set([...attended, ...invited].map(String))];
  const shared = meetingIds.length
    ? await Recording.find({ ...filter, host: { $ne: user.id }, shareWithParticipants: true, status: RECORDING_STATUS.READY, meeting: { $in: meetingIds } })
        .sort({ startedAt: -1 })
        .limit(200)
    : [];
  const meetings = await Meeting.find({ _id: { $in: [...own, ...shared].map((r) => r.meeting) } }).select('title code host scheduledStart startedAt');
  const byId = new Map(meetings.map((m) => [String(m._id), m]));
  const decorate = (r, mine) => {
    const m = byId.get(String(r.meeting));
    return { ...r.toJSON(), mine, meetingTitle: m?.title, meetingCode: mine ? m?.code : undefined };
  };
  return [...own.map((r) => decorate(r, true)), ...shared.map((r) => decorate(r, false))].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export async function deleteRecording(rec, actorId, reason = 'deleted_by_host') {
  await fs.rm(recordingDir(rec._id), { recursive: true, force: true });
  await Recording.updateOne({ _id: rec._id }, { $set: { status: RECORDING_STATUS.DELETED, deletedAt: new Date() }, $unset: { file: 1, thumbnail: 1 } });
  audit('recording.delete', { actor: actorId, targetType: 'recording', targetId: rec._id, meta: { reason } });
}

export function assertHost(rec, user) {
  if (String(rec.host) !== user.id) throw forbidden('Only the host can change this recording');
}

/** Removes recordings older than RECORDING_RETENTION_DAYS. */
export async function retentionSweep(now = Date.now()) {
  const cutoff = new Date(now - env.RECORDING_RETENTION_DAYS * 86_400_000);
  const old = await Recording.find({ status: { $in: [RECORDING_STATUS.READY, RECORDING_STATUS.FAILED] }, startedAt: { $lt: cutoff } }).select('_id host');
  for (const rec of old) await deleteRecording(rec, undefined, 'retention');
  return old.length;
}

export function startRecordingJobs() {
  recoverRecordings().catch((err) => logger.error({ err }, 'recording recovery failed'));
  const t = setInterval(() => retentionSweep().catch((err) => logger.error({ err }, 'retention sweep failed')), 60 * 60_000);
  t.unref();
  return () => clearInterval(t);
}
