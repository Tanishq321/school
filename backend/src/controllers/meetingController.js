import * as meetings from '../services/meetingService.js';
import * as attendance from '../services/attendanceService.js';
import { signJoinToken, signPlaybackToken } from '../services/tokenService.js';
import { getIceServers } from '../services/turnService.js';
import { getMemberSocket, publicMember, rooms } from '../sockets/realtime.js';
import { AppError, forbidden } from '../utils/errors.js';
import { audit } from '../services/auditService.js';
import { buildIcs } from '../services/calendarService.js';
import * as recordings from '../services/recordingService.js';
import ChatMessage from '../models/ChatMessage.js';
import env from '../config/env.js';

export async function create(req, res) {
  const meeting = await meetings.createMeeting(req.user, req.valid.body);
  res.status(201).json({ meeting: { ...meetings.serializeForHost(meeting), isHost: true } });
}

export async function list(req, res) {
  const { scope, from, to } = req.valid.query;
  res.json({ meetings: await meetings.listForUser(req.user, scope, { from, to }) });
}

export async function get(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code, { withSecrets: true });
  const isHost = String(meeting.host._id) === req.user.id;
  res.json({ meeting: isHost ? { ...meetings.serializeForHost(meeting), isHost } : { ...meetings.serializeSummary(meeting), isHost } });
}

export async function update(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  const updated = await meetings.updateMeeting(meeting, req.valid.body, req.user);
  audit('meeting.update', { actor: req.user.id, targetType: 'meeting', targetId: meeting._id, meta: { fields: Object.keys(req.valid.body) } });
  res.json({ meeting: { ...meetings.serializeForHost(updated), isHost: true } });
}

export async function join(req, res) {
  const { meeting, isHost } = await meetings.authorizeJoin(req.user, req.valid.params.code, req.valid.body);
  res.json({
    joinToken: signJoinToken({ userId: req.user.id, meetingId: meeting._id, isHost }),
    ...getIceServers(req.user.id),
    meeting: { ...meetings.serializeSummary(meeting), id: String(meeting._id), isHost },
  });
}

export async function leave(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code);
  // The user's own live session is told to leave; it then emits meeting:leave, which closes attendance.
  getMemberSocket(meeting._id, req.user.id)?.emit('meeting:force-leave');
  res.status(204).end();
}

export async function end(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  const updated = await meetings.endMeeting(meeting, 'host_ended', req.user.id);
  res.json({ meeting: { ...meetings.serializeSummary(updated), status: updated.status } });
}

export async function cancel(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  if (meeting.status === 'live') throw new AppError(409, 'meeting_live', 'End the live meeting instead of deleting it');
  await meetings.endMeeting(meeting, 'host_ended', req.user.id);
  res.status(204).end();
}

export async function participants(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code);
  const room = rooms.get(String(meeting._id));
  const isHost = String(meeting.host._id) === req.user.id;
  if (!isHost && !room?.members.has(req.user.id)) throw forbidden('Join the meeting to see participants');
  res.json({ participants: room ? [...room.members.values()].map((m) => publicMember(m)) : [] });
}

export async function attendanceReport(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  res.json({ meeting: { code: meeting.code, title: meeting.title, startedAt: meeting.startedAt, endedAt: meeting.endedAt }, attendance: await attendance.summarize(meeting._id) });
}

export function iceForDiagnostics(req, res) {
  res.json(getIceServers(req.user.id));
}

/** The host's private notes for a class. */
export async function saveNotes(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  meeting.notes = req.valid.body.notes;
  await meeting.save();
  res.json({ notes: meeting.notes, savedAt: new Date() });
}

/** Everything about one class in one place: the class page and its history. */
export async function summary(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code, { withSecrets: true });
  if (!(await meetings.canSeeMeeting(meeting, req.user))) throw forbidden('This class is not on your calendar');
  const isHost = meetings.isHostOf(meeting, req.user.id);
  const recs = (await recordings.listForUser(req.user, { meetingId: meeting._id }))
    .filter((r) => r.mine || r.status === 'ready')
    .map((r) => (r.status === 'ready' ? { ...r, posterUrl: `/api/recordings/${r.id}/poster?token=${signPlaybackToken({ userId: req.user.id, recordingId: r.id, ttlSeconds: 7200, scope: 'poster' })}` } : r));
  const out = { meeting: meetings.serializeForViewer(meeting, req.user), recordings: recs };
  if (isHost) {
    const [attendanceRows, chat, guests] = await Promise.all([
      attendance.summarize(meeting._id),
      ChatMessage.find({ meeting: meeting._id, deletedAt: null }).sort({ createdAt: 1 }).limit(2000).lean(),
      meetings.inviteeDirectory(meeting),
    ]);
    out.notes = meeting.notes || '';
    out.attendance = attendanceRows;
    out.guests = guests;
    out.transcript = chat.map((m) => ({ id: String(m._id), name: m.senderName, isHost: m.senderIsHost, text: m.text, at: m.createdAt }));
  }
  res.json(out);
}

/** Download an .ics so the class lands in Apple/Google/Outlook calendars. */
export async function ics(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code, { withSecrets: true });
  if (!(await meetings.canSeeMeeting(meeting, req.user))) throw forbidden('This class is not on your calendar');
  const isHost = meetings.isHostOf(meeting, req.user.id);
  const url = isHost ? meetings.inviteUrlFor(meeting) : `${env.APP_URL}/m/${meeting.code}`;
  const body = buildIcs(meeting, { url, hostName: meeting.host?.name });
  const name = (meeting.title || 'class').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'class';
  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}.ics"`);
  res.set('Cache-Control', 'no-store');
  res.send(body);
}
