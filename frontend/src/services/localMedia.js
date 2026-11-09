import { describeMediaError } from '../utils/mediaErrors.js';

const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const PREFS_KEY = 'vp.devices';

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
};

/**
 * Owns the local camera and microphone for the whole meeting lifecycle (pre-join → room).
 * Emits 'change' whenever tracks, devices, toggles or errors change, and 'track'
 * ({kind, track}) when the outgoing track for a kind changes.
 */
export class LocalMedia extends EventTarget {
  constructor() {
    super();
    this.stream = new MediaStream(); // preview stream (local only)
    this.audioTrack = null;
    this.videoTrack = null;
    this.audioEnabled = true;
    this.videoEnabled = true;
    this.facingMode = 'user';
    this.devices = { audioinput: [], videoinput: [], audiooutput: [] };
    this.prefs = loadPrefs();
    this.errors = { audio: null, video: null };
    this.busy = false;
    this.started = false;
    this.gen = 0; // bumps on stop(); stale getUserMedia results are discarded
    this._onDeviceChange = () => this.refreshDevices();
  }

  get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  snapshot() {
    return {
      audioTrack: this.audioTrack,
      videoTrack: this.videoTrack,
      audioEnabled: this.audioEnabled && Boolean(this.audioTrack),
      videoEnabled: this.videoEnabled && Boolean(this.videoTrack),
      devices: this.devices,
      prefs: this.prefs,
      errors: this.errors,
      busy: this.busy,
      facingMode: this.facingMode,
      canSwitchCamera: this.devices.videoinput.length > 1,
      canSelectOutput: typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype,
    };
  }

  _emit() {
    this.dispatchEvent(new Event('change'));
  }

  _savePrefs(patch) {
    this.prefs = { ...this.prefs, ...patch };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
  }

