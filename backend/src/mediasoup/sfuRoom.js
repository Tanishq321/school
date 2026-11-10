import env from '../config/env.js';
import logger from '../utils/logger.js';
import { AppError, badRequest, forbidden } from '../utils/errors.js';
import { ALLOWED_SOURCES, mediaCodecs } from './config.js';
import { workerPool } from './workerPool.js';

/**
 * Media side of one meeting: a mediasoup Router plus, per participant, their transports,
 * producers and consumers. All lookups are scoped to the peer that owns them, so a client
 * can never touch another participant's transport/producer/consumer by guessing ids.
 */
export class SfuRoom {
  static async create(meetingId, emit) {
    const entry = workerPool.pick();
    const router = await entry.worker.createRouter({ mediaCodecs, appData: { meetingId } });
    const room = new SfuRoom(meetingId, entry, router, emit);
    entry.rooms.add(meetingId);
    room.speakerObserver = await router.createActiveSpeakerObserver({ interval: 400 });
    room.speakerObserver.on('dominantspeaker', ({ producer }) => {
      emit.toRoom('room:activeSpeaker', { userId: producer.appData.userId });
    });
    return room;
  }

  constructor(meetingId, entry, router, emit) {
    this.meetingId = meetingId;
    this.entry = entry;
    this.router = router;
    this.emit = emit; // { toRoom(event, data), toUser(userId, event, data) }
    this.peers = new Map(); // userId -> Peer
    this.closed = false;
  }

  get rtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  /** Register (or resume) a participant's media session. Returns whether old transports were kept. */
  joinPeer(userId, { sessionId, rtpCapabilities }) {
    const existing = this.peers.get(userId);
    if (existing && existing.sessionId === sessionId) {
      existing.rtpCapabilities = rtpCapabilities;
      return { resumed: true, producers: this.listProducers(userId) };
    }
    if (existing) this.removePeer(userId);
    this.peers.set(userId, {
      userId,
      sessionId,
      rtpCapabilities,
      transports: new Map(),
      producers: new Map(), // producerId -> Producer
      consumers: new Map(), // consumerId -> Consumer
    });
    return { resumed: false, producers: this.listProducers(userId) };
  }

  peer(userId) {
    const p = this.peers.get(userId);
    if (!p) throw forbidden('Media session not started', 'no_media_session');
    return p;
  }

  listProducers(exceptUserId) {
    const out = [];
    for (const p of this.peers.values()) {
      if (p.userId === exceptUserId) continue;
      for (const pr of p.producers.values()) out.push(this.describeProducer(pr));
    }
    return out;
  }

  describeProducer(pr) {
    return { producerId: pr.id, userId: pr.appData.userId, kind: pr.kind, source: pr.appData.source, paused: pr.paused };
  }

