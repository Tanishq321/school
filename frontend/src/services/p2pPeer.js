/**
 * One WebRTC connection to one remote participant (Phase 1: 1-to-1 / tiny mesh).
 *
 * Roles are deterministic so there is never offer glare:
 *   - the *initiator* (larger user id) creates the transceivers and sends every offer,
 *     including ICE restarts;
 *   - the *responder* only answers. If it needs a restart it sends 'restart-request'.
 * Every message carries `pcId`, the session id chosen by the initiator. A new pcId from
 * the initiator means "new session": the responder throws away its old connection.
 */
const newId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

export class P2PPeer extends EventTarget {
  constructor({ remoteUserId, initiator, sessionId, rtcConfig, localTracks, send, refreshIce }) {
    super();
    this.remoteUserId = remoteUserId;
    this.initiator = initiator;
    this.sessionId = sessionId || newId();
    this.rtcConfig = rtcConfig;
    this.localTracks = { ...localTracks };
    this.send = (data) => send({ ...data, pcId: this.sessionId });
    this.refreshIce = refreshIce;
    this.remoteStream = new MediaStream();
    this.pendingCandidates = [];
    this.transceivers = { audio: null, video: null };
    this.restartAttempts = 0;
    this.closed = false;
    this.createdAt = Date.now();
    this.stats = null;
    this._lastInbound = {};

    this.pc = new RTCPeerConnection(rtcConfig);
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'candidate', candidate: candidate.toJSON() });
    };
    this.pc.ontrack = ({ track }) => {
      this.remoteStream.getTracks().filter((t) => t.kind === track.kind).forEach((t) => this.remoteStream.removeTrack(t));
      this.remoteStream.addTrack(track);
      this._emit('track');
    };
    this.pc.onconnectionstatechange = () => this._onConnectionState();
    this.pc.oniceconnectionstatechange = () => this._emit('state');

    if (initiator) {
      // Transceivers exist from the start so turning the camera on later never needs renegotiation.
      for (const kind of ['audio', 'video']) {
        const t = this.localTracks[kind];
        this.transceivers[kind] = this.pc.addTransceiver(t || kind, { direction: 'sendrecv' });
      }
      this.pc.onnegotiationneeded = () => this._makeOffer();
    }
    this._statsTimer = setInterval(() => this._collectStats(), 2000);
  }

  get connectionState() {
    return this.pc.connectionState;
  }

  _emit(type) {
    this.dispatchEvent(new Event(type));
  }

  async _makeOffer({ iceRestart = false } = {}) {
    if (this.closed) return;
    try {
      if (iceRestart) this.pc.restartIce();
      const offer = await this.pc.createOffer({ iceRestart });
      if (this.pc.signalingState !== 'stable' && !iceRestart) return;
      await this.pc.setLocalDescription(offer);
      this.send({ type: 'description', description: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } });
    } catch (err) {
      console.warn('[p2p] offer failed', err);
    }
  }

  async handleSignal(data) {
    if (this.closed) return;
    try {
      if (data.type === 'description') {
        const desc = data.description;
        if (desc.type === 'offer') {
          if (this.initiator) return; // initiator never accepts offers
          await this.pc.setRemoteDescription(desc);
          this._attachResponderTransceivers();
          await this.pc.setLocalDescription(await this.pc.createAnswer());
          this.send({ type: 'description', description: { type: this.pc.localDescription.type, sdp: this.pc.localDescription.sdp } });
        } else if (desc.type === 'answer') {
          if (this.pc.signalingState !== 'have-local-offer') return;
          await this.pc.setRemoteDescription(desc);
        }
        for (const c of this.pendingCandidates.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
      } else if (data.type === 'candidate' && data.candidate) {
        if (!this.pc.remoteDescription) this.pendingCandidates.push(data.candidate);
        else await this.pc.addIceCandidate(data.candidate).catch((e) => console.debug('[p2p] candidate rejected', e));
      } else if (data.type === 'restart-request' && this.initiator) {
        await this.restart();
      }
    } catch (err) {
      console.warn('[p2p] signal handling failed', err);
    }
  }

  _attachResponderTransceivers() {
    for (const t of this.pc.getTransceivers()) {
      const kind = t.receiver.track?.kind;
      if (!kind || this.transceivers[kind]) continue;
      this.transceivers[kind] = t;
      t.direction = 'sendrecv';
      t.sender.replaceTrack(this.localTracks[kind] || null).catch(() => {});
    }
  }

  /** Swap the outgoing track without renegotiation (camera on/off, device switch). */
  async setTrack(kind, track) {
    this.localTracks[kind] = track;
    const t = this.transceivers[kind];
    if (t && !this.closed) await t.sender.replaceTrack(track || null).catch((e) => console.warn('[p2p] replaceTrack', e));
  }

  async restart() {
    if (this.closed) return;
    if (!this.initiator) {
      this.send({ type: 'restart-request' });
      return;
    }
    this.restartAttempts += 1;
    try {
      const fresh = await this.refreshIce?.();
      if (fresh) {
        this.rtcConfig = { ...this.rtcConfig, iceServers: fresh };
        this.pc.setConfiguration(this.rtcConfig);
      }
    } catch {
      /* keep old credentials */
    }
    await this._makeOffer({ iceRestart: true });
  }

  _onConnectionState() {
    const s = this.pc.connectionState;
    clearTimeout(this._disconnectTimer);
    if (s === 'connected') this.restartAttempts = 0;
    if (s === 'disconnected') {
      // Often recovers by itself (Wi-Fi blip); restart if it doesn't within 4 s.
      this._disconnectTimer = setTimeout(() => this.pc.connectionState === 'disconnected' && this.restart(), 4000);
    }
    if (s === 'failed') {
      if (this.restartAttempts >= 3) this._emit('fatal');
      else this.restart();
    }
    this._emit('state');
  }

  async _collectStats() {
    if (this.closed || this.pc.connectionState !== 'connected') return;
    try {
      const report = await this.pc.getStats();
      let pair;
      let local;
      const inbound = {};
      let outgoingBitrate;
      report.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = report.get(r.selectedCandidatePairId);
        if (r.type === 'inbound-rtp' && !r.isRemote) inbound[r.kind] = r;
      });
      if (!pair) report.forEach((r) => r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && (pair = r));
      if (pair) {
        local = report.get(pair.localCandidateId);
        outgoingBitrate = pair.availableOutgoingBitrate;
      }
      const v = inbound.video;
      const a = inbound.audio;
      let lossPct = 0;
      const src = v || a;
      if (src) {
        const prev = this._lastInbound;
        const dLost = (src.packetsLost ?? 0) - (prev.lost ?? 0);
        const dRecv = (src.packetsReceived ?? 0) - (prev.recv ?? 0);
        lossPct = dRecv + dLost > 0 ? Math.max(0, (dLost / (dRecv + dLost)) * 100) : 0;
        this._lastInbound = { lost: src.packetsLost ?? 0, recv: src.packetsReceived ?? 0 };
      }
      const rttMs = pair?.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
      const jitterMs = a?.jitter != null ? Math.round(a.jitter * 1000) : null;
      const quality = lossPct > 8 || (rttMs ?? 0) > 600 ? 'poor' : lossPct > 2 || (rttMs ?? 0) > 300 ? 'fair' : 'good';
      this.stats = {
        quality,
        rttMs,
        jitterMs,
        lossPct: Math.round(lossPct * 10) / 10,
        relayed: local?.candidateType === 'relay',
        route: local?.candidateType,
        protocol: local?.relayProtocol || local?.protocol,
        video: v ? { width: v.frameWidth, height: v.frameHeight, fps: v.framesPerSecond, framesDecoded: v.framesDecoded } : null,
        outgoingKbps: outgoingBitrate ? Math.round(outgoingBitrate / 1000) : null,
      };
      this._emit('stats');
    } catch {
      /* stats are best-effort */
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._statsTimer);
    clearTimeout(this._disconnectTimer);
    this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = this.pc.onnegotiationneeded = null;
    this.pc.close();
    this.remoteStream.getTracks().forEach((t) => t.stop());
    this._emit('closed');
  }
}
