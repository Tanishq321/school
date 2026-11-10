import fs from 'node:fs';
import { seqDelta } from './rtp.js';

/**
 * Reassembles VP8 frames from RTP (RFC 7741) and writes them to an IVF file with millisecond
 * timestamps measured from the recording start. Frames are only written from a key frame on, and
 * after any packet loss the writer waits for the next key frame (and asks for one) so the file
 * never contains corrupted pictures.
 */
export class Vp8IvfWriter {
  constructor(file, startedAt, { requestKeyFrame } = {}) {
    this.file = file;
    this.startedAt = startedAt;
    this.requestKeyFrame = requestKeyFrame || (() => {});
    this.out = fs.createWriteStream(file);
    this.frames = 0;
    this.width = 0;
    this.height = 0;
    this.lastSeq = null;
    this.current = null; // { timestamp, parts, broken }
    this.needKey = true;
    this.anchor = null; // { rtpTs, ms }
    this.lastPts = -1;
    this.firstPts = null;
    this.lastKeyRequest = 0;
    const header = Buffer.alloc(32);
    header.write('DKIF', 0, 'ascii');
    header.writeUInt16LE(0, 4);
    header.writeUInt16LE(32, 6);
    header.write('VP80', 8, 'ascii');
    header.writeUInt32LE(1000, 16); // time base 1/1000 s
    header.writeUInt32LE(1, 20);
    this.out.write(header);
  }

  _askKey(now) {
    if (now - this.lastKeyRequest < 1000) return;
    this.lastKeyRequest = now;
    this.requestKeyFrame();
  }

  /** Presentation time (ms since recording start) from the RTP clock, re-anchored after jumps. */
  _pts(rtpTs, now) {
    const wall = now - this.startedAt;
    if (this.anchor) {
      const est = this.anchor.ms + ((rtpTs - this.anchor.rtpTs) | 0) / 90;
      if (Math.abs(est - wall) < 500) return Math.max(this.lastPts + 1, Math.round(est));
    }
    this.anchor = { rtpTs, ms: wall };
    return Math.max(this.lastPts + 1, Math.round(wall));
  }

  write(rtp, now = Date.now()) {
    if (this.closed) return;
    const p = rtp.payload;
    if (p.length < 1) return;
    if (this.lastSeq !== null) {
      const d = seqDelta(this.lastSeq, rtp.seq);
      if (d <= 0) return;
      if (d > 1 && this.current) this.current.broken = true; // lost a packet inside this frame
      if (d > 1) {
        this.needKey = true;
        this._askKey(now);
      }
    }
    this.lastSeq = rtp.seq;

    // VP8 payload descriptor
    const b0 = p[0];
    let off = 1;
    if (b0 & 0x80) {
      const b1 = p[1];
      off = 2;
      if (b1 & 0x80) off += p[off] & 0x80 ? 2 : 1;
      if (b1 & 0x40) off += 1;
      if (b1 & 0x30) off += 1;
    }
    if (off > p.length) return;
    const start = Boolean(b0 & 0x10) && (b0 & 0x0f) === 0;
    const data = Buffer.from(p.subarray(off));

    if (start) this.current = { timestamp: rtp.timestamp, parts: [data], broken: false };
    else if (this.current && this.current.timestamp === rtp.timestamp) this.current.parts.push(data);
    else return;

    if (!rtp.marker) return;
    const frame = Buffer.concat(this.current.parts);
    const broken = this.current.broken;
    this.current = null;
    if (broken || frame.length < 3) return;
    const key = (frame[0] & 1) === 0;
    if (this.needKey && !key) {
      this._askKey(now);
      return;
    }
    if (key) {
      this.needKey = false;
      if (frame.length >= 10 && frame[3] === 0x9d && frame[4] === 0x01 && frame[5] === 0x2a) {
        this.width = Math.max(this.width, frame.readUInt16LE(6) & 0x3fff);
        this.height = Math.max(this.height, frame.readUInt16LE(8) & 0x3fff);
      }
    }
    const pts = this._pts(rtp.timestamp, now);
    if (this.firstPts === null) this.firstPts = pts;
    this.lastPts = pts;
    const fh = Buffer.alloc(12);
    fh.writeUInt32LE(frame.length, 0);
    fh.writeBigUInt64LE(BigInt(pts), 4);
    this.out.write(fh);
    this.out.write(frame);
    this.frames += 1;
    this.onFrame?.(pts);
  }

  /** Close the stream and patch the header with the picture size and frame count. */
  async close() {
    if (this.closed) return this.done;
    this.closed = true;
    this.done = (async () => {
      await new Promise((resolve, reject) => {
        this.out.on('error', reject);
        this.out.end(resolve);
      });
      const fh = await fs.promises.open(this.file, 'r+');
      try {
        const patch = Buffer.alloc(4);
        patch.writeUInt16LE(this.width, 0);
        patch.writeUInt16LE(this.height, 2);
        await fh.write(patch, 0, 4, 12);
        const count = Buffer.alloc(4);
        count.writeUInt32LE(this.frames, 0);
        await fh.write(count, 0, 4, 24);
      } finally {
        await fh.close();
      }
    })();
    return this.done;
  }
}
