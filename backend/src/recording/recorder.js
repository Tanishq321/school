import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../utils/logger.js';
import { OggOpusWriter } from './oggOpusWriter.js';
import { Vp8IvfWriter } from './ivfWriter.js';
import { parseRtp } from './rtp.js';

const SPEAKER_HOLD_MS = 4000; // don't cut between speakers faster than this

/**
 * Captures one meeting from the media server, in-process, with no extra network ports:
 * a mediasoup DirectTransport hands us the RTP of each stream we choose to consume, and we write
 * it untouched (no re-encoding while the class is live) to per-track files:
 *
 *  - every consenting participant's microphone → Ogg Opus, aligned to the recording start
 *  - the picture on screen → VP8 IVF per source; only the featured source is flowing at a time
 *    (presentation > host camera > current speaker > anyone with a camera)
 *
 * Nobody who has not agreed is captured: their microphone and camera are never consumed.
 * When the recording stops the tracks are composed into one MP4 (see composer.js).
 */
export class Recorder {
  constructor({ room, dir }) {
    this.room = room;
    this.dir = dir;
    this.sfu = null;
    this.transport = null;
    this.startedAt = 0;
    this.tracks = new Map(); // producerId -> { kind, userId, source, file, writer, consumer }
    this.timeline = []; // [{ at, video }]
    this.featured = null; // { producerId, userId, source, since }
    this.timer = null;
    this.stopped = false;
    this.chain = Promise.resolve();
    this.seq = 0;
  }

  _serial(fn) {
    const next = this.chain.then(fn);
    this.chain = next.catch((err) => logger.error({ err, meeting: this.room.meetingId }, 'recorder step failed'));
    return next;
  }

  async start() {
    await fs.mkdir(this.dir, { recursive: true });
    this.sfu = await this.room.getSfu();
    this.transport = await this.sfu.router.createDirectTransport({ maxMessageSize: 262144 });
    this.startedAt = Date.now();
    this.timeline.push({ at: 0, video: null });
    await this._serial(() => this._sync());
  }

