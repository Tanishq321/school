import fs from 'node:fs';
import { seqDelta } from './rtp.js';

// Ogg CRC-32 (polynomial 0x04c11db7, no reflection, init 0).
const CRC = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let r = i << 24;
  for (let j = 0; j < 8; j += 1) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
  CRC[i] = r >>> 0;
}
function crc32(buf) {
  let c = 0;
  for (let i = 0; i < buf.length; i += 1) c = ((c << 8) ^ CRC[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return c;
}

/** Samples (at 48 kHz) carried by one Opus packet, from its TOC byte (RFC 6716 §3.1). */
export function opusSamples(packet) {
  if (!packet.length) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let ms;
  if (config < 12) ms = [10, 20, 40, 60][config % 4];
  else if (config < 16) ms = [10, 20][config % 2];
  else ms = [2.5, 5, 10, 20][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 0x3f;
  return Math.round(frames * ms * 48);
}

// A 20 ms CELT packet that decodes to digital silence; used to fill gaps (muted, DTX, joined late).
const SILENCE = Buffer.from([0xf8, 0xff, 0xfe]);
const SILENCE_SAMPLES = 960;

/**
 * Writes an Opus RTP stream to an Ogg Opus file whose timeline starts at the recording start.
 * Gaps (muted microphone, DTX, network outage, joining late) become real silence, so every
 * participant's file lines up sample-for-sample with the others and can be mixed without offsets.
 */
export class OggOpusWriter {
  constructor(file, startedAt) {
    this.file = file;
    this.startedAt = startedAt;
    this.serial = (Math.random() * 0xffffffff) >>> 0;
    this.pageSeq = 0;
    this.samples = 0; // PCM samples written so far (granule position)
    this.pending = []; // packets waiting for the next page
    this.lastSeq = null;
    this.out = fs.createWriteStream(file);
    this.bytes = 0;
    this.packets = 0; // real (non-filler) packets received
    const head = Buffer.alloc(19);
    head.write('OpusHead', 0, 'ascii');
    head[8] = 1; // version
    head[9] = 1; // channels (browsers send mono speech)
    head.writeUInt16LE(0, 10); // pre-skip: unknown for a live stream
    head.writeUInt32LE(48000, 12);
    head.writeInt16LE(0, 16);
    head[18] = 0; // mapping family
    this._page([head], 0, 0x02);
    const vendor = Buffer.from('Schole recorder');
    const tags = Buffer.alloc(8 + 4 + vendor.length + 4);
    tags.write('OpusTags', 0, 'ascii');
    tags.writeUInt32LE(vendor.length, 8);
    vendor.copy(tags, 12);
    tags.writeUInt32LE(0, 12 + vendor.length);
    this._page([tags], 0, 0);
  }

  _page(packets, granule, flags) {
    const lacing = [];
    for (const p of packets) {
      let n = p.length;
      while (n >= 255) {
        lacing.push(255);
        n -= 255;
      }
      lacing.push(n);
    }
    const header = Buffer.alloc(27 + lacing.length);
    header.write('OggS', 0, 'ascii');
    header[4] = 0;
    header[5] = flags;
    header.writeBigUInt64LE(BigInt(granule), 6);
    header.writeUInt32LE(this.serial, 14);
    header.writeUInt32LE(this.pageSeq++, 18);
    header.writeUInt32LE(0, 22);
    header[26] = lacing.length;
    Buffer.from(lacing).copy(header, 27);
    const page = Buffer.concat([header, ...packets]);
    page.writeUInt32LE(crc32(page), 22);
    this.out.write(page);
    this.bytes += page.length;
  }

  _flush(flags = 0) {
    if (!this.pending.length && !flags) return;
    this._page(this.pending, this.samples, flags);
    this.pending = [];
    this.pendingSegs = 0;
  }

  _push(packet, samples) {
    const segs = Math.floor(packet.length / 255) + 1;
    if ((this.pendingSegs || 0) + segs > 255 || this.pending.length >= 50) this._flush();
    this.pending.push(packet);
    this.pendingSegs = (this.pendingSegs || 0) + segs;
    this.samples += samples;
  }

  /** Pad with silence up to wall-clock time `atMs` (only if we are behind by more than `slackMs`). */
  _fillTo(atMs, slackMs) {
    const target = Math.floor(((atMs - this.startedAt) * 48000) / 1000);
    if (target - this.samples <= (slackMs * 48000) / 1000) return;
    while (this.samples + SILENCE_SAMPLES <= target) this._push(SILENCE, SILENCE_SAMPLES);
  }

  /** Feed one parsed RTP packet. */
  write(rtp, nowMs = Date.now()) {
    if (this.closed || !rtp.payload.length) return;
    if (this.lastSeq !== null && seqDelta(this.lastSeq, rtp.seq) <= 0) return; // duplicate / late
    this.lastSeq = rtp.seq;
    this._fillTo(nowMs, 150);
    const samples = opusSamples(rtp.payload);
    if (!samples) return;
    this._push(Buffer.from(rtp.payload), samples);
    this.packets += 1;
  }

  /** Pad to `endMs`, finish the stream and close the file. */
  close(endMs = Date.now()) {
    if (this.closed) return this.done;
    this.closed = true;
    this._fillTo(endMs, 0);
    this._flush(0x04);
    this.done = new Promise((resolve, reject) => {
      this.out.on('error', reject);
      this.out.end(resolve);
    });
    return this.done;
  }
}
