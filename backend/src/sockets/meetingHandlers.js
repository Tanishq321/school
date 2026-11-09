import { z } from 'zod';
import env from '../config/env.js';
import Meeting, { CLOSED_STATUSES, MEETING_STATUS } from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import { verifyJoinToken } from '../services/tokenService.js';
import * as attendance from '../services/attendanceService.js';
import { effectiveCapacity, endMeeting } from '../services/meetingService.js';
import { getIceServers } from '../services/turnService.js';
import { audit } from '../services/auditService.js';
import { AppError, badRequest, forbidden } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { getOrCreateRoom, publicMember, rooms, waitingList } from './realtime.js';

const schemas = {
  join: z.object({ joinToken: z.string().min(10).max(2000) }),
  userTarget: z.object({ userId: z.string().regex(/^[a-f0-9]{24}$/) }),
  mediaState: z.object({ audio: z.boolean(), video: z.boolean() }),
  signal: z.object({
    to: z.string().regex(/^[a-f0-9]{24}$/),
    data: z
      .object({
        pcId: z.string().min(4).max(64),
        type: z.enum(['description', 'candidate', 'restart-request', 'bye']),
        description: z.object({ type: z.enum(['offer', 'answer', 'rollback']), sdp: z.string().max(60_000).optional() }).optional(),
        candidate: z
          .object({
            candidate: z.string().max(1000),
            sdpMid: z.string().max(64).nullable().optional(),
            sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
            usernameFragment: z.string().max(256).nullable().optional(),
          })
          .nullable()
          .optional(),
      })
      .strict(),
  }),
};

