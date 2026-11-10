/** Minimal RTP header parser (RFC 3550) for packets delivered by mediasoup DirectTransport consumers. */
export function parseRtp(buf) {
  if (!buf || buf.length < 12 || buf[0] >> 6 !== 2) return null;
  const padding = buf[0] & 0x20;
  const extension = buf[0] & 0x10;
  const csrcCount = buf[0] & 0x0f;
  let offset = 12 + csrcCount * 4;
  if (extension) {
    if (buf.length < offset + 4) return null;
    offset += 4 + buf.readUInt16BE(offset + 2) * 4;
  }
  let end = buf.length;
  if (padding) end -= buf[buf.length - 1];
  if (offset > end) return null;
  return {
    marker: Boolean(buf[1] & 0x80),
    payloadType: buf[1] & 0x7f,
    seq: buf.readUInt16BE(2),
    timestamp: buf.readUInt32BE(4),
    ssrc: buf.readUInt32BE(8),
    payload: buf.subarray(offset, end),
  };
}

/** Signed distance between two 16-bit sequence numbers (b - a). */
export const seqDelta = (a, b) => ((b - a + 0x18000) & 0xffff) - 0x8000;
