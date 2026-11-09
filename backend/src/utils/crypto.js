import crypto from 'node:crypto';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export const hmac = (secret, value, encoding = 'base64url') =>
  crypto.createHmac('sha256', secret).update(value).digest(encoding);

export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Meeting code like "kqr-tmzx-pwa": 10 random letters, ~47 bits of entropy. */
export function generateMeetingCode() {
  let s = '';
  for (let i = 0; i < 10; i += 1) s += LETTERS[crypto.randomInt(LETTERS.length)];
  return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
}

export const MEETING_CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** Accepts "kqr-tmzx-pwa", "KQRTMZXPWA", "kqr tmzx pwa" or a full invite URL path segment. */
export function normalizeMeetingCode(input) {
  const letters = String(input || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (letters.length !== 10) return null;
  return `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`;
}
