import { Server } from 'socket.io';
import env from '../config/env.js';
import User from '../models/User.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { setIo } from './realtime.js';
import { registerMeetingHandlers } from './meetingHandlers.js';
import logger from '../utils/logger.js';

export function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigins, credentials: true },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
    serveClient: false,
  });

  // Handshake authentication: every socket is bound to one verified, active user.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw Object.assign(new Error('Authentication required'), { code: 'unauthorized' });
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).lean();
      if (!user || user.status !== 'active') throw Object.assign(new Error('Account unavailable'), { code: 'unauthorized' });
      if (user.sessionsValidAfter && payload.iat < Math.floor(user.sessionsValidAfter.getTime() / 1000)) {
        throw Object.assign(new Error('Signed out'), { code: 'unauthorized' });
      }
      if (env.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
        throw Object.assign(new Error('Please verify your email address first'), { code: 'email_not_verified' });
      }
      socket.data.user = { id: String(user._id), name: user.name, role: user.role, email: user.email };
      next();
    } catch (err) {
      const e = new Error(err.message || 'Unauthorized');
      e.data = { code: err.code || 'unauthorized' };
      next(e);
    }
  });

  io.on('connection', (socket) => {
    logger.debug({ user: socket.data.user.id, sid: socket.id }, 'socket connected');
    registerMeetingHandlers(io, socket);
  });

  setIo(io);
  return io;
}
