import os from 'node:os';
import * as mediasoup from 'mediasoup';
import env from '../config/env.js';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * A fixed pool of mediasoup workers (one per core by default, never unbounded).
 * Each worker owns one WebRtcServer, so the firewall only needs PORT_BASE..PORT_BASE+N-1 (UDP+TCP).
 * Rooms are placed on the least-loaded worker. A dead worker is replaced and its rooms are rebuilt.
 */
class WorkerPool {
  constructor() {
    this.entries = []; // { index, worker, webRtcServer, rooms:Set<meetingId> }
    this.ready = false;
    this.onWorkerDied = null; // (meetingIds: string[]) => void
  }

  get enabled() {
    return env.MEDIASOUP_ENABLED;
  }

  async start() {
    if (!this.enabled || this.ready) return;
    const n = env.MEDIASOUP_NUM_WORKERS ?? Math.max(1, os.availableParallelism?.() ?? os.cpus().length);
    for (let i = 0; i < n; i += 1) this.entries.push(await this._createEntry(i));
    this.ready = true;
    logger.info({ workers: n, ports: `${env.MEDIASOUP_PORT_BASE}-${env.MEDIASOUP_PORT_BASE + n - 1}` }, 'mediasoup workers started');
  }

  async _createEntry(index) {
    const worker = await mediasoup.createWorker({ logLevel: 'warn', logTags: ['ice', 'dtls'] });
    const port = env.MEDIASOUP_PORT_BASE + index;
    const listen = { ip: env.MEDIASOUP_LISTEN_IP, announcedAddress: env.MEDIASOUP_ANNOUNCED_ADDRESS || undefined, port };
    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        { ...listen, protocol: 'udp' },
        { ...listen, protocol: 'tcp' },
      ],
    });
    const entry = { index, worker, webRtcServer, rooms: new Set() };
    worker.on('died', (err) => this._handleDeath(entry, err));
    return entry;
  }

  async _handleDeath(entry, err) {
    logger.error({ err, pid: entry.worker.pid, index: entry.index }, 'mediasoup worker died; replacing it');
    const affected = [...entry.rooms];
    const pos = this.entries.indexOf(entry);
    try {
      const replacement = await this._createEntry(entry.index);
      if (pos >= 0) this.entries[pos] = replacement;
    } catch (e) {
      logger.fatal({ err: e }, 'could not replace mediasoup worker');
      if (pos >= 0) this.entries.splice(pos, 1);
    }
    this.onWorkerDied?.(affected);
  }

  /** Least-loaded worker with capacity. */
  pick() {
    const candidates = this.entries.filter((e) => !e.worker.closed && e.rooms.size < env.MEDIASOUP_MAX_ROOMS_PER_WORKER);
    if (!candidates.length) throw new AppError(503, 'media_server_busy', 'All media servers are busy. Try again shortly.');
    return candidates.reduce((a, b) => (b.rooms.size < a.rooms.size ? b : a));
  }

  status() {
    return this.entries.map((e) => ({ index: e.index, pid: e.worker.pid, closed: e.worker.closed, rooms: e.rooms.size }));
  }

  async close() {
    for (const e of this.entries) e.worker.close();
    this.entries = [];
    this.ready = false;
  }
}

export const workerPool = new WorkerPool();
