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
import { registerClassroomHandlers, stopScreenShare } from './classroomHandlers.js';
import { registerRecordingHandlers } from './recordingHandlers.js';
import { consentSummary, onMemberJoined, recordingState } from '../services/recordingService.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const msId = z.string().min(8).max(64);
const anyObj = z.record(z.string(), z.unknown());

const schemas = {
  join: z.object({ joinToken: z.string().min(10).max(2000) }),
  userTarget: z.object({ userId: objectId }),
  mediaState: z.object({ audio: z.boolean(), video: z.boolean() }),
  hand: z.object({ raised: z.boolean() }),
  lock: z.object({ locked: z.boolean() }),
  permissions: z
    .object({
      allowSelfUnmute: z.boolean(),
      allowScreenShare: z.boolean(),
      allowDrawing: z.boolean(),
      chatMode: z.enum(['everyone', 'host']),
    })
    .partial()
    .strict()
    .refine((p) => Object.keys(p).length > 0, 'Nothing to change'),
  grantSpeak: z.object({ userId: objectId, granted: z.boolean() }),
  signal: z.object({
    to: objectId,
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
  // mediasoup payloads: structure is validated here, semantics by mediasoup itself.
  msJoin: z.object({ sessionId: z.string().min(8).max(64), rtpCapabilities: anyObj }),
  msCreateTransport: z.object({ direction: z.enum(['send', 'recv']) }),
  msConnect: z.object({ transportId: msId, dtlsParameters: anyObj }),
  msProduce: z.object({
    transportId: msId,
    kind: z.enum(['audio', 'video']),
    rtpParameters: anyObj,
    source: z.enum(['mic', 'camera', 'screen']),
    paused: z.boolean().optional(),
  }),
  msProducer: z.object({ producerId: msId }),
  msConsume: z.object({ producerId: msId }),
  msConsumer: z.object({ consumerId: msId }),
  msLayers: z.object({ consumerId: msId, spatialLayer: z.number().int().min(0).max(2), temporalLayer: z.number().int().min(0).max(2).optional() }),
  msTransport: z.object({ transportId: msId }),
};

/** Very small per-socket token bucket so one client can't flood the server. */
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
  const mediaLimit = makeLimiter(120, 20);
  const actionLimit = makeLimiter(30, 3);

  const on = (name, schema, fn, limiter = actionLimit) =>
    socket.on(name, async (payload, ack) => {
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
        const known = err instanceof AppError;
        if (!known) logger.error({ err, event: name, user: user.id }, 'socket handler error');
        reply({
          ok: false,
          error: known ? { code: err.code, message: err.message } : { code: 'internal', message: err?.message?.startsWith('Invalid') ? err.message : 'Something went wrong' },
        });
      }
    });

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

  function requireTarget(room, userId) {
    const target = room.members.get(userId);
    if (!target) throw new AppError(404, 'not_in_meeting', 'That person is not in the meeting');
    if (target.isHost) throw forbidden('You can’t do that to a host', 'target_is_host');
    return target;
  }

  const notifyHosts = (room) => io.to(room.hostKey).emit('waiting:updated', { waiting: waitingList(room) });
  const broadcastMember = (room, member) => io.to(room.key).emit('participant:updated', publicMember(member, room));

  function meetingInfo(room, meeting) {
    return {
      id: room.meetingId,
      code: room.code,
      title: meeting?.title,
      hostId: room.hostId,
      maxParticipants: room.settings.maxParticipants,
      waitingRoom: room.settings.waitingRoom,
      mediaMode: room.mode,
      locked: room.locked,
      permissions: room.permissions,
      screenSharer: room.screenSharer,
      boardOpen: room.board.open,
    };
  }

  function admittedPayload(room, member, meeting, extra = {}) {
    return {
      status: 'admitted',
      self: publicMember(member, room),
      participants: [...room.members.values()].filter((m) => m.userId !== member.userId).map((m) => publicMember(m, room)),
      waiting: member.isHost ? waitingList(room) : [],
      meeting: meetingInfo(room, meeting),
      recording: recordingState(room, member.userId),
      recordingConsents: member.isHost && room.recording ? consentSummary(room) : undefined,
      ...extra,
    };
  }

  async function admit(room, sock, meeting, { isHost }) {
    const u = sock.data.user;
    if (!isHost && room.members.size >= room.settings.maxParticipants) {
      throw new AppError(409, 'meeting_full', `This meeting is full (${room.settings.maxParticipants} people max).`);
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
      handRaisedAt: null,
      speakGranted: false,
    };
    room.members.set(u.id, member);
    onMemberJoined(room, member);
    room.admitted.add(u.id);
    room.waiting.delete(u.id);
    room.emptySince = null;
    sock.join(room.key);
    if (isHost) sock.join(room.hostKey);
    sock.data.meetingId = room.meetingId;
    sock.data.status = 'admitted';
    member.attendanceId = await attendance.startSession({ meetingId: room.meetingId, userId: u.id, isHost });
    sock.to(room.key).emit('participant:joined', publicMember(member, room));
    if (room.recording) io.to(room.hostKey).emit('recording:consents', { consents: consentSummary(room) });
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
    socket.to(room.key).emit('participant:reconnected', publicMember(member, room));
    return admittedPayload(room, member, meeting, { resumed: true });
  }

  async function finalizeMember(room, userId, reason) {
    const member = room.members.get(userId);
    if (!member) return;
    clearTimeout(member.graceTimer);
    room.members.delete(userId);
    if (room.screenSharer === userId) stopScreenShare(io, room);
    room.sfu?.removePeer(userId);
    await attendance.endSession(member.attendanceId, reason === 'removed' ? 'left' : reason);
    io.to(room.key).emit('participant:left', { userId, reason });
    if (room.recording) io.to(room.hostKey).emit('recording:consents', { consents: consentSummary(room) });
    if (room.members.size === 0) room.emptySince = Date.now();
    Meeting.updateOne({ _id: room.meetingId }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
  }

  // ================================================================ meeting lifecycle

  on('meeting:join', schemas.join, async ({ joinToken }) => {
    const claims = verifyJoinToken(joinToken);
    if (claims.sub !== user.id) throw forbidden('Join token does not belong to you', 'token_mismatch');
    if (socket.data.meetingId && socket.data.meetingId !== claims.mid) {
      throw new AppError(409, 'already_in_meeting', 'Leave your current meeting first');
    }

    const meeting = await Meeting.findById(claims.mid).select('+bannedUsers');
    if (!meeting || CLOSED_STATUSES.includes(meeting.status)) throw new AppError(410, 'meeting_closed', 'This meeting has ended');
    const isHost = String(meeting.host) === user.id;

    const room = getOrCreateRoom(meeting);
    room.settings = { waitingRoom: meeting.settings.waitingRoom, maxParticipants: effectiveCapacity(meeting) };
    meeting.bannedUsers?.forEach((id) => room.banned.add(String(id)));
    if (!isHost && room.banned.has(user.id)) throw new AppError(403, 'removed_from_meeting', 'The host removed you from this meeting.');

    const existing = room.members.get(user.id);
    if (existing) return reattach(room, existing, meeting);

    const seenBefore = room.admitted.has(user.id) || Boolean(await Attendance.exists({ meeting: meeting._id, user: user.id }));
    if (!isHost && room.locked && !seenBefore) throw new AppError(423, 'meeting_locked', 'The host has locked this meeting.');

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
    // People the host invited by email are expected: they skip the waiting room.
    const invited = Boolean(user.email && meeting.invitees?.includes(user.email.toLowerCase()));
    if (room.settings.waitingRoom && !seenBefore && !invited) return putInWaiting(room, 'awaiting_approval');
    return admit(room, socket, meeting, { isHost: false });
  });

  on('meeting:leave', null, async () => {
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
  });

  on('meeting:end', null, async () => {
    const { room } = requireHost();
    const meeting = await Meeting.findById(room.meetingId);
    await endMeeting(meeting, 'host_ended', user.id);
    return {};
  });

  // ================================================================ waiting room (host only)

  async function admitWaiting(room, userId) {
    const entry = room.waiting.get(userId);
    if (!entry) throw new AppError(404, 'not_waiting', 'That person is no longer waiting');
    const ws = io.sockets.sockets.get(entry.socketId);
    if (!ws) {
      room.waiting.delete(userId);
      throw new AppError(404, 'not_waiting', 'That person has disconnected');
    }
    const meeting = await Meeting.findById(room.meetingId);
    ws.emit('meeting:admitted', await admit(room, ws, meeting, { isHost: false }));
    audit('meeting.admit', { actor: user.id, targetType: 'user', targetId: userId, meta: { meeting: room.meetingId } });
  }

  on('waiting:admit', schemas.userTarget, async ({ userId }) => {
    const { room } = requireHost();
    try {
      await admitWaiting(room, userId);
    } finally {
      notifyHosts(room);
    }
    return {};
  });

  on('waiting:admitAll', null, async () => {
    const { room } = requireHost();
    let admitted = 0;
    let full = false;
    for (const id of [...room.waiting.keys()]) {
      try {
        await admitWaiting(room, id);
        admitted += 1;
      } catch (err) {
        if (err.code === 'meeting_full') {
          full = true;
          break;
        }
      }
    }
    notifyHosts(room);
    return { admitted, full };
  });

  on('waiting:deny', schemas.userTarget, async ({ userId }) => {
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
  });

  // ================================================================ host controls (all enforced here)

  /** Mute one member: pauses their mic on the media server (SFU) and tells their client. */
  async function muteMember(room, target) {
    const mic = room.sfu?.findProducer(target.userId, 'mic');
    if (mic && !mic.paused) await mic.pause();
    target.audio = false;
    io.to(target.socketId).emit('participant:mutedByHost', { canSpeak: room.canSpeak(target) });
    broadcastMember(room, target);
  }

  on('host:mute', schemas.userTarget, async ({ userId }) => {
    const { room } = requireHost();
    await muteMember(room, requireTarget(room, userId));
    audit('meeting.mute', { actor: user.id, targetType: 'user', targetId: userId, meta: { meeting: room.meetingId } });
    return {};
  });

  on('host:muteAll', null, async () => {
    const { room } = requireHost();
    for (const m of room.members.values()) if (!m.isHost) await muteMember(room, m);
    audit('meeting.mute_all', { actor: user.id, targetType: 'meeting', targetId: room.meetingId });
    return {};
  });

  on('host:remove', schemas.userTarget, async ({ userId }) => {
    const { room } = requireHost();
    const target = requireTarget(room, userId);
    room.banned.add(userId);
    await Meeting.updateOne({ _id: room.meetingId }, { $addToSet: { bannedUsers: userId } });
    const ts = io.sockets.sockets.get(target.socketId);
    await finalizeMember(room, userId, 'removed');
    if (ts) {
      ts.emit('meeting:removed');
      ts.leave(room.key);
      ts.data.meetingId = null;
      ts.data.status = null;
    }
    audit('meeting.remove', { actor: user.id, targetType: 'user', targetId: userId, meta: { meeting: room.meetingId } });
    return {};
  });

  on('host:lock', schemas.lock, async ({ locked }) => {
    const { room } = requireHost();
    room.locked = locked;
    await Meeting.updateOne({ _id: room.meetingId }, { $set: { locked } });
    io.to(room.key).emit('meeting:locked', { locked });
    audit(locked ? 'meeting.lock' : 'meeting.unlock', { actor: user.id, targetType: 'meeting', targetId: room.meetingId });
    return {};
  });

  on('host:permissions', schemas.permissions, async (changes) => {
    const { room } = requireHost();
    room.permissions = { ...room.permissions, ...changes };
    await Meeting.updateOne(
      { _id: room.meetingId },
      { $set: Object.fromEntries(Object.entries(changes).map(([k, v]) => [`settings.${k}`, v])) },
    );
    if (changes.allowSelfUnmute === false) for (const m of room.members.values()) m.speakGranted = false;
    // Withdrawing screen-share permission ends a student's share immediately.
    const sharer = room.screenSharer && room.members.get(room.screenSharer);
    if (changes.allowScreenShare === false && sharer && !sharer.isHost) stopScreenShare(io, room, { force: true });
    io.to(room.key).emit('meeting:permissions', room.permissions);
    for (const m of room.members.values()) broadcastMember(room, m);
    return {};
  });

  /** Let one participant speak while self-unmute is off (e.g. after they raise a hand). */
  on('host:grantSpeak', schemas.grantSpeak, async ({ userId, granted }) => {
    const { room } = requireHost();
    const target = requireTarget(room, userId);
    target.speakGranted = granted;
    if (granted) target.handRaisedAt = null;
    if (!granted) await muteMember(room, target);
    io.to(target.socketId).emit('participant:speakPermission', { canSpeak: room.canSpeak(target) });
    broadcastMember(room, target);
    return {};
  });

  on('host:lowerHand', schemas.userTarget, async ({ userId }) => {
    const { room } = requireHost();
    const target = requireTarget(room, userId);
    target.handRaisedAt = null;
    broadcastMember(room, target);
    return {};
  });

  on('participant:raiseHand', schemas.hand, async ({ raised }) => {
    const { room, member } = requireMember();
    member.handRaisedAt = raised ? new Date() : null;
    broadcastMember(room, member);
    return {};
  });

  // ================================================================ media state & P2P signalling

  on('media:state', schemas.mediaState, async ({ audio, video }) => {
    const { room, member } = requireMember();
    member.audio = audio && room.canSpeak(member);
    member.video = video;
    socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio: member.audio, video });
    return {};
  });

  on(
    'p2p:signal',
    schemas.signal,
    async ({ to, data }) => {
      const { room } = requireMember();
      if (room.mode !== 'p2p') throw badRequest('This meeting uses the media server');
      if (to === user.id) throw badRequest('Cannot signal yourself');
      const target = room.members.get(to);
      if (!target || !target.connected) throw new AppError(404, 'peer_unavailable', 'That participant is not connected');
      io.to(target.socketId).emit('p2p:signal', { from: user.id, data });
      return {};
    },
    signalLimit,
  );

  on('ice:refresh', null, async () => {
    requireMember();
    return getIceServers(user.id);
  });

  // ================================================================ mediasoup (SFU)
  // Every call resolves the room from the authenticated socket and checks membership;
  // ids from the client are only looked up inside the caller's own media session.

  const sfuCtx = async () => {
    const ctx = requireMember();
    return { ...ctx, sfu: await ctx.room.getSfu() };
  };

  on(
    'mediasoup:getRouterRtpCapabilities',
    null,
    async () => {
      const { sfu } = await sfuCtx();
      return { rtpCapabilities: sfu.rtpCapabilities };
    },
    mediaLimit,
  );

  on(
    'mediasoup:join',
    schemas.msJoin,
    async ({ sessionId, rtpCapabilities }) => {
      const { sfu } = await sfuCtx();
      return sfu.joinPeer(user.id, { sessionId, rtpCapabilities });
    },
    mediaLimit,
  );

  on(
    'mediasoup:createWebRtcTransport',
    schemas.msCreateTransport,
    async ({ direction }) => {
      const { sfu } = await sfuCtx();
      return { transport: await sfu.createTransport(user.id, direction) };
    },
    mediaLimit,
  );

  on(
    'mediasoup:connectTransport',
    schemas.msConnect,
    async ({ transportId, dtlsParameters }) => {
      const { sfu } = await sfuCtx();
      await sfu.connectTransport(user.id, transportId, dtlsParameters);
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:restartIce',
    schemas.msTransport,
    async ({ transportId }) => {
      const { sfu } = await sfuCtx();
      return sfu.restartIce(user.id, transportId);
    },
    mediaLimit,
  );

  on(
    'mediasoup:produce',
    schemas.msProduce,
    async (input) => {
      const { room, member, sfu } = await sfuCtx();
      if (input.source === 'screen' && room.screenSharer !== user.id) {
        throw forbidden('Start screen sharing first', 'screen_not_claimed');
      }
      // Muted-by-policy participants may publish their mic only in the paused state.
      const paused = input.paused || (input.source === 'mic' && !room.canSpeak(member));
      const producer = await sfu.produce(user.id, { ...input, paused });
      if (input.source === 'mic') member.audio = !producer.paused;
      if (input.source === 'camera') member.video = true;
      socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio: member.audio, video: member.video });
      return { id: producer.id, paused: producer.paused };
    },
    mediaLimit,
  );

  on(
    'mediasoup:pauseProducer',
    schemas.msProducer,
    async ({ producerId }) => {
      const { room, member, sfu } = await sfuCtx();
      const p = sfu.producer(user.id, producerId);
      await p.pause();
      if (p.appData.source === 'mic') member.audio = false;
      socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio: member.audio, video: member.video });
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:resumeProducer',
    schemas.msProducer,
    async ({ producerId }) => {
      const { room, member, sfu } = await sfuCtx();
      const p = sfu.producer(user.id, producerId);
      if (p.appData.source === 'mic' && !room.canSpeak(member)) {
        throw forbidden('The host has turned off unmuting. Raise your hand to ask to speak.', 'unmute_not_allowed');
      }
      await p.resume();
      if (p.appData.source === 'mic') member.audio = true;
      socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio: member.audio, video: member.video });
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:closeProducer',
    schemas.msProducer,
    async ({ producerId }) => {
      const { room, member, sfu } = await sfuCtx();
      const source = sfu.producer(user.id, producerId).appData.source;
      sfu.closeProducer(user.id, producerId);
      if (source === 'screen' && room.screenSharer === user.id) stopScreenShare(io, room);
      if (source === 'camera') member.video = false;
      if (source === 'mic') member.audio = false;
      socket.to(room.key).emit('participant:mediaState', { userId: user.id, audio: member.audio, video: member.video });
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:consume',
    schemas.msConsume,
    async ({ producerId }) => {
      const { sfu } = await sfuCtx();
      return { consumer: await sfu.consume(user.id, producerId) };
    },
    mediaLimit,
  );

  on(
    'mediasoup:resumeConsumer',
    schemas.msConsumer,
    async ({ consumerId }) => {
      const { sfu } = await sfuCtx();
      await sfu.consumer(user.id, consumerId).resume();
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:pauseConsumer',
    schemas.msConsumer,
    async ({ consumerId }) => {
      const { sfu } = await sfuCtx();
      await sfu.consumer(user.id, consumerId).pause();
      return {};
    },
    mediaLimit,
  );

  on(
    'mediasoup:setPreferredLayers',
    schemas.msLayers,
    async ({ consumerId, spatialLayer, temporalLayer }) => {
      const { sfu } = await sfuCtx();
      const c = sfu.consumer(user.id, consumerId);
      if (c.type === 'simulcast' || c.type === 'svc') await c.setPreferredLayers({ spatialLayer, temporalLayer: temporalLayer ?? 2 });
      return {};
    },
    mediaLimit,
  );

  registerClassroomHandlers({ io, socket, on, requireMember, requireHost });
  registerRecordingHandlers({ io, socket, on, requireMember, requireHost });

  // ================================================================ disconnect

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
    // Media keeps flowing during the grace period (P2P, or SFU transports stay open).
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
