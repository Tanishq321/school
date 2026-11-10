import { Device } from 'mediasoup-client';

// Three simulcast layers: receivers get the layer that fits their tile and bandwidth.
const CAMERA_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 150_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 2, maxBitrate: 500_000, scalabilityMode: 'L1T3' },
  { scaleResolutionDownBy: 1, maxBitrate: 1_200_000, scalabilityMode: 'L1T3' },
];

const newSessionId = () => `s-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

/**
 * One participant's connection to the mediasoup SFU: a send transport (our mic + camera)
 * and a receive transport (everyone else's media). Emits:
 *   'remote'  detail { userId, stream, version }  when a participant's incoming tracks change
 *   'network' detail { quality, rttMs, lossPct, relayed }
 *   'notice'  detail { type, message }            e.g. unmute refused by host policy
 */
export class SfuSession extends EventTarget {
  constructor({ socket, localMedia, iceServers, forceRelay }) {
    super();
    this.socket = socket;
    this.localMedia = localMedia;
    this.iceServers = iceServers || [];
    this.forceRelay = forceRelay;
    this.sessionId = newSessionId();
    this.device = null;
    this.send = null;
    this.recv = null;
    this.mic = null;
    this.cam = null;
    this.consumers = new Map(); // consumerId -> Consumer
    this.pendingProducers = new Map(); // producerId -> info (while not ready / in flight)
    this.versions = new Map(); // userId -> number
    this.preferred = new Map(); // consumerId -> spatial layer
    this.ready = false;
    this.closed = false;
    this._chain = Promise.resolve();
  }

  async req(event, data) {
    const res = await this.socket
      .timeout(10_000)
      .emitWithAck(event, data)
      .catch(() => ({ ok: false, error: { code: 'timeout', message: 'The media server did not respond' } }));
    if (!res.ok) throw Object.assign(new Error(res.error?.message || 'Media error'), { code: res.error?.code });
    return res;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /** Serialise local publishing changes so toggles can't race each other. */
  _queue(fn) {
    this._chain = this._chain.then(fn).catch((err) => console.warn('[sfu]', err));
    return this._chain;
  }

  async start() {
    const { rtpCapabilities } = await this.req('mediasoup:getRouterRtpCapabilities');
    if (!this.device) {
      this.device = Device.factory ? await Device.factory() : new Device();
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    }
    const { producers } = await this.req('mediasoup:join', { sessionId: this.sessionId, rtpCapabilities: this.device.rtpCapabilities });
    this.send = await this._createTransport('send');
    this.recv = await this._createTransport('recv');
    this.ready = true;
    this._statsTimer = setInterval(() => this._collectStats(), 3000);
    await this.syncLocal();
    for (const p of producers) this._consume(p);
    for (const p of this.pendingProducers.values()) this._consume(p);
  }

  async _createTransport(direction) {
    const { transport: params } = await this.req('mediasoup:createWebRtcTransport', { direction });
    const opts = { ...params, iceServers: this.iceServers, iceTransportPolicy: this.forceRelay ? 'relay' : 'all' };
    const t = direction === 'send' ? this.device.createSendTransport(opts) : this.device.createRecvTransport(opts);
    t.on('connect', ({ dtlsParameters }, cb, eb) => {
      this.req('mediasoup:connectTransport', { transportId: t.id, dtlsParameters }).then(() => cb(), eb);
    });
    if (direction === 'send') {
      t.on('produce', ({ kind, rtpParameters, appData }, cb, eb) => {
        this.req('mediasoup:produce', { transportId: t.id, kind, rtpParameters, source: appData.source, paused: Boolean(appData.paused) })
          .then(({ id, paused }) => {
            appData.serverPaused = paused;
            cb({ id });
          }, eb);
      });
    }
    t.on('connectionstatechange', (state) => {
      clearTimeout(t._dcTimer);
      if (direction === 'recv') this._emit('recvstate', { state });
      if (state === 'failed') this._restartIce(t);
      if (state === 'disconnected') t._dcTimer = setTimeout(() => t.connectionState === 'disconnected' && this._restartIce(t), 4000);
    });
    return t;
  }

  async _restartIce(t) {
    if (this.closed || t.closed) return;
    try {
      const fresh = await this.req('ice:refresh').catch(() => null);
      if (fresh?.iceServers) {
        this.iceServers = fresh.iceServers;
        await t.updateIceServers?.({ iceServers: fresh.iceServers }).catch(() => {});
      }
      const { iceParameters } = await this.req('mediasoup:restartIce', { transportId: t.id });
      await t.restartIce({ iceParameters });
    } catch (err) {
      console.warn('[sfu] ICE restart failed', err);
    }
  }

  // ------------------------------------------------------------ publishing

  syncLocal() {
    return this._queue(() => this._syncLocal());
  }

  async _syncLocal() {
    if (!this.ready || this.closed) return;
    const lm = this.localMedia;

    // Microphone: one producer for the whole session, paused while muted.
    if (lm.audioTrack) {
      if (!this.mic || this.mic.closed) {
        this.mic = await this.send.produce({
          track: lm.audioTrack,
          stopTracks: false,
          zeroRtpOnPause: true,
          codecOptions: { opusStereo: false, opusDtx: true, opusFec: true },
          appData: { source: 'mic', paused: !lm.audioEnabled },
        });
        if (this.mic.appData.serverPaused) this.mic.pause();
      } else if (this.mic.track !== lm.audioTrack) {
        await this.mic.replaceTrack({ track: lm.audioTrack });
      }
      if (lm.audioEnabled && this.mic.paused) {
        try {
          await this.req('mediasoup:resumeProducer', { producerId: this.mic.id });
          this.mic.resume();
        } catch (err) {
          lm.setAudioEnabled(false);
          this._emit('notice', { type: 'unmute_refused', message: err.message });
        }
      } else if (!lm.audioEnabled && !this.mic.paused) {
        this.mic.pause();
        await this.req('mediasoup:pauseProducer', { producerId: this.mic.id }).catch(() => {});
      }
    } else if (this.mic) {
      const id = this.mic.id;
      this.mic.close();
      this.mic = null;
      await this.req('mediasoup:closeProducer', { producerId: id }).catch(() => {});
    }

    // Camera: produced only while on (camera off releases the device and closes the producer).
    const camTrack = lm.videoEnabled ? lm.videoTrack : null;
    if (camTrack) {
      if (!this.cam || this.cam.closed) {
        this.cam = await this.send.produce({
          track: camTrack,
          stopTracks: false,
          encodings: CAMERA_ENCODINGS,
          codecOptions: { videoGoogleStartBitrate: 800 },
          appData: { source: 'camera' },
        });
      } else if (this.cam.track !== camTrack) {
        await this.cam.replaceTrack({ track: camTrack });
      }
    } else if (this.cam) {
      const id = this.cam.id;
      this.cam.close();
      this.cam = null;
      await this.req('mediasoup:closeProducer', { producerId: id }).catch(() => {});
    }
  }

  // ------------------------------------------------------------ receiving

  onNewProducer(info) {
    if (!this.ready) {
      this.pendingProducers.set(info.producerId, info);
      return;
    }
    this._consume(info);
  }

  async _consume(info) {
    if (this.closed) return;
    if ([...this.consumers.values()].some((c) => c.producerId === info.producerId) || this.pendingProducers.get(info.producerId)?.inFlight) return;
    this.pendingProducers.set(info.producerId, { ...info, inFlight: true });
    try {
      const { consumer: params } = await this.req('mediasoup:consume', { producerId: info.producerId });
      const consumer = await this.recv.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
        appData: { userId: params.userId, source: info.source },
      });
      this.consumers.set(consumer.id, consumer);
      this._publishRemote(params.userId);
      await this.req('mediasoup:resumeConsumer', { consumerId: consumer.id });
      const layer = this.preferred.get(params.userId);
      if (consumer.kind === 'video' && layer != null) this._applyLayer(consumer, layer);
    } catch (err) {
      if (err.code !== 'producer_gone' && err.code !== 'already_consuming') console.warn('[sfu] consume failed', err);
    } finally {
      this.pendingProducers.delete(info.producerId);
    }
  }

  onConsumerClosed({ consumerId }) {
    const c = this.consumers.get(consumerId);
    if (!c) return;
    this.consumers.delete(consumerId);
    c.close();
    this._publishRemote(c.appData.userId);
  }

  _publishRemote(userId) {
    const tracks = [...this.consumers.values()].filter((c) => c.appData.userId === userId && !c.closed).map((c) => c.track);
    const version = (this.versions.get(userId) || 0) + 1;
    this.versions.set(userId, version);
    this._emit('remote', { userId, stream: tracks.length ? new MediaStream(tracks) : null, version });
  }

  /** 0 = thumbnail, 1 = medium tile, 2 = large/spotlight. Saves bandwidth for everyone. */
  setPreferredLayer(userId, spatialLayer) {
    if (this.preferred.get(userId) === spatialLayer) return;
    this.preferred.set(userId, spatialLayer);
    for (const c of this.consumers.values()) if (c.appData.userId === userId && c.kind === 'video') this._applyLayer(c, spatialLayer);
  }

  _applyLayer(consumer, spatialLayer) {
    this.req('mediasoup:setPreferredLayers', { consumerId: consumer.id, spatialLayer }).catch(() => {});
  }

  /** After a signalling reconnect: keep transports if the server still has them, else rebuild. */
  async resync() {
    if (!this.ready || this.closed) return;
    const res = await this.req('mediasoup:join', { sessionId: this.sessionId, rtpCapabilities: this.device.rtpCapabilities }).catch(() => null);
    if (!res) return;
    if (!res.resumed) {
      await this.rebuild();
      return;
    }
    const live = new Set(res.producers.map((p) => p.producerId));
    for (const c of [...this.consumers.values()]) if (!live.has(c.producerId)) this.onConsumerClosed({ consumerId: c.id });
    for (const p of res.producers) this._consume(p);
    await this.syncLocal();
  }

  /** Full rebuild (server restarted, media worker replaced, or session lost). */
  async rebuild() {
    this._closeLocal();
    this.closed = false;
    this.sessionId = newSessionId();
    await this.start();
  }

  async _collectStats() {
    if (!this.recv || this.closed) return;
    try {
      const [recvStats, sendStats] = await Promise.all([this.recv.getStats(), this.send?.getStats()]);
      let lost = 0;
      let received = 0;
      let rtt = null;
      let relayed = false;
      const read = (report) =>
        report?.forEach((r) => {
          if (r.type === 'inbound-rtp' && !r.isRemote) {
            lost += r.packetsLost || 0;
            received += r.packetsReceived || 0;
          }
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
            if (r.currentRoundTripTime != null) rtt = Math.max(rtt ?? 0, Math.round(r.currentRoundTripTime * 1000));
            if (report.get(r.localCandidateId)?.candidateType === 'relay') relayed = true;
          }
        });
      read(recvStats);
      read(sendStats);
      const prev = this._lastStats || { lost: 0, received: 0 };
      const dLost = Math.max(0, lost - prev.lost);
      const dRecv = Math.max(0, received - prev.received);
      this._lastStats = { lost, received };
      const lossPct = dLost + dRecv > 0 ? Math.round((dLost / (dLost + dRecv)) * 1000) / 10 : 0;
      const quality = lossPct > 8 || (rtt ?? 0) > 600 ? 'poor' : lossPct > 2 || (rtt ?? 0) > 300 ? 'fair' : 'good';
      this._emit('network', { quality, rttMs: rtt, lossPct, relayed });
    } catch {
      /* best effort */
    }
  }

  _closeLocal() {
    this.closed = true;
    this.ready = false;
    clearInterval(this._statsTimer);
    for (const c of this.consumers.values()) c.close();
    const users = new Set([...this.consumers.values()].map((c) => c.appData.userId));
    this.consumers.clear();
    users.forEach((u) => this._publishRemote(u));
    this.mic?.close();
    this.cam?.close();
    this.mic = null;
    this.cam = null;
    this.send?.close();
    this.recv?.close();
    this.send = null;
    this.recv = null;
  }

  close() {
    this._closeLocal();
  }
}
