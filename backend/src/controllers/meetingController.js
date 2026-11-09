import * as meetings from '../services/meetingService.js';
import * as attendance from '../services/attendanceService.js';
import { signJoinToken } from '../services/tokenService.js';
import { getIceServers } from '../services/turnService.js';
import { getMemberSocket, publicMember, rooms } from '../sockets/realtime.js';
import { AppError, forbidden } from '../utils/errors.js';
import { audit } from '../services/auditService.js';

export async function create(req, res) {
  const meeting = await meetings.createMeeting(req.user, req.valid.body);
  res.status(201).json({ meeting: { ...meetings.serializeForHost(meeting), isHost: true } });
}

export async function list(req, res) {
  res.json({ meetings: await meetings.listForUser(req.user, req.valid.query.scope) });
}

export async function get(req, res) {
  const meeting = await meetings.getByCode(req.valid.params.code, { withSecrets: true });
  const isHost = String(meeting.host._id) === req.user.id;
  res.json({ meeting: isHost ? { ...meetings.serializeForHost(meeting), isHost } : { ...meetings.serializeSummary(meeting), isHost } });
}

export async function update(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  const updated = await meetings.updateMeeting(meeting, req.valid.body);
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
  res.json({ participants: room ? [...room.members.values()].map(publicMember) : [] });
}

export async function attendanceReport(req, res) {
  const meeting = await meetings.getForHost(req.valid.params.code, req.user);
  res.json({ meeting: { code: meeting.code, title: meeting.title, startedAt: meeting.startedAt, endedAt: meeting.endedAt }, attendance: await attendance.summarize(meeting._id) });
}

export function iceForDiagnostics(req, res) {
  res.json(getIceServers(req.user.id));
}
