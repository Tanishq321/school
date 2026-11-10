import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import RefreshToken from '../models/RefreshToken.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { unauthorized } from '../utils/errors.js';
import { audit } from './auditService.js';

const ISSUER = 'video-platform';

export function signAccessToken(user) {
  return jwt.sign({ role: user.role, name: user.name }, env.JWT_ACCESS_SECRET, {
    subject: String(user._id ?? user.id),
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: ISSUER,
    audience: 'access',
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: 'access', algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Session expired or invalid', 'invalid_token');
  }
}

/**
 * Signed playback URL token: <video> elements cannot send an Authorization header, so media is
 * fetched with this token in the query string. Bound to one user and one recording, short-lived.
 */
export function signPlaybackToken({ userId, recordingId, ttlSeconds, scope = 'media' }) {
  return jwt.sign({ rid: String(recordingId), scope }, env.RECORDING_PLAYBACK_SECRET || env.MEETING_TOKEN_SECRET, {
    subject: String(userId),
    expiresIn: ttlSeconds,
    issuer: ISSUER,
    audience: 'recording-playback',
    algorithm: 'HS256',
  });
}

export function verifyPlaybackToken(token, recordingId, { scope = 'media' } = {}) {
  try {
    const claims = jwt.verify(token, env.RECORDING_PLAYBACK_SECRET || env.MEETING_TOKEN_SECRET, {
      issuer: ISSUER,
      audience: 'recording-playback',
      algorithms: ['HS256'],
    });
    if (claims.rid !== String(recordingId)) throw new Error('wrong recording');
    // A poster-only token (handed out with library listings) cannot stream the film itself.
    if (scope === 'media' && claims.scope !== 'media') throw new Error('wrong scope');
    return claims;
  } catch {
    throw unauthorized('This playback link has expired. Reopen the recording.', 'playback_expired');
  }
}

/** Short-lived token proving the REST join checks passed for (user, meeting). */
export function signJoinToken({ userId, meetingId, isHost }) {
  return jwt.sign({ mid: String(meetingId), host: Boolean(isHost) }, env.MEETING_TOKEN_SECRET, {
    subject: String(userId),
    expiresIn: '2m',
    issuer: ISSUER,
    audience: 'meeting-join',
    algorithm: 'HS256',
  });
}

export function verifyJoinToken(token) {
  try {
    return jwt.verify(token, env.MEETING_TOKEN_SECRET, {
      issuer: ISSUER,
      audience: 'meeting-join',
      algorithms: ['HS256'],
    });
  } catch {
    throw unauthorized('Join token expired or invalid. Rejoin the meeting.', 'invalid_join_token');
  }
}

export async function issueRefreshToken(userId, { family, userAgent, ip } = {}) {
  const token = randomToken(48);
  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(token),
    family: family || randomToken(16),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
    userAgent: userAgent?.slice(0, 300),
    ip,
  });
  return token;
}

/** Rotate a refresh token. Returns { userId, refreshToken }. Detects reuse. */
export async function rotateRefreshToken(token, { userAgent, ip } = {}) {
  if (!token) throw unauthorized('No session', 'no_refresh_token');
  const doc = await RefreshToken.findOne({ tokenHash: sha256(token) });
  if (!doc) throw unauthorized('Session not found', 'invalid_refresh_token');

  if (doc.revokedAt) {
    // A rotated-away token was presented again: probable theft. Kill the whole family.
    await RefreshToken.updateMany({ family: doc.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    audit('auth.refresh_reuse_detected', { actor: doc.user, ip, meta: { family: doc.family } });
    throw unauthorized('Session revoked', 'refresh_token_reused');
  }
  if (doc.expiresAt < new Date()) throw unauthorized('Session expired', 'refresh_token_expired');

  const next = await issueRefreshToken(doc.user, { family: doc.family, userAgent, ip });
  // Conditional update guards against two concurrent refreshes both succeeding.
  const res = await RefreshToken.updateOne(
    { _id: doc._id, revokedAt: null },
    { $set: { revokedAt: new Date(), replacedBy: sha256(next) } },
  );
  if (res.modifiedCount !== 1) {
    await RefreshToken.deleteOne({ tokenHash: sha256(next) });
    throw unauthorized('Session already refreshed', 'refresh_race');
  }
  return { userId: doc.user, refreshToken: next };
}

export async function revokeRefreshFamily(token) {
  if (!token) return;
  const doc = await RefreshToken.findOne({ tokenHash: sha256(token) });
  if (doc) await RefreshToken.updateMany({ family: doc.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}
