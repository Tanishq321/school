import crypto from 'node:crypto';
import { z } from 'zod';
import ChatMessage from '../models/ChatMessage.js';
import { audit } from '../services/auditService.js';
import { ensureBoardLoaded, MAX_OPS, scheduleBoardSave } from '../services/whiteboardService.js';
import { AppError, forbidden } from '../utils/errors.js';

const unit = z.number().min(0).max(1);
const point = z.tuple([unit, unit]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const opId = z.string().min(6).max(64).regex(/^[\w-]+$/);
const TOOLS = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse', 'text', 'eraser'];

const schemas = {
  chatSend: z.object({ text: z.string().max(2000) }),
  chatDelete: z.object({ id: z.string().min(6).max(64) }),
  boardOpen: z.object({ open: z.boolean() }),
  boardOp: z.object({
    op: z
      .object({
        id: opId,
        tool: z.enum(TOOLS),
        color,
        size: z.number().min(1).max(80),
        points: z.array(point).min(1).max(5000),
        text: z.string().max(500).optional(),
      })
      .strict()
      .refine((o) => (o.tool === 'text' ? Boolean(o.text?.trim()) : true), 'Text is required')
      .refine((o) => (['line', 'arrow', 'rect', 'ellipse'].includes(o.tool) ? o.points.length === 2 : true), 'Shapes need two points'),
  }),
  boardLive: z.object({
    id: opId,
    tool: z.enum(TOOLS),
    color,
    size: z.number().min(1).max(80),
    points: z.array(point).min(1).max(400),
    reset: z.boolean().optional(),
  }),
  boardErase: z.object({ id: opId }),
};

/** Token bucket per socket. */
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

/** Screen sharing has one slot per room; forcing it free closes the sharer's media too. */
export function stopScreenShare(io, room, { force = false } = {}) {
  const userId = room.screenSharer;
  if (!userId) return;
  room.screenSharer = null;
  const producer = room.sfu?.findProducer(userId, 'screen');
  if (producer) room.sfu.closeProducer(userId, producer.id);
  const member = room.members.get(userId);
  if (force && member) io.to(member.socketId).emit('screen:forceStop');
  io.to(room.key).emit('screen:state', { userId: null });
}

const publicMessage = (m) => ({ id: m.id, userId: m.userId, name: m.name, isHost: m.isHost, text: m.text, at: m.at });

export function registerClassroomHandlers({ io, socket, on, requireMember, requireHost }) {
  const user = socket.data.user;
  const chatLimit = makeLimiter(8, 1);
  const drawLimit = makeLimiter(240, 60);
  const always = () => true;

  // ================================================================ chat

  on(
    'chat:send',
    schemas.chatSend,
    async ({ text }) => {
      const { room, member } = requireMember();
      if (!room.canChat(member)) throw forbidden('Chat is limited to the host right now', 'chat_disabled');
      const clean = text.replace(/\r\n/g, '\n').trim();
      if (!clean) throw new AppError(400, 'empty_message', 'Write something first');
      if (!chatLimit()) throw new AppError(429, 'rate_limited', 'You’re sending messages too quickly');
      const at = new Date();
      let id = crypto.randomUUID();
      if (room.saveChat) {
        const doc = await ChatMessage.create({ meeting: room.meetingId, sender: user.id, senderName: member.name, senderIsHost: member.isHost, text: clean });
        id = String(doc._id);
      }
      const msg = { id, userId: user.id, name: member.name, isHost: member.isHost, text: clean, at };
      room.chat.push(msg);
      if (room.chat.length > 200) room.chat.shift();
      io.to(room.key).emit('chat:message', publicMessage(msg));
      return { message: publicMessage(msg) };
    },
    always,
  );

  on('chat:history', null, async () => {
    const { room } = requireMember();
    if (!room.chatLoaded && room.saveChat) {
      // After a restart the in-memory list is empty: hydrate from the database once.
      const docs = await ChatMessage.find({ meeting: room.meetingId, deletedAt: null }).sort({ createdAt: -1 }).limit(200).lean();
      const known = new Set(room.chat.map((m) => m.id));
      const loaded = docs
        .reverse()
        .filter((d) => !known.has(String(d._id)))
        .map((d) => ({ id: String(d._id), userId: String(d.sender), name: d.senderName, isHost: d.senderIsHost, text: d.text, at: d.createdAt }));
      room.chat = [...loaded, ...room.chat].slice(-200);
    }
    room.chatLoaded = true;
    return { messages: room.chat.map(publicMessage) };
  });

  on('chat:delete', schemas.chatDelete, async ({ id }) => {
    const { room } = requireHost();
    const idx = room.chat.findIndex((m) => m.id === id);
    if (idx === -1) throw new AppError(404, 'not_found', 'Message not found');
    room.chat.splice(idx, 1);
    if (room.saveChat && /^[a-f0-9]{24}$/.test(id)) {
      await ChatMessage.updateOne({ _id: id, meeting: room.meetingId }, { $set: { deletedAt: new Date(), deletedBy: user.id } });
    }
    io.to(room.key).emit('chat:deleted', { id });
    audit('meeting.chat_delete', { actor: user.id, targetType: 'chat', targetId: id, meta: { meeting: room.meetingId } });
    return {};
  });

  // ================================================================ whiteboard

  on('whiteboard:state', null, async () => {
    const { room } = requireMember();
    const board = await ensureBoardLoaded(room);
    return { open: board.open, ops: board.ops };
  });

  on('whiteboard:open', schemas.boardOpen, async ({ open }) => {
    const { room } = requireHost();
    await ensureBoardLoaded(room);
    room.board.open = open;
    io.to(room.key).emit('whiteboard:opened', { open });
    return {};
  });

  on(
    'whiteboard:draw',
    schemas.boardOp,
    async ({ op }) => {
      const { room, member } = requireMember();
      if (!room.canDraw(member)) throw forbidden('The host hasn’t enabled drawing for students', 'drawing_disabled');
      if (!drawLimit()) throw new AppError(429, 'rate_limited', 'Slow down');
      const board = await ensureBoardLoaded(room);
      if (board.ops.some((o) => o.id === op.id)) throw new AppError(409, 'duplicate_op', 'Already on the board');
      if (board.ops.length >= MAX_OPS) throw new AppError(409, 'board_full', 'The board is full. Clear it to keep drawing.');
      const stored = { ...op, author: user.id };
      board.ops.push(stored);
      socket.to(room.key).emit('whiteboard:draw', { op: stored });
      scheduleBoardSave(room);
      return {};
    },
    always,
  );

  // In-progress strokes: relayed only (not stored), dropped under load.
  on(
    'whiteboard:live',
    schemas.boardLive,
    async (live) => {
      const { room, member } = requireMember();
      if (!room.canDraw(member)) throw forbidden('Drawing is not enabled', 'drawing_disabled');
      if (!drawLimit()) return {};
      socket.to(room.key).volatile.emit('whiteboard:live', { ...live, author: user.id });
      return {};
    },
    always,
  );

  /** Remove one object (undo, or object eraser). Only its author or the host may. */
  on(
    'whiteboard:erase',
    schemas.boardErase,
    async ({ id }) => {
      const { room, member } = requireMember();
      const board = await ensureBoardLoaded(room);
      const idx = board.ops.findIndex((o) => o.id === id);
      if (idx === -1) return {};
      if (board.ops[idx].author !== user.id && !member.isHost) throw forbidden('You can only remove your own drawings', 'not_author');
      board.ops.splice(idx, 1);
      io.to(room.key).emit('whiteboard:erased', { id });
      scheduleBoardSave(room);
      return {};
    },
    always,
  );

  on('whiteboard:clear', null, async () => {
    const { room } = requireHost();
    const board = await ensureBoardLoaded(room);
    board.ops = [];
    io.to(room.key).emit('whiteboard:cleared');
    scheduleBoardSave(room);
    return {};
  });

  // ================================================================ screen sharing (one slot per room)

  on('screen:start', null, async () => {
    const { room, member } = requireMember();
    if (!room.canShareScreen(member)) throw forbidden('The host hasn’t allowed students to share their screen', 'screen_not_allowed');
    if (room.screenSharer && room.screenSharer !== user.id) {
      if (!member.isHost) throw new AppError(409, 'screen_busy', 'Someone else is already sharing');
      stopScreenShare(io, room, { force: true }); // the host can take over
    }
    room.screenSharer = user.id;
    io.to(room.key).emit('screen:state', { userId: user.id });
    return {};
  });

  on('screen:stop', null, async () => {
    const { room } = requireMember();
    if (room.screenSharer === user.id) stopScreenShare(io, room);
    return {};
  });

  on('host:stopScreen', null, async () => {
    const { room } = requireHost();
    stopScreenShare(io, room, { force: true });
    return {};
  });
}