/** Very small per-socket token bucket so one client can't flood the relay. */
function makeLimiter(capacity, refillPerSec) {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function registerMeetingHandlers(io, socket) {
  const user = socket.data.user;
  const signalLimit = makeLimiter(200, 40);
  const actionLimit = makeLimiter(30, 3);

  const handler =
    (name, schema, fn, limiter = actionLimit) =>
    async (payload, ack) => {
      // socket.emit('event', cb) delivers the callback as the first argument.
      if (typeof payload === 'function') {
        ack = payload;
        payload = undefined;
      }
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (!limiter()) throw new AppError(429, 'rate_limited', 'Too many requests');
        let data = payload ?? {};
        if (schema) {
          const parsed = schema.safeParse(data);
          if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message || 'Invalid payload');
          data = parsed.data;
        }
        const result = await fn(data);
        reply({ ok: true, ...(result || {}) });
      } catch (err) {
        if (!(err instanceof AppError)) logger.error({ err, event: name, user: user.id }, 'socket handler error');
        reply({
          ok: false,
          error: err instanceof AppError ? { code: err.code, message: err.message } : { code: 'internal', message: 'Something went wrong' },
        });
      }
    };

  const currentRoom = () => (socket.data.meetingId ? rooms.get(socket.data.meetingId) : null);

  /** The caller must be an admitted member using *this* socket. */
  function requireMember() {
    const room = currentRoom();
    const member = room?.members.get(user.id);
    if (!room || !member || member.socketId !== socket.id) throw forbidden('You are not in this meeting', 'not_in_meeting');
    return { room, member };
  }

  function requireHost() {
    const ctx = requireMember();
    if (!ctx.member.isHost) throw forbidden('Only the host can do that', 'not_host');
    return ctx;
  }

  const notifyHosts = (room) => io.to(room.hostKey).emit('waiting:updated', { waiting: waitingList(room) });

  function meetingInfo(room, meeting) {
    return {
      id: room.meetingId,
      code: room.code,
      title: meeting?.title,
      hostId: room.hostId,
      maxParticipants: room.settings.maxParticipants,
      waitingRoom: room.settings.waitingRoom,
    };
  }

  function admittedPayload(room, member, meeting, extra = {}) {
    return {
      status: 'admitted',
      self: publicMember(member),
      participants: [...room.members.values()].filter((m) => m.userId !== member.userId).map(publicMember),
      waiting: member.isHost ? waitingList(room) : [],
      meeting: meetingInfo(room, meeting),
      ...extra,
    };
  }

  async function admit(room, sock, meeting, { isHost }) {
    const u = sock.data.user;
    if (!isHost && room.members.size >= room.settings.maxParticipants) {
      throw new AppError(409, 'meeting_full', `This meeting is full (${room.settings.maxParticipants} people max for now).`);
    }
    const member = {
      userId: u.id,
      name: u.name,
      role: u.role,
      isHost,
      socketId: sock.id,
      audio: false,
      video: false,
      connected: true,
      joinedAt: new Date(),
      attendanceId: null,
      graceTimer: null,
    };
    room.members.set(u.id, member);
    room.admitted.add(u.id);
    room.waiting.delete(u.id);
    room.emptySince = null;
    sock.join(room.key);
    if (isHost) sock.join(room.hostKey);
    sock.data.meetingId = room.meetingId;
    sock.data.status = 'admitted';
    member.attendanceId = await attendance.startSession({ meetingId: room.meetingId, userId: u.id, isHost });
    sock.to(room.key).emit('participant:joined', publicMember(member));
    Meeting.updateOne({ _id: room.meetingId }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
    return admittedPayload(room, member, meeting);
  }

  function putInWaiting(room, reason) {
    const prev = room.waiting.get(user.id);
    if (prev && prev.socketId !== socket.id) io.sockets.sockets.get(prev.socketId)?.emit('meeting:replaced');
    room.waiting.set(user.id, { userId: user.id, name: user.name, socketId: socket.id, reason, since: new Date() });
    socket.data.meetingId = room.meetingId;
    socket.data.status = 'waiting';
    notifyHosts(room);
    return { status: 'waiting', reason, meeting: { code: room.code } };
  }

  /** Same user connecting again (network blip, page reload or another device): take over the seat. */
  function reattach(room, member, meeting) {
    if (member.socketId !== socket.id) {
      const old = io.sockets.sockets.get(member.socketId);
      if (old) {
        old.emit('meeting:replaced');
        old.leave(room.key);
        old.leave(room.hostKey);
        old.data.meetingId = null;
      }
    }
    clearTimeout(member.graceTimer);
    member.graceTimer = null;
    member.socketId = socket.id;
    member.connected = true;
    socket.join(room.key);
    if (member.isHost) socket.join(room.hostKey);
    socket.data.meetingId = room.meetingId;
    socket.data.status = 'admitted';
    socket.to(room.key).emit('participant:reconnected', publicMember(member));
    return admittedPayload(room, member, meeting, { resumed: true });
  }

  async function finalizeMember(room, userId, reason) {
    const member = room.members.get(userId);
    if (!member) return;
    clearTimeout(member.graceTimer);
    room.members.delete(userId);
    await attendance.endSession(member.attendanceId, reason);
    io.to(room.key).emit('participant:left', { userId, reason });
    if (room.members.size === 0) room.emptySince = Date.now();
    Meeting.updateOne({ _id: room.meetingId }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
  }

  // ---------------------------------------------------------------- meeting lifecycle

  socket.on(
    'meeting:join',
    handler('meeting:join', schemas.join, async ({ joinToken }) => {
      const claims = verifyJoinToken(joinToken);
      if (claims.sub !== user.id) throw forbidden('Join token does not belong to you', 'token_mismatch');
      if (socket.data.meetingId && socket.data.meetingId !== claims.mid) {
        throw new AppError(409, 'already_in_meeting', 'Leave your current meeting first');
      }

      const meeting = await Meeting.findById(claims.mid);
      if (!meeting || CLOSED_STATUSES.includes(meeting.status)) throw new AppError(410, 'meeting_closed', 'This meeting has ended');
      const isHost = String(meeting.host) === user.id;

      const room = getOrCreateRoom(meeting);
      room.settings = { waitingRoom: meeting.settings.waitingRoom, maxParticipants: effectiveCapacity(meeting) };

      const existing = room.members.get(user.id);
      if (existing) return reattach(room, existing, meeting);

      if (isHost) {
        const starting = meeting.status === MEETING_STATUS.SCHEDULED;
        if (starting) {
          meeting.status = MEETING_STATUS.LIVE;
          meeting.startedAt = new Date();
        }
        meeting.lastActiveAt = new Date();
        await meeting.save();
        const result = await admit(room, socket, meeting, { isHost: true });
        if (starting) audit('meeting.start', { actor: user.id, targetType: 'meeting', targetId: meeting._id });

        // Release anyone who was waiting for the host to arrive.
        for (const w of [...room.waiting.values()]) {
          const ws = io.sockets.sockets.get(w.socketId);
          if (!ws) {
            room.waiting.delete(w.userId);
            continue;
          }
          ws.emit('meeting:started');
          if (!room.settings.waitingRoom || room.admitted.has(w.userId)) {
            try {
              ws.emit('meeting:admitted', await admit(room, ws, meeting, { isHost: false }));
            } catch (err) {
              if (err.code === 'meeting_full') ws.emit('waiting:status', { reason: 'meeting_full' });
              else throw err;
            }
          } else {
            w.reason = 'awaiting_approval';
            ws.emit('waiting:status', { reason: 'awaiting_approval' });
          }
        }
        result.waiting = waitingList(room);
        notifyHosts(room);
        return result;
      }

      if (meeting.status !== MEETING_STATUS.LIVE) return putInWaiting(room, 'host_not_started');
      if (room.settings.waitingRoom && !room.admitted.has(user.id)) {
        // Anyone with an attendance record was already admitted (survives server restarts).
        const seenBefore = await Attendance.exists({ meeting: meeting._id, user: user.id });
        if (!seenBefore) return putInWaiting(room, 'awaiting_approval');
      }
      return admit(room, socket, meeting, { isHost: false });
    }),
  );

  socket.on(
    'meeting:leave',
    handler('meeting:leave', null, async () => {
      const room = currentRoom();
      if (!room) return {};
      if (room.waiting.get(user.id)?.socketId === socket.id) {
        room.waiting.delete(user.id);
        notifyHosts(room);
      }
      if (room.members.get(user.id)?.socketId === socket.id) await finalizeMember(room, user.id, 'left');
      socket.leave(room.key);
      socket.leave(room.hostKey);
      socket.data.meetingId = null;
      socket.data.status = null;
      return {};
    }),
  );

  socket.on(
    'meeting:end',
    handler('meeting:end', null, async () => {
      const { room } = requireHost();
      const meeting = await Meeting.findById(room.meetingId);
      await endMeeting(meeting, 'host_ended', user.id);
      return {};
    }),
  );

  // ---------------------------------------------------------------- waiting room (host only)

  socket.on(
    'waiting:admit',
    handler('waiting:admit', schemas.userTarget, async ({ userId }) => {
      const { room } = requireHost();
      const entry = room.waiting.get(userId);
      if (!entry) throw new AppError(404, 'not_waiting', 'That person is no longer waiting');
      const ws = io.sockets.sockets.get(entry.socketId);
      if (!ws) {
        room.waiting.delete(userId);
        notifyHosts(room);
        throw new AppError(404, 'not_waiting', 'That person has disconnected');
      }
      const meeting = await Meeting.findById(room.meetingId);
      const payload = await admit(room, ws, meeting, { isHost: false });
      ws.emit('meeting:admitted', payload);
      notifyHosts(room);
      audit('meeting.admit', { actor: user.id, targetType: 'user', targetId: userId, meta: { meeting: room.meetingId } });
      return {};
    }),
  );

  socket.on(
    'waiting:deny',
    handler('waiting:deny', schemas.userTarget, async ({ userId }) => {
      const { room } = requireHost();
      const entry = room.waiting.get(userId);
      if (!entry) throw new AppError(404, 'not_waiting', 'That person is no longer waiting');
      room.waiting.delete(userId);
      const ws = io.sockets.sockets.get(entry.socketId);
      if (ws) {
        ws.emit('meeting:denied');
        ws.data.meetingId = null;
        ws.data.status = null;
      }
      notifyHosts(room);
      audit('meeting.deny', { actor: user.id, targetType: 'user', targetId: userId, meta: { meeting: room.meetingId } });
      return {};
    }),
  );

  // ---------------------------------------------------------------- media & signalling

  socket.on(
    'media:state',
    handler('media:state', schemas.mediaState, async ({ audio, video }) => {
      const { room, member } = requireMember();
      member.audio = audio;
      member.video = video;
      socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio, video });
      return {};
    }),
  );

  socket.on(
    'p2p:signal',
    handler(
      'p2p:signal',
      schemas.signal,
      async ({ to, data }) => {
        const { room } = requireMember();
        if (to === user.id) throw badRequest('Cannot signal yourself');
        const target = room.members.get(to);
        if (!target || !target.connected) throw new AppError(404, 'peer_unavailable', 'That participant is not connected');
        io.to(target.socketId).emit('p2p:signal', { from: user.id, data });
        return {};
      },
      signalLimit,
    ),
  );

  socket.on(
    'ice:refresh',
    handler('ice:refresh', null, async () => {
      requireMember();
      return getIceServers(user.id);
    }),
  );

  // ---------------------------------------------------------------- disconnect

  socket.on('disconnect', (reason) => {
    const room = currentRoom();
    if (!room) return;
    const w = room.waiting.get(user.id);
    if (w?.socketId === socket.id) {
      room.waiting.delete(user.id);
      notifyHosts(room);
    }
    const member = room.members.get(user.id);
    if (!member || member.socketId !== socket.id) return;
    member.connected = false;
    if (env.RECONNECT_GRACE_SECONDS === 0) {
      finalizeMember(room, user.id, 'disconnected').catch((err) => logger.error({ err }, 'finalize failed'));
      return;
    }
    io.to(room.key).emit('participant:reconnecting', { userId: user.id });
    member.graceTimer = setTimeout(() => {
      if (room.members.get(user.id) === member && !member.connected) {
        finalizeMember(room, user.id, 'disconnected').catch((err) => logger.error({ err }, 'finalize failed'));
      }
    }, env.RECONNECT_GRACE_SECONDS * 1000);
    member.graceTimer.unref?.();
    logger.debug({ user: user.id, reason }, 'member disconnected; grace period started');
  });
}
