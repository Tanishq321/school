/**
 * Live, in-memory meeting state shared by the socket layer and REST controllers.
 *
 * Scaling note: this registry is per-process. Running several backend instances requires
 * sticky sessions, meeting → instance affinity and the Socket.IO Redis adapter (Phase 6).
 */
import * as attendance from '../services/attendanceService.js';
import { workerPool } from '../mediasoup/workerPool.js';
import { SfuRoom } from '../mediasoup/sfuRoom.js';
import { AppError } from '../utils/errors.js';

export const rooms = new Map(); // meetingId -> Room
let ioRef = null;

export const setIo = (io) => {
  ioRef = io;
};
export const getIo = () => ioRef;

export class Room {
  constructor(meeting) {
    this.meetingId = String(meeting._id);
    this.code = meeting.code;
    this.hostId = String(meeting.host);
    this.members = new Map(); // userId -> Member
    this.waiting = new Map(); // userId -> { userId, name, socketId, reason, since }
    this.admitted = new Set(); // userIds approved at least once (no re-approval after reconnect)
    this.emptySince = Date.now();
    this.settings = { waitingRoom: true, maxParticipants: 2 };
    // 'sfu' when mediasoup is running on this server, otherwise 1-to-1 peer-to-peer.
    this.mode = workerPool.ready ? 'sfu' : 'p2p';
    this.sfu = null;
    this._sfuPromise = null;
    this.locked = Boolean(meeting.locked);
    this.banned = new Set();
    this.permissions = { allowSelfUnmute: meeting.settings?.allowSelfUnmute ?? true };
  }

  /** Lazily create the mediasoup router (on the least-loaded worker) the first time someone needs it. */
  async getSfu() {
    if (this.mode !== 'sfu') throw new AppError(409, 'not_sfu', 'This meeting does not use the media server');
    if (this.sfu && !this.sfu.closed) return this.sfu;
    if (!this._sfuPromise) {
      this._sfuPromise = SfuRoom.create(this.meetingId, {
        toRoom: (event, data) => ioRef?.to(this.key).emit(event, data),
        toUser: (userId, event, data) => {
          const m = this.members.get(userId);
          if (m?.socketId) ioRef?.to(m.socketId).emit(event, data);
        },
      })
        .then((sfu) => {
          this.sfu = sfu;
          return sfu;
        })
        .finally(() => {
          this._sfuPromise = null;
        });
    }
    return this._sfuPromise;
  }

  canSpeak(member) {
    return member.isHost || this.permissions.allowSelfUnmute || Boolean(member.speakGranted);
  }

  get key() {
    return `meeting:${this.meetingId}`;
  }

  get hostKey() {
    return `meeting:${this.meetingId}:hosts`;
  }
}

export function getOrCreateRoom(meeting) {
  const id = String(meeting._id);
  let room = rooms.get(id);
  if (!room) {
    room = new Room(meeting);
    rooms.set(id, room);
  }
  return room;
}

export const publicMember = (m, room) => ({
  userId: m.userId,
  name: m.name,
  role: m.role,
  isHost: m.isHost,
  audio: m.audio,
  video: m.video,
  connected: m.connected,
  joinedAt: m.joinedAt,
  handRaised: Boolean(m.handRaisedAt),
  handRaisedAt: m.handRaisedAt || null,
  canSpeak: room ? room.canSpeak(m) : true,
});

export const waitingList = (room) =>
  [...room.waiting.values()].map(({ userId, name, reason, since }) => ({ userId, name, reason, since }));

/** Tear down a room: close attendance, notify everyone, detach sockets. */
export async function closeRoom(meetingId, reason) {
  const room = rooms.get(String(meetingId));
  if (!room) return;
  rooms.delete(String(meetingId));
  const io = ioRef;
  const socketIds = [...room.members.values()].map((m) => m.socketId).concat([...room.waiting.values()].map((w) => w.socketId));
  for (const m of room.members.values()) clearTimeout(m.graceTimer);
  room.sfu?.close();
  await Promise.all([...room.members.values()].map((m) => attendance.endSession(m.attendanceId, 'meeting_ended')));
  if (!io) return;
  for (const id of socketIds) {
    const s = io.sockets.sockets.get(id);
    if (!s) continue;
    s.emit('meeting:ended', { reason });
    s.leave(room.key);
    s.leave(room.hostKey);
    s.data.meetingId = null;
    s.data.status = null;
  }
}

/** A mediasoup worker crashed: drop its routers; clients are told to rebuild their media sessions. */
export function handleWorkerDeath(meetingIds) {
  for (const id of meetingIds) {
    const room = rooms.get(id);
    if (!room) continue;
    room.sfu = null;
    ioRef?.to(room.key).emit('mediasoup:reset', { reason: 'media_server_restarted' });
  }
}

/** Remove one user from a live room (used by REST /leave). */
export function getMemberSocket(meetingId, userId) {
  const room = rooms.get(String(meetingId));
  const m = room?.members.get(String(userId)) ?? room?.waiting.get(String(userId));
  return m && ioRef ? ioRef.sockets.sockets.get(m.socketId) : null;
}
