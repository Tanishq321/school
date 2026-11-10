import fs from 'node:fs';
import { audit } from '../services/auditService.js';
import * as recordings from '../services/recordingService.js';
import { signPlaybackToken, verifyPlaybackToken } from '../services/tokenService.js';
import Meeting from '../models/Meeting.js';
import Recording, { RECORDING_STATUS } from '../models/Recording.js';
import { AppError, notFound } from '../utils/errors.js';

const posterUrl = (userId, id) => `/api/recordings/${id}/poster?token=${signPlaybackToken({ userId, recordingId: id, ttlSeconds: 2 * 3600, scope: 'poster' })}`;

export async function list(req, res) {
  const items = await recordings.listForUser(req.user);
  res.json({ recordings: items.map((r) => (r.status === 'ready' ? { ...r, posterUrl: posterUrl(req.user.id, r.id) } : r)) });
}

export async function get(req, res) {
  const rec = await recordings.getViewable(req.valid.params.id, req.user);
  const mine = String(rec.host) === req.user.id;
  const meeting = await Meeting.findById(rec.meeting).select('title code scheduledStart').populate('host', 'name');
  const json = rec.toJSON();
  if (!mine) delete json.consent; // who agreed or declined is the host's business only
  res.json({
    recording: { ...json, posterUrl: rec.status === 'ready' ? posterUrl(req.user.id, rec._id) : undefined, mine, meetingTitle: meeting?.title, meetingCode: mine ? meeting?.code : undefined, hostName: meeting?.host?.name },
  });
}

export async function update(req, res) {
  const rec = await recordings.getViewable(req.valid.params.id, req.user);
  recordings.assertHost(rec, req.user);
  const { title, shareWithParticipants } = req.valid.body;
  if (title !== undefined) rec.title = title;
  if (shareWithParticipants !== undefined) rec.shareWithParticipants = shareWithParticipants;
  await rec.save();
  audit('recording.update', { actor: req.user.id, targetType: 'recording', targetId: rec._id, meta: req.valid.body });
  res.json({ recording: { ...rec.toJSON(), mine: true } });
}

export async function remove(req, res) {
  const rec = await recordings.getViewable(req.valid.params.id, req.user);
  recordings.assertHost(rec, req.user);
  if (rec.status === RECORDING_STATUS.RECORDING) throw new AppError(409, 'recording_live', 'Stop the recording first');
  await recordings.deleteRecording(rec, req.user.id);
  res.status(204).end();
}

/** Short-lived signed URLs for <video>/<img>, which cannot send Authorization headers. */
export async function playback(req, res) {
  const rec = await recordings.getViewable(req.valid.params.id, req.user);
  if (rec.status !== RECORDING_STATUS.READY) throw new AppError(409, 'not_ready', 'This recording is still being prepared');
  const ttlSeconds = Math.min(12 * 3600, Math.max(2 * 3600, (rec.durationSec || 0) * 2 + 1800));
  const token = signPlaybackToken({ userId: req.user.id, recordingId: rec._id, ttlSeconds });
  const base = `/api/recordings/${rec._id}`;
  audit('recording.view', { actor: req.user.id, targetType: 'recording', targetId: rec._id });
  res.json({
    mediaUrl: `${base}/media?token=${token}`,
    downloadUrl: `${base}/media?token=${token}&download=1`,
    posterUrl: `${base}/poster?token=${token}`,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  });
}

/** Loads the recording for a token-authenticated media request and re-checks it is still shareable. */
async function tokenRecording(req, scope) {
  const { id } = req.valid.params;
  const claims = verifyPlaybackToken(req.valid.query.token, id, { scope });
  const rec = await Recording.findById(id).select('+file +thumbnail');
  if (!rec || rec.status !== RECORDING_STATUS.READY) throw notFound('Recording not found');
  if (String(rec.host) !== claims.sub && !rec.shareWithParticipants) throw notFound('Recording not found');
  return rec;
}

const mediaHeaders = (res) => {
  res.set('Cache-Control', 'private, max-age=600');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin'); // the web app may live on another origin
  res.set('X-Content-Type-Options', 'nosniff');
};

/** HTTP Range streaming, so the player can seek without downloading the whole class. */
export async function media(req, res) {
  const rec = await tokenRecording(req, 'media');
  const file = recordings.safePath(rec.file);
  const stat = file && (await fs.promises.stat(file).catch(() => null));
  if (!stat) throw notFound('Recording file is missing');
  mediaHeaders(res);
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', 'video/mp4');
  if (req.valid.query.download) {
    const name = `${(rec.title || 'class').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'class'} ${rec.startedAt.toISOString().slice(0, 10)}.mp4`;
    res.set('Content-Disposition', `attachment; filename="${name}"`);
  }
  const size = stat.size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
  let start = 0;
  let end = size - 1;
  if (range) {
    if (range[1] === '' && range[2] !== '') {
      start = Math.max(0, size - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== '') end = Math.min(Number(range[2]), size - 1);
    }
    if (Number.isNaN(start) || start >= size || start > end) {
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.set('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

export async function poster(req, res) {
  const rec = await tokenRecording(req, 'poster');
  const file = recordings.safePath(rec.thumbnail);
  if (!file || !fs.existsSync(file)) throw notFound('No poster for this recording');
  mediaHeaders(res);
  res.type('image/jpeg');
  fs.createReadStream(file).pipe(res);
}
