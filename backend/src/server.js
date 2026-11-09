import http from 'node:http';
import env from './config/env.js';
import logger from './utils/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { createSocketServer } from './sockets/index.js';
import { closeOrphanedSessions } from './services/attendanceService.js';
import { startMeetingExpiryJob } from './services/meetingExpiryJob.js';

async function main() {
  await connectDb();
  const closed = await closeOrphanedSessions();
  if (closed) logger.warn({ closed }, 'Closed attendance sessions left open by a previous process');

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  const stopJob = startMeetingExpiryJob();

  server.listen(env.PORT, env.HOST, () => logger.info(`API listening on http://${env.HOST}:${env.PORT}`));

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    stopJob();
    // Close transports (not a server-initiated "disconnect" packet) so clients auto-reconnect
    // to the next process and reclaim their seats.
    io.engine.close();
    server.close();
    await disconnectDb().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
