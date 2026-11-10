import { io } from 'socket.io-client';
import { api, freshAccessToken, SOCKET_URL } from './api.js';
import { P2PPeer } from './p2pPeer.js';
import { SfuSession } from './sfuSession.js';
import { playCue } from './sounds.js';

const CUE_FOR = { joined: 'join', left: 'leave', waiting: 'knock', chat: 'message' };
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

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
      mediaMode: null, // 'sfu' | 'p2p'
      activeSpeaker: null,
      network: null,
      chat: [],
      chatUnread: 0,
      screenSharer: null,
      sharingScreen: false,
      boardOpen: false,
      recording: { active: false, available: false },
      recordingConsents: [],
    };
    this.sfu = null;
    this.chatVisible = false;
    this.screenTrack = null;
    // Whiteboard data lives outside React state; the canvas listens for 'board' events and redraws itself.
    this.board = { ops: [], live: new Map() };
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
    if (CUE_FOR[type]) playCue(CUE_FOR[type]);
    this.dispatchEvent(new CustomEvent('notice', { detail: { type, ...detail } }));
  }

  _boardEvent(kind, data) {
    this.dispatchEvent(new CustomEvent('board', { detail: { kind, ...data } }));
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
    socket.on('meeting:removed', () => this._terminate('removed'));
    socket.on('meeting:locked', ({ locked }) => this._set({ meeting: { ...this.state.meeting, locked } }));
    socket.on('meeting:permissions', (permissions) => this._set({ meeting: { ...this.state.meeting, permissions } }));
    socket.on('participant:updated', (p) => {
      if (p.userId === this.state.self?.userId) {
        const before = this.state.self;
        this._set({ self: { ...before, ...p, audio: before.audio, video: before.video } });
      } else {
        this._upsertParticipant(p);
      }
    });
    socket.on('participant:mutedByHost', () => {
      this.localMedia.setAudioEnabled(false);
      this._notify('mutedByHost', {});
    });
    socket.on('room:activeSpeaker', ({ userId }) => this._set({ activeSpeaker: userId }));

    // ---- chat
    socket.on('chat:message', (m) => {
      if (this.state.chat.some((x) => x.id === m.id)) return;
      const mine = m.userId === this.state.self?.userId;
      this._set({ chat: [...this.state.chat, m].slice(-300), chatUnread: this.chatVisible || mine ? 0 : this.state.chatUnread + 1 });
      if (!mine && !this.chatVisible) this._notify('chat', { name: m.name, text: m.text });
    });
    socket.on('chat:deleted', ({ id }) => this._set({ chat: this.state.chat.filter((m) => m.id !== id) }));

    // ---- whiteboard
    socket.on('whiteboard:opened', ({ open }) => {
      this._set({ boardOpen: open });
      if (open) this._loadBoard();
    });
    socket.on('whiteboard:draw', ({ op }) => {
      if (this.board.ops.some((o) => o.id === op.id)) return;
      this.board.live.delete(op.id);
      this.board.ops.push(op);
      this._boardEvent('changed');
    });
    socket.on('whiteboard:live', (live) => {
      const cur = this.board.live.get(live.id);
      this.board.live.set(live.id, { ...live, points: cur && !live.reset ? [...cur.points, ...live.points] : live.points });
      this._boardEvent('live');
    });
    socket.on('whiteboard:erased', ({ id }) => {
      this.board.ops = this.board.ops.filter((o) => o.id !== id);
      this._boardEvent('changed');
    });
    socket.on('whiteboard:cleared', () => {
      this.board.ops = [];
      this.board.live.clear();
      this._boardEvent('changed', { cleared: true });
    });

    // ---- screen sharing
    socket.on('screen:state', ({ userId }) => {
      this._set({ screenSharer: userId });
      if (userId !== this.state.self?.userId && this.state.sharingScreen) this._stopLocalScreen();
    });
    socket.on('screen:forceStop', () => {
      this._stopLocalScreen();
      this._notify('screenStopped', {});
    });
    socket.on('recording:state', (rec) => {
      const was = this.state.recording?.active;
      this._set({ recording: rec, recordingConsents: rec.active ? this.state.recordingConsents : [] });
      if (!was && rec.active) {
        playCue('recording');
        this._notify('recordingStarted', { by: rec.startedBy });
      }
    });
    socket.on('recording:consents', ({ consents }) => this._set({ recordingConsents: consents }));
    socket.on('recording:stopped', ({ reason }) => {
      playCue('recordingStopped');
      this._notify('recordingStopped', { reason });
    });
    socket.on('mediasoup:newProducer', (info) => this.sfu?.onNewProducer(info));
    socket.on('mediasoup:consumerClosed', (info) => this.sfu?.onConsumerClosed(info));
    socket.on('mediasoup:reset', () => this.sfu?.rebuild().catch((e) => console.warn('[sfu] rebuild failed', e)));

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

  _onAdmitted({ self, participants, waiting, meeting, resumed, recording, recordingConsents }) {
    const known = new Map(this.state.participants.map((p) => [p.userId, p]));
    this._set({
      phase: 'in-meeting',
      waitingReason: null,
      self,
      waiting: waiting || [],
      mediaMode: meeting.mediaMode || 'p2p',
      screenSharer: meeting.screenSharer ?? null,
      boardOpen: Boolean(meeting.boardOpen),
      recording: recording || { active: false, available: false },
      recordingConsents: recordingConsents || [],
      meeting: { ...this.state.meeting, ...meeting },
      participants: participants.map((p) => ({ ...known.get(p.userId), ...p, reconnecting: !p.connected })),
    });
    if (!this._welcomed) {
      this._welcomed = true;
      if (!self.isHost) playCue('admitted');
    }
    this._loadChat();
    this._loadBoard();
    if (this.state.mediaMode === 'sfu') {
      this._startSfu(resumed);
      this._sendMediaState();
      return;
    }
    // Drop peers for people who left while we were away.
    for (const id of [...this.peers.keys()]) if (!participants.some((p) => p.userId === id)) this._removePeer(id);
    participants.forEach((p) => this._ensurePeer(p.userId));
    this._sendMediaState();
    this._startWatchdog();
  }

  async _startSfu(resumed) {
    if (this.sfu && !this.sfu.closed) {
      this.sfu.socket = this.socket;
      await this.sfu.resync().catch((e) => console.warn('[sfu] resync failed', e));
      return;
    }
    const sfu = new SfuSession({ socket: this.socket, localMedia: this.localMedia, iceServers: this.iceServers, forceRelay: this.forceRelay });
    this.sfu = sfu;
    sfu.addEventListener('remote', ({ detail }) =>
      this._patchParticipant(detail.userId, {
        stream: detail.stream,
        screenStream: detail.screenStream,
        streamVersion: detail.version,
        connectionState: 'connected',
      }),
    );
    sfu.addEventListener('network', ({ detail }) => this._set({ network: detail }));
    sfu.addEventListener('notice', ({ detail }) => this._notify(detail.type, detail));
    sfu.addEventListener('recvstate', ({ detail }) => this._set({ sfuState: detail.state }));
    try {
      await sfu.start();
    } catch (err) {
      console.warn('[sfu] start failed', err);
      this._notify('mediaError', { message: err.message || 'Could not connect to the media server' });
      // Retry once after a short delay (e.g. worker restarting).
      setTimeout(() => this.state.phase === 'in-meeting' && sfu.rebuild().catch(() => {}), 3000);
    }
    void resumed;
  }

  /** Spatial layer (0 low, 1 mid, 2 high) we want for a participant's video. SFU only. */
  setVideoQuality(userId, layer) {
    this.sfu?.setPreferredLayer(userId, layer);
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
    if (this.state.mediaMode === 'sfu') return null;
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
      localTracks: { audio: lm.audioTrack, video: lm.videoEnabled ? lm.videoTrack : null, screen: this.screenTrack },
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
        screenStream: peer.remoteScreen,
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
    if (this.state.mediaMode === 'sfu') {
      this.sfu?.syncLocal();
      return;
    }
    const sendTrack = kind === 'video' && !this.localMedia.videoEnabled ? null : track;
    for (const peer of this.peers.values()) peer.setTrack(kind, sendTrack);
  }

  _sendMediaState() {
    if (this.state.phase !== 'in-meeting' || !this.socket?.connected) return;
    const lm = this.localMedia;
    if (this.state.mediaMode === 'sfu') {
      // The server derives our audio/video state from the producers; keep our own view in sync.
      this.sfu?.syncLocal();
      const audio = Boolean(lm.audioTrack && lm.audioEnabled);
      const video = Boolean(lm.videoTrack && lm.videoEnabled);
      if (this.state.self && (this.state.self.audio !== audio || this.state.self.video !== video)) this._set({ self: { ...this.state.self, audio, video } });
      return;
    }
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

  // ------------------------------------------------------------- recording

  async startRecording() {
    const res = await this._ack('recording:start');
    this._set({ recording: res.recording });
  }

  stopRecording() {
    return this._ack('recording:stop');
  }

  async setRecordingConsent(accept) {
    const res = await this._ack('recording:consent', { accept });
    this._set({ recording: res.recording });
  }

  admit(userId) {
    return this._ack('waiting:admit', { userId });
  }

  // ------------------------------------------------------------- chat

  async _loadChat() {
    const res = await this.socket?.timeout(8000).emitWithAck('chat:history').catch(() => null);
    if (res?.ok) this._set({ chat: res.messages });
  }

  async sendChat(text) {
    await this._ack('chat:send', { text });
  }

  deleteChat(id) {
    return this._ack('chat:delete', { id });
  }

  setChatVisible(visible) {
    this.chatVisible = visible;
    if (visible && this.state.chatUnread) this._set({ chatUnread: 0 });
  }

  // ------------------------------------------------------------- whiteboard

  async _loadBoard() {
    const res = await this.socket?.timeout(8000).emitWithAck('whiteboard:state').catch(() => null);
    if (!res?.ok) return;
    this.board.ops = res.ops;
    this.board.live.clear();
    this._set({ boardOpen: res.open });
    this._boardEvent('changed');
  }

  openBoard(open) {
    return this._ack('whiteboard:open', { open });
  }

  /** Commit a finished operation (optimistic: drawn locally first, rolled back if refused). */
  async boardDraw(op) {
    const full = { ...op, id: op.id || newId(), author: this.state.self?.userId };
    this.board.ops.push(full);
    this._boardEvent('changed');
    try {
      const { author, ...wire } = full;
      void author;
      await this._ack('whiteboard:draw', { op: wire });
      return full;
    } catch (err) {
      this.board.ops = this.board.ops.filter((o) => o.id !== full.id);
      this._boardEvent('changed');
      throw err;
    }
  }

  boardLive(live) {
    this.socket?.volatile.emit('whiteboard:live', live);
  }

  async boardErase(id) {
    const removed = this.board.ops.find((o) => o.id === id);
    this.board.ops = this.board.ops.filter((o) => o.id !== id);
    this._boardEvent('changed');
    try {
      await this._ack('whiteboard:erase', { id });
    } catch (err) {
      if (removed) this.board.ops.push(removed);
      this._boardEvent('changed');
      throw err;
    }
    return removed;
  }

  boardClear() {
    return this._ack('whiteboard:clear');
  }

  // ------------------------------------------------------------- screen sharing

  get canShareScreen() {
    const self = this.state.self;
    return Boolean(self && (self.isHost || this.state.meeting?.permissions?.allowScreenShare));
  }

  async startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen sharing isn’t supported in this browser.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 }, width: { max: 1920 } }, audio: false });
    } catch (err) {
      if (err.name === 'NotAllowedError') return false; // user cancelled the picker
      throw err;
    }
    const track = stream.getVideoTracks()[0];
    track.contentHint = 'detail'; // favour sharpness (text, slides) over motion
    try {
      await this._ack('screen:start');
    } catch (err) {
      track.stop();
      throw err;
    }
    this.screenTrack = track;
    track.onended = () => this.stopScreenShare(); // the browser's own "Stop sharing" button
    this._set({ sharingScreen: true, screenSharer: this.state.self.userId });
    if (this.state.mediaMode === 'sfu') await this.sfu?.startScreen(track);
    else for (const peer of this.peers.values()) peer.setTrack('screen', track);
    return true;
  }

  async stopScreenShare() {
    if (!this.screenTrack) return;
    this._stopLocalScreen();
    await this._ack('screen:stop').catch(() => {});
  }

  _stopLocalScreen() {
    const track = this.screenTrack;
    this.screenTrack = null;
    if (track) {
      track.onended = null;
      track.stop();
    }
    if (this.state.mediaMode === 'sfu') this.sfu?.stopScreen();
    else for (const peer of this.peers.values()) peer.setTrack('screen', null);
    this._set({ sharingScreen: false, screenSharer: this.state.screenSharer === this.state.self?.userId ? null : this.state.screenSharer });
  }

  hostStopScreen() {
    return this._ack('host:stopScreen');
  }

  setPermissions(changes) {
    return this._ack('host:permissions', changes);
  }

  mute(userId) {
    return this._ack('host:mute', { userId });
  }

  remove(userId) {
    return this._ack('host:remove', { userId });
  }

  setLocked(locked) {
    return this._ack('host:lock', { locked });
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
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      this.screenTrack.stop();
      this.screenTrack = null;
    }
    this.sfu?.close();
    this.sfu = null;
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