  async createTransport(userId, direction) {
    const peer = this.peer(userId);
    if ([...peer.transports.values()].some((t) => t.appData.direction === direction)) {
      throw new AppError(409, 'transport_exists', `A ${direction} transport already exists`);
    }
    const transport = await this.router.createWebRtcTransport({
      webRtcServer: this.entry.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 800_000,
      appData: { userId, direction },
    });
    if (direction === 'send') await transport.setMaxIncomingBitrate(env.MEDIASOUP_MAX_INCOMING_BITRATE).catch(() => {});
    transport.on('dtlsstatechange', (s) => s === 'failed' && logger.warn({ userId }, 'DTLS failed'));
    peer.transports.set(transport.id, transport);
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  transport(userId, transportId) {
    const t = this.peer(userId).transports.get(transportId);
    if (!t) throw badRequest('Unknown transport');
    return t;
  }

  async connectTransport(userId, transportId, dtlsParameters) {
    await this.transport(userId, transportId).connect({ dtlsParameters });
  }

  async restartIce(userId, transportId) {
    return { iceParameters: await this.transport(userId, transportId).restartIce() };
  }

  async produce(userId, { transportId, kind, rtpParameters, source, paused }) {
    const peer = this.peer(userId);
    const transport = this.transport(userId, transportId);
    if (transport.appData.direction !== 'send') throw badRequest('Not a send transport');
    if (!ALLOWED_SOURCES.includes(source)) throw badRequest('Unsupported source');
    if ((source === 'mic') !== (kind === 'audio')) throw badRequest('Source/kind mismatch');
    if ([...peer.producers.values()].some((p) => p.appData.source === source)) {
      throw new AppError(409, 'already_producing', `Already sending ${source}`);
    }
    const producer = await transport.produce({ kind, rtpParameters, paused: Boolean(paused), appData: { userId, source } });
    peer.producers.set(producer.id, producer);
    producer.on('transportclose', () => peer.producers.delete(producer.id));
    if (kind === 'audio') this.speakerObserver.addProducer({ producerId: producer.id }).catch(() => {});
    // Tell everyone else so they can consume it.
    for (const other of this.peers.values()) {
      if (other.userId !== userId) this.emit.toUser(other.userId, 'mediasoup:newProducer', this.describeProducer(producer));
    }
    return producer;
  }

  producer(userId, producerId) {
    const p = this.peer(userId).producers.get(producerId);
    if (!p) throw badRequest('Unknown producer');
    return p;
  }

  findProducer(userId, source) {
    const peer = this.peers.get(userId);
    return peer ? [...peer.producers.values()].find((p) => p.appData.source === source) : undefined;
  }

  closeProducer(userId, producerId) {
    const p = this.producer(userId, producerId);
    p.close();
    this.peer(userId).producers.delete(producerId);
  }

  async consume(userId, producerId) {
    const peer = this.peer(userId);
    const recv = [...peer.transports.values()].find((t) => t.appData.direction === 'recv');
    if (!recv) throw badRequest('Create a receive transport first');
    if (!peer.rtpCapabilities) throw badRequest('Send your RTP capabilities first');
    const owner = [...this.peers.values()].find((p) => p.producers.has(producerId));
    if (!owner || owner.userId === userId) throw new AppError(404, 'producer_gone', 'That stream is no longer available');
    if ([...peer.consumers.values()].some((c) => c.producerId === producerId)) throw new AppError(409, 'already_consuming', 'Already receiving it');
    if (!this.router.canConsume({ producerId, rtpCapabilities: peer.rtpCapabilities })) {
      throw badRequest('Your browser cannot decode this stream');
    }
    const consumer = await recv.consume({
      producerId,
      rtpCapabilities: peer.rtpCapabilities,
      paused: true, // resumed by the client once its track is wired up (avoids losing the first keyframe)
      appData: { userId, ownerId: owner.userId },
    });
    peer.consumers.set(consumer.id, consumer);
    const notifyClosed = () => {
      peer.consumers.delete(consumer.id);
      this.emit.toUser(userId, 'mediasoup:consumerClosed', { consumerId: consumer.id, producerId });
    };
    consumer.on('producerclose', () => {
      consumer.close();
      notifyClosed();
    });
    consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
    consumer.on('producerpause', () => this.emit.toUser(userId, 'mediasoup:consumerPaused', { consumerId: consumer.id }));
    consumer.on('producerresume', () => this.emit.toUser(userId, 'mediasoup:consumerResumed', { consumerId: consumer.id }));
    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      userId: owner.userId,
      source: consumer.appData?.source ?? owner.producers.get(producerId)?.appData.source,
      producerPaused: consumer.producerPaused,
    };
  }

  consumer(userId, consumerId) {
    const c = this.peer(userId).consumers.get(consumerId);
    if (!c) throw badRequest('Unknown consumer');
    return c;
  }

  removePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    // Closing transports closes their producers/consumers; other peers' consumers fire 'producerclose'.
    for (const t of peer.transports.values()) t.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.router.close();
    this.entry.rooms.delete(this.meetingId);
    this.peers.clear();
  }
}
