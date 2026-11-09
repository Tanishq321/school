import { io } from 'socket.io-client';
import { api, freshAccessToken, SOCKET_URL } from './api.js';
import { P2PPeer } from './p2pPeer.js';

/**
 * Orchestrates one meeting session: REST join → Socket.IO admission → P2P peers.
 * React reads `client.state` after each 'change' event.
 *
 * phases: idle | joining | waiting | in-meeting | reconnecting | ended | denied | replaced | error
 */
export class MeetingClient extends EventTarget {
  constructor({ code, localMedia, forceRelay = false }) {
    super();
    this.code = code;
    this.localMedia = localMedia;
    this.forceRelay = forceRelay;
    this.peers = new Map(); // userId -> P2PPeer
    this.credentials = {};
    this.socket = null;
    this.state = {
      phase: 'idle',
      waitingReason: null,
      self: null,
      meeting: null,
      participants: [], // [{...member, stream, connectionState, stats, reconnecting}]
      waiting: [],
      error: null,
      signalling: 'disconnected',
      endedReason: null,
    };
    this._onLocalTrack = (e) => this._broadcastTrack(e.detail.kind, e.detail.track);
    this._onLocalChange = () => this._sendMediaState();
    localMedia.addEventListener('track', this._onLocalTrack);
    localMedia.addEventListener('change', this._onLocalChange);
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new Event('change'));
  }

  _notify(type, detail) {
    this.dispatchEvent(new CustomEvent('notice', { detail: { type, ...detail } }));
  }

  get rtcConfig() {
    return { iceServers: this.iceServers || [], iceTransportPolicy: this.forceRelay ? 'relay' : 'all', bundlePolicy: 'max-bundle' };
  }

  /** REST authorisation: password/invite are kept in memory so a dropped socket can rejoin. */
  async _authorize() {
    const res = await api(`/meetings/${encodeURIComponent(this.code)}/join`, { method: 'POST', body: this.credentials });
    this.iceServers = res.iceServers;
    this._set({ meeting: { ...this.state.meeting, ...res.meeting } });
    return res.joinToken;
  }

  async join(credentials = {}) {
    this.credentials = Object.fromEntries(Object.entries(credentials).filter(([, v]) => v));
    this._set({ phase: 'joining', error: null });
    let joinToken;
    try {
      joinToken = await this._authorize();
    } catch (err) {
      this._set({ phase: 'idle', error: { code: err.code, message: err.message } });
      throw err;
    }
    this._connectSocket();
    await this._emitJoin(joinToken);
  }

  _connectSocket() {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      // Called on every (re)connect so expired access tokens are refreshed first.
      auth: (cb) => freshAccessToken().then((token) => cb({ token }), () => cb({})),
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
    this.socket = socket;
    let firstConnect = true;

    socket.on('connect', async () => {
      this._set({ signalling: 'connected' });
      if (firstConnect) {
        firstConnect = false;
        return;
      }
      // Reconnected after a drop: reclaim our seat (the server holds it for a grace period).
      if (['in-meeting', 'waiting', 'reconnecting'].includes(this.state.phase)) {
        try {
          await this._emitJoin(await this._authorize());
        } catch (err) {
          this._fail(err);
        }
      }
    });
    socket.on('disconnect', (reason) => {
      this._set({ signalling: 'disconnected' });
      if (!['in-meeting', 'waiting'].includes(this.state.phase)) return;
      if (this.state.phase === 'in-meeting') this._set({ phase: 'reconnecting' });
      // Socket.IO doesn't auto-reconnect after a server-side disconnect; do it ourselves.
      if (reason === 'io server disconnect') setTimeout(() => this.socket?.connect(), 1000);
    });
    socket.on('connect_error', (err) => {
      if (err.data?.code === 'email_not_verified' || err.data?.code === 'unauthorized') {
        this._fail({ code: err.data.code, message: err.message });
        socket.close();
      } else {
        this._set({ signalling: 'reconnecting' });
      }
    });

    socket.on('meeting:admitted', (payload) => this._onAdmitted(payload));
    socket.on('meeting:started', () => this._set({ waitingReason: this.state.waitingReason === 'host_not_started' ? 'awaiting_approval' : this.state.waitingReason }));
    socket.on('waiting:status', ({ reason }) => this._set({ waitingReason: reason }));
    socket.on('waiting:updated', ({ waiting }) => {
      const before = new Set(this.state.waiting.map((w) => w.userId));
      waiting.filter((w) => !before.has(w.userId)).forEach((w) => this._notify('waiting', { name: w.name }));
      this._set({ waiting });
    });
    socket.on('meeting:denied', () => this._terminate('denied'));
    socket.on('meeting:replaced', () => this._terminate('replaced'));
    socket.on('meeting:ended', ({ reason }) => this._terminate('ended', reason));
    socket.on('meeting:force-leave', () => this.leave());

    socket.on('participant:joined', (p) => {
      this._upsertParticipant(p);
      this._notify('joined', { name: p.name });
      this._ensurePeer(p.userId);
    });
    socket.on('participant:left', ({ userId }) => {
      const p = this.state.participants.find((x) => x.userId === userId);
      this._removePeer(userId);
      this._set({ participants: this.state.participants.filter((x) => x.userId !== userId) });
      if (p) this._notify('left', { name: p.name });
    });
    socket.on('participant:reconnecting', ({ userId }) => this._patchParticipant(userId, { reconnecting: true }));
    socket.on('participant:reconnected', (p) => {
      this._upsertParticipant({ ...p, reconnecting: false });
      this._ensurePeer(p.userId);
    });
    socket.on('participant:mediaState', ({ userId, audio, video }) => this._patchParticipant(userId, { audio, video }));
    socket.on('p2p:signal', ({ from, data }) => this._onSignal(from, data));
  }

  async _emitJoin(joinToken) {
    const res = await this.socket.timeout(10_000).emitWithAck('meeting:join', { joinToken }).catch(() => ({ ok: false, error: { code: 'timeout', message: 'The server did not respond. Check your connection.' } }));
    if (!res.ok) {
      this._fail(res.error);
      return;
    }
    if (res.status === 'waiting') this._set({ phase: 'waiting', waitingReason: res.reason });
    else this._onAdmitted(res);
  }

  _onAdmitted({ self, participants, waiting, meeting }) {
    const known = new Map(this.state.participants.map((p) => [p.userId, p]));
    this._set({
      phase: 'in-meeting',
      waitingReason: null,
      self,
      waiting: waiting || [],
      meeting: { ...this.state.meeting, ...meeting },
      participants: participants.map((p) => ({ ...known.get(p.userId), ...p, reconnecting: !p.connected })),
    });
    // Drop peers for people who left while we were away.
    for (const id of [...this.peers.keys()]) if (!participants.some((p) => p.userId === id)) this._removePeer(id);
    participants.forEach((p) => this._ensurePeer(p.userId));
    this._sendMediaState();
    this._startWatchdog();
  }

  /** Safety net: if a pair has no working session for a while, ask for (or start) a new one. */
  _startWatchdog() {
    if (this._watchdog) return;
    this._watchdog = setInterval(() => {
      if (this.state.phase !== 'in-meeting' || !this.socket?.connected) return;
      for (const p of this.state.participants) {
        if (p.reconnecting) continue;
        const peer = this.peers.get(p.userId);
        const stale = peer && Date.now() - peer.createdAt > 15_000 && ['new', 'closed'].includes(peer.connectionState);
        if (!peer || stale) {
          if (stale) this._removePeer(p.userId);
          this._ensurePeer(p.userId);
        }
      }
    }, 6000);
  }

  _isInitiator(remoteUserId) {
    return this.state.self.userId > remoteUserId;
  }

  _ensurePeer(userId, sessionId) {
    if (!this.state.self || userId === this.state.self.userId) return null;
    const existing = this.peers.get(userId);
    if (existing && !existing.closed && (!sessionId || existing.sessionId === sessionId)) return existing;
    if (existing) this._removePeer(userId);

    const initiator = this._isInitiator(userId);
    if (!initiator && !sessionId) {
      // Ask the initiator to (re)start a session with us; it will send an offer.
      this._signal(userId, { type: 'restart-request', pcId: 'none' });
      return null;
    }
    const lm = this.localMedia;
    const peer = new P2PPeer({
      remoteUserId: userId,
      initiator,
      sessionId,
      rtcConfig: this.rtcConfig,
      localTracks: { audio: lm.audioTrack, video: lm.videoEnabled ? lm.videoTrack : null },
      send: (data) => this._signal(userId, data),
      refreshIce: async () => {
        const res = await this.socket.timeout(5000).emitWithAck('ice:refresh');
        if (res.ok) this.iceServers = res.iceServers;
        return res.ok ? res.iceServers : null;
      },
    });
    const sync = () =>
      this._patchParticipant(userId, {
        stream: peer.remoteStream,
        connectionState: peer.connectionState,
        stats: peer.stats,
        streamVersion: (this.state.participants.find((p) => p.userId === userId)?.streamVersion || 0) + 1,
      });
    peer.addEventListener('track', sync);
    peer.addEventListener('state', sync);
    peer.addEventListener('stats', sync);
    peer.addEventListener('fatal', () => {
      // ICE restarts didn't help: start a brand-new session.
      this._removePeer(userId);
      if (initiator) this._ensurePeer(userId);
    });
    this.peers.set(userId, peer);
    sync();
    return peer;
  }

  _removePeer(userId) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    this.peers.delete(userId);
    peer.close();
  }

  async _onSignal(from, data) {
    if (!this.state.self || !this.state.participants.some((p) => p.userId === from)) return;
    const initiator = this._isInitiator(from);
    let peer = this.peers.get(from);
    if (initiator) {
      if (data.type === 'restart-request' && (!peer || data.pcId !== peer.sessionId)) {
        // A brand-new session whose offer is still in flight: nothing to do.
        const young = peer && Date.now() - peer.createdAt < 5000 && ['new', 'connecting'].includes(peer.connectionState);
        if (data.pcId === 'none' && young) return;
        // Responder lost its session (reload/new device): start fresh.
        this._removePeer(from);
        this._ensurePeer(from);
        return;
      }
      if (!peer || data.pcId !== peer.sessionId) return; // stale message
    } else if (!peer || peer.sessionId !== data.pcId) {
      if (data.type !== 'description' || data.description?.type !== 'offer') return;
      peer = this._ensurePeer(from, data.pcId);
    }
    await peer?.handleSignal(data);
  }

  _signal(to, data) {
    this.socket?.emit('p2p:signal', { to, data }, (res) => {
      if (res && !res.ok && res.error?.code !== 'peer_unavailable') console.warn('[signal]', res.error);
    });
  }

  _broadcastTrack(kind, track) {
    const sendTrack = kind === 'video' && !this.localMedia.videoEnabled ? null : track;
    for (const peer of this.peers.values()) peer.setTrack(kind, sendTrack);
  }

  _sendMediaState() {
    if (this.state.phase !== 'in-meeting' || !this.socket?.connected) return;
    const lm = this.localMedia;
    const audio = Boolean(lm.audioTrack && lm.audioEnabled);
    const video = Boolean(lm.videoTrack && lm.videoEnabled);
    if (this._lastMedia?.audio === audio && this._lastMedia?.video === video && this._lastMediaSocket === this.socket.id) return;
    this._lastMedia = { audio, video };
    this._lastMediaSocket = this.socket.id;
    this.socket.emit('media:state', { audio, video });
    if (this.state.self) this._set({ self: { ...this.state.self, audio, video } });
  }

  _upsertParticipant(p) {
    const exists = this.state.participants.some((x) => x.userId === p.userId);
    this._set({
      participants: exists ? this.state.participants.map((x) => (x.userId === p.userId ? { ...x, ...p } : x)) : [...this.state.participants, p],
    });
  }

  _patchParticipant(userId, patch) {
    if (!this.state.participants.some((x) => x.userId === userId)) return;
    this._set({ participants: this.state.participants.map((x) => (x.userId === userId ? { ...x, ...patch } : x)) });
  }

  // ------------------------------------------------------------- host actions

  async _ack(event, payload) {
    const res = await this.socket.timeout(8000).emitWithAck(event, payload).catch(() => ({ ok: false, error: { message: 'No response from server' } }));
    if (!res.ok) throw Object.assign(new Error(res.error?.message || 'Action failed'), { code: res.error?.code });
    return res;
  }

  admit(userId) {
    return this._ack('waiting:admit', { userId });
  }

  deny(userId) {
    return this._ack('waiting:deny', { userId });
  }

  async endForAll() {
    await this._ack('meeting:end');
  }

  async leave() {
    if (this.socket?.connected) await this._ack('meeting:leave').catch(() => {});
    this._terminate('left');
  }

  _fail(error) {
    this._set({ phase: 'error', error: { code: error?.code || 'error', message: error?.message || 'Something went wrong' } });
    this._teardown();
  }

  _terminate(phase, reason = null) {
    this._set({ phase, endedReason: reason });
    this._teardown();
  }

  _teardown() {
    clearInterval(this._watchdog);
    this._watchdog = null;
    for (const id of [...this.peers.keys()]) this._removePeer(id);
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
  }

  destroy() {
    this.localMedia.removeEventListener('track', this._onLocalTrack);
    this.localMedia.removeEventListener('change', this._onLocalChange);
    this._teardown();
  }
}
