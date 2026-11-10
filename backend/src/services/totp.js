import crypto from 'node:crypto';
import env from '../config/env.js';

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s): what authenticator apps speak. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 30_000);

/**
 * Returns the matching time step (so the caller can refuse replays), or null.
 * Accepts one step either side for clock drift.
 */
export function verifyCode(secret, code, { now = Date.now(), lastStep = -1 } = {}) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (s <= lastStep) continue;
    const expected = codeAt(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return s;
  }
  return null;
}

export const otpauthUrl = (secret, email) =>
  `otpauth://totp/${encodeURIComponent(env.APP_NAME)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(env.APP_NAME)}&algorithm=SHA1&digits=6&period=30`;

// ---- secrets at rest: AES-256-GCM, key derived from TWO_FACTOR_ENC_KEY (or the access-token secret)
const key = () => crypto.createHash('sha256').update(`2fa:${env.TWO_FACTOR_ENC_KEY || env.JWT_ACCESS_SECRET}`).digest();

export function seal(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${data.toString('base64url')}.${c.getAuthTag().toString('base64url')}`;
}

export function unseal(sealed) {
  const [v, iv, data, tag] = String(sealed).split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

/** Ten single-use recovery codes like "k7qm-x2vd-9ptw". */
export function newRecoveryCodes(n = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    let s = '';
    for (let i = 0; i < 12; i += 1) s += alphabet[crypto.randomInt(alphabet.length)];
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
  });
}
export const normalizeRecovery = (c) => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