  get elapsedMs() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  /** Something changed in the room (consent, streams, speaker, presentation): re-evaluate soon. */
  schedule(delay = 250) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this._serial(() => this._sync()), delay);
    this.timer.unref?.();
  }

  _consents(userId) {
    return this.room.recording?.consent.get(userId) === 'accepted' && this.room.members.has(userId);
  }

  _cam(userId) {
    if (!userId || !this._consents(userId)) return null;
    const p = this.sfu.findProducer(userId, 'camera');
    return p && !p.closed && !p.paused ? p : null;
  }

  _pickVideo() {
    const room = this.room;
    const now = Date.now();
    if (room.screenSharer && this._consents(room.screenSharer)) {
      const s = this.sfu.findProducer(room.screenSharer, 'screen');
      if (s && !s.closed && !s.paused) return s;
    }
    const host = this._cam(room.hostId);
    if (host) return host;
    const cur = this.featured && this._cam(this.featured.userId);
    const curOk = cur && cur.id === this.featured.producerId;
    const speaker = this._cam(this.sfu.activeSpeaker);
    if (curOk && (now - this.featured.since < SPEAKER_HOLD_MS || !speaker)) return cur;
    if (speaker) return speaker;
    if (curOk) return cur;
    for (const peer of this.sfu.peers.values()) {
      const c = this._cam(peer.userId);
      if (c) return c;
    }
    return null;
  }

  async _consume(producer, { paused = false } = {}) {
    let track = this.tracks.get(producer.id);
    if (track?.consumer && !track.consumer.closed) return track;
    if (!track) {
      const { userId, source } = producer.appData;
      const n = String((this.seq += 1)).padStart(3, '0');
      const isAudio = producer.kind === 'audio';
      const file = `${n}-${source}.${isAudio ? 'ogg' : 'ivf'}`;
      const codec = producer.rtpParameters.codecs[0]?.mimeType.toLowerCase();
      if (!isAudio && codec !== 'video/vp8') {
        logger.warn({ codec }, 'recording: skipping non-VP8 picture source');
        return null;
      }
      track = { id: `t${n}`, kind: producer.kind, userId, source, file, consumer: null };
      track.writer = isAudio
        ? new OggOpusWriter(path.join(this.dir, file), this.startedAt)
        : new Vp8IvfWriter(path.join(this.dir, file), this.startedAt, { requestKeyFrame: () => track.consumer?.requestKeyFrame().catch(() => {}) });
      this.tracks.set(producer.id, track);
    }
    const consumer = await this.transport.consume({ producerId: producer.id, rtpCapabilities: this.sfu.router.rtpCapabilities, paused });
    track.consumer = consumer;
    if (consumer.type === 'simulcast') await consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 }).catch(() => {});
    consumer.on('rtp', (buf) => {
      const pkt = parseRtp(buf);
      if (pkt) track.writer.write(pkt);
    });
    consumer.on('producerclose', () => {
      consumer.close();
      this.schedule(0);
    });
    if (!paused && consumer.kind === 'video') consumer.requestKeyFrame().catch(() => {});
    return track;
  }

  async _sync() {
    if (this.stopped || !this.sfu || this.sfu.closed) return;
    const wanted = new Set();

    // Voices: every consenting participant's microphone (muted ones simply send nothing).
    for (const peer of this.sfu.peers.values()) {
      if (!this._consents(peer.userId)) continue;
      const mic = this.sfu.findProducer(peer.userId, 'mic');
      if (mic && !mic.closed) {
        wanted.add(mic.id);
        await this._consume(mic);
      }
    }

    // Picture: one featured source at a time.
    const video = this._pickVideo();
    if (video) {
      wanted.add(video.id);
      const track = await this._consume(video);
      if (track && track.consumer.paused) {
        await track.consumer.resume();
        await track.consumer.requestKeyFrame().catch(() => {});
      }
    }
    const track = video ? this.tracks.get(video.id) : null;
    if (!this.featured || this.featured.producerId !== (video?.id ?? null)) {
      this.featured = video ? { producerId: video.id, userId: video.appData.userId, source: video.appData.source, since: Date.now() } : null;
      clearTimeout(this.switchTimer);
      if (!track) {
        this.pending = null;
        this._cut(null, this.elapsedMs);
      } else {
        // Keep the previous picture on screen until the new source delivers its first frame,
        // so a switch never flashes an empty canvas (give up waiting after a few seconds).
        const pending = { trackId: track.id };
        this.pending = pending;
        track.writer.onFrame = (pts) => {
          if (this.pending !== pending) return;
          this.pending = null;
          clearTimeout(this.switchTimer);
          this._cut(track.id, pts);
        };
        this.switchTimer = setTimeout(() => {
          if (this.pending !== pending) return;
          this.pending = null;
          this._cut(track.id, this.elapsedMs);
        }, 4000);
        this.switchTimer.unref?.();
      }
    }

    // Everything else stops flowing: other pictures pause, withdrawn consent closes for good.
    for (const [producerId, track] of this.tracks) {
      const c = track.consumer;
      if (!c || c.closed || wanted.has(producerId)) continue;
      if (track.kind === 'video' && this._consents(track.userId)) {
        if (!c.paused) await c.pause();
      } else {
        c.close();
        track.consumer = null;
      }
    }
  }

  _cut(trackId, at) {
    const last = this.timeline[this.timeline.length - 1];
    if (last.video === trackId) return;
    const when = Math.max(at, last.at);
    if (when === last.at) last.video = trackId;
    else this.timeline.push({ at: when, video: trackId });
  }

  /** Stop capturing. Returns the manifest for composition (files stay in `dir`). */
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.switchTimer);
    await this.chain;
    const endMs = Date.now();
    const durationMs = endMs - this.startedAt;
    for (const t of this.tracks.values()) if (t.consumer && !t.consumer.closed) t.consumer.close();
    if (this.transport && !this.transport.closed) this.transport.close();
    const audio = [];
    const video = [];
    for (const t of this.tracks.values()) {
      if (t.kind === 'audio') {
        await t.writer.close(endMs);
        audio.push({ id: t.id, userId: t.userId, file: t.file, packets: t.writer.packets });
      } else {
        await t.writer.close();
        video.push({ id: t.id, userId: t.userId, source: t.source, file: t.file, frames: t.writer.frames, firstPtsMs: t.writer.firstPts });
      }
    }
    const manifest = { version: 1, startedAt: new Date(this.startedAt).toISOString(), durationMs, audio, video, timeline: this.timeline };
    await fs.writeFile(path.join(this.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return manifest;
  }
}