  async start({ audio = true, video = true } = {}) {
    if (!this.supported) {
      const err = { code: 'unsupported', message: window.isSecureContext ? 'This browser does not support camera access.' : 'Camera and microphone need a secure (https) connection.' };
      this.errors = { audio: err, video: err };
      this._emit();
      return;
    }
    this.started = true;
    const gen = ++this.gen;
    navigator.mediaDevices.addEventListener?.('devicechange', this._onDeviceChange);
    this.audioEnabled = audio;
    this.videoEnabled = video;
    this.busy = true;
    this._emit();
    // Ask for both at once (one permission prompt); fall back to each separately for precise errors.
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: audio ? this._audioConstraints() : false,
        video: video ? this._videoConstraints() : false,
      });
      if (gen !== this.gen) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      s.getAudioTracks().forEach((t) => this._setTrack('audio', t));
      s.getVideoTracks().forEach((t) => this._setTrack('video', t));
      this.errors = { audio: null, video: null };
    } catch {
      if (audio && gen === this.gen) await this._acquire('audio');
      if (video && gen === this.gen) await this._acquire('video');
    }
    if (gen !== this.gen) return;
    this.busy = false;
    await this.refreshDevices();
    this._emit();
  }

  _audioConstraints(deviceId = this.prefs.audioinput) {
    return { ...AUDIO_CONSTRAINTS, ...(deviceId ? { deviceId: { ideal: deviceId } } : {}) };
  }

  _videoConstraints(deviceId = this.prefs.videoinput) {
    return deviceId ? { ...VIDEO_CONSTRAINTS, deviceId: { ideal: deviceId } } : { ...VIDEO_CONSTRAINTS, facingMode: this.facingMode };
  }

  async _acquire(kind, constraints) {
    const gen = this.gen;
    try {
      const s = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: constraints ?? this._audioConstraints() } : { video: constraints ?? this._videoConstraints() },
      );
      const track = kind === 'audio' ? s.getAudioTracks()[0] : s.getVideoTracks()[0];
      if (gen !== this.gen) {
        s.getTracks().forEach((t) => t.stop());
        return null;
      }
      this._setTrack(kind, track);
      this.errors = { ...this.errors, [kind]: null };
      return track;
    } catch (err) {
      this.errors = { ...this.errors, [kind]: describeMediaError(err, kind === 'audio' ? 'microphone' : 'camera') };
      return null;
    }
  }

  _setTrack(kind, track) {
    const key = kind === 'audio' ? 'audioTrack' : 'videoTrack';
    const old = this[key];
    if (old && old !== track) {
      old.onended = null;
      this.stream.removeTrack(old);
      old.stop();
    }
    this[key] = track || null;
    if (track) {
      if (kind === 'audio') track.enabled = this.audioEnabled;
      this.stream.addTrack(track);
      // Fires when the device is unplugged, revoked, or taken by the OS.
      track.onended = () => this._handleTrackEnded(kind, track);
      const settings = track.getSettings?.() || {};
      if (kind === 'video' && settings.facingMode) this.facingMode = settings.facingMode;
    }
    this.dispatchEvent(new CustomEvent('track', { detail: { kind, track: track || null } }));
  }

  async _handleTrackEnded(kind, track) {
    if (this[kind === 'audio' ? 'audioTrack' : 'videoTrack'] !== track) return;
    const label = kind === 'audio' ? 'microphone' : 'camera';
    this.errors = { ...this.errors, [kind]: { code: 'disconnected', message: `Your ${label} was disconnected. Trying another one…` } };
    this._setTrack(kind, null);
    this._emit();
    await this.refreshDevices();
    // Retry with whatever device is still available.
    const replacement = await this._acquire(kind, kind === 'audio' ? this._audioConstraints(null) : { ...VIDEO_CONSTRAINTS });
    if (!replacement) {
      this.errors = { ...this.errors, [kind]: { code: 'disconnected', message: `Your ${label} was disconnected. Reconnect it, then turn it back on.` } };
      if (kind === 'video') this.videoEnabled = false;
    }
    this._emit();
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const pick = (k) =>
      list
        .filter((d) => d.kind === k && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${k === 'audioinput' ? 'Microphone' : k === 'videoinput' ? 'Camera' : 'Speaker'} ${i + 1}` }));
    this.devices = { audioinput: pick('audioinput'), videoinput: pick('videoinput'), audiooutput: pick('audiooutput') };
    this._emit();
  }

  /** Mute keeps the track (instant unmute); if there's no track yet, we try to get one. */
  async toggleAudio() {
    if (!this.audioTrack) {
      this.audioEnabled = true;
      await this._acquire('audio');
      this._emit();
      return;
    }
    this.audioEnabled = !this.audioEnabled;
    this.audioTrack.enabled = this.audioEnabled;
    this.dispatchEvent(new CustomEvent('track', { detail: { kind: 'audio', track: this.audioTrack } }));
    this._emit();
  }

  /** Camera off releases the device entirely (hardware light goes off). */
  async toggleVideo() {
    if (this.videoEnabled && this.videoTrack) {
      this.videoEnabled = false;
      this._setTrack('video', null);
      this._emit();
      return;
    }
    this.videoEnabled = true;
    this.busy = true;
    this._emit();
    const t = await this._acquire('video');
    if (!t) this.videoEnabled = false;
    this.busy = false;
    this._emit();
  }

  async selectDevice(kind, deviceId) {
    this._savePrefs({ [kind]: deviceId });
    if (kind === 'audioinput' && this.audioTrack) await this._acquire('audio', { ...AUDIO_CONSTRAINTS, deviceId: { exact: deviceId } });
    if (kind === 'videoinput' && this.videoEnabled) {
      // Release the old camera first: many phones can't open two cameras at once.
      this._setTrack('video', null);
      await this._acquire('video', { ...VIDEO_CONSTRAINTS, deviceId: { exact: deviceId } });
    }
    this._emit();
  }

  /** Front/rear switch on phones; cycles through cameras elsewhere. */
  async switchCamera() {
    if (!this.videoEnabled) return;
    const cams = this.devices.videoinput;
    const currentId = this.videoTrack?.getSettings?.().deviceId;
    this._setTrack('video', null);
    this.busy = true;
    this._emit();
    let track = null;
    const nextFacing = this.facingMode === 'user' ? 'environment' : 'user';
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      track = await this._acquire('video', { ...VIDEO_CONSTRAINTS, facingMode: { exact: nextFacing } });
      if (track) this.facingMode = nextFacing;
    }
    if (!track && cams.length > 1) {
      const idx = cams.findIndex((c) => c.deviceId === currentId);
      const next = cams[(idx + 1) % cams.length];
      track = await this._acquire('video', { ...VIDEO_CONSTRAINTS, deviceId: { exact: next.deviceId } });
      if (track) this._savePrefs({ videoinput: next.deviceId });
    }
    if (!track) await this._acquire('video');
    this.busy = false;
    this._emit();
  }

  setOutputDevice(deviceId) {
    this._savePrefs({ audiooutput: deviceId });
    this._emit();
  }

  stop() {
    this.gen += 1;
    this.started = false;
    this.busy = false;
    this._setTrack('audio', null);
    this._setTrack('video', null);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this._onDeviceChange);
  }
}
