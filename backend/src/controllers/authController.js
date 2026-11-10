import env from '../config/env.js';
import User from '../models/User.js';
import * as authService from '../services/authService.js';
import {
  issueRefreshToken,
  listSessions,
  revokeOtherSessions,
  revokeRefreshFamily,
  revokeSession,
  rotateRefreshToken,
  signAccessToken,
  signTwoFactorChallenge,
  verifyTwoFactorChallenge,
} from '../services/tokenService.js';
import { forbidden, notFound, unauthorized } from '../utils/errors.js';

export const REFRESH_COOKIE = 'vp_rt';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
});

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/**
 * The Android/iOS apps run in a web view on another origin, where cookies are unreliable.
 * They identify themselves and keep the refresh token in the device's secure storage instead.
 */
const isNative = (req) => req.get('x-client-platform') === 'native';
const presentedRefreshToken = (req) => (isNative(req) ? req.body?.refreshToken : req.cookies?.[REFRESH_COOKIE]);

/** Cookie-authenticated endpoints must come from an allowed origin (CSRF defence in depth beyond SameSite). */
function assertAllowedOrigin(req) {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) throw forbidden('Origin not allowed', 'bad_origin');
}

function deliver(req, res, user, refreshToken, extra = {}) {
  if (isNative(req)) return { user: user.toJSON(), accessToken: signAccessToken(user), refreshToken, ...extra };
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return { user: user.toJSON(), accessToken: signAccessToken(user), ...extra };
}

async function startSession(res, user, req, extra) {
  const refreshToken = await issueRefreshToken(user._id, ctx(req));
  return deliver(req, res, user, refreshToken, extra);
}

export async function register(req, res) {
  const user = await authService.register(req.valid.body, ctx(req));
  res.status(201).json(await startSession(res, user, req));
}

export async function login(req, res) {
  const { email, password } = req.valid.body;
  const user = await authService.authenticate(email, password, ctx(req));
  if (user.twoFactor?.enabled) {
    // Password was right, but no session yet: the second step decides.
    return res.json({ twoFactorRequired: true, challenge: signTwoFactorChallenge(user._id) });
  }
  await authService.completeLogin(user, ctx(req));
  return res.json(await startSession(res, user, req));
}

export async function loginSecondStep(req, res) {
  const claims = verifyTwoFactorChallenge(req.valid.body.challenge);
  const { user, method, recoveryCodesLeft } = await authService.verifySecondStep(claims.sub, req.valid.body.code, ctx(req));
  await authService.completeLogin(user, ctx(req), method);
  res.json(await startSession(res, await User.findById(user._id), req, recoveryCodesLeft !== undefined ? { recoveryCodesLeft } : undefined));
}

export async function refresh(req, res) {
  assertAllowedOrigin(req);
  try {
    const { userId, refreshToken } = await rotateRefreshToken(presentedRefreshToken(req), ctx(req));
    const user = await User.findById(userId);
    if (!user || user.status !== 'active') throw unauthorized('Session no longer valid', 'invalid_refresh_token');
    res.json(deliver(req, res, user, refreshToken));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw err;
  }
}

export async function logout(req, res) {
  assertAllowedOrigin(req);
  await revokeRefreshFamily(presentedRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
}

// ------------------------------------------------------------------ security settings

export async function twoFactorBegin(req, res) {
  res.json(await authService.beginTwoFactor(req.user.id));
}

export async function twoFactorConfirm(req, res) {
  res.json(await authService.confirmTwoFactor(req.user.id, req.valid.body.code, ctx(req)));
}

export async function twoFactorDisable(req, res) {
  await authService.disableTwoFactor(req.user.id, req.valid.body, ctx(req));
  res.json({ ok: true });
}

export async function recoveryCodes(req, res) {
  res.json(await authService.regenerateRecoveryCodes(req.user.id, req.valid.body, ctx(req)));
}

export async function changePassword(req, res) {
  await authService.changePassword(req.user.id, req.valid.body, ctx(req));
  const signedOut = await revokeOtherSessions(req.user.id, presentedRefreshToken(req));
  const user = await User.findById(req.user.id);
  // The old access token is no longer valid; hand back a fresh one for this device.
  res.json({ ok: true, signedOut, accessToken: signAccessToken(user) });
}

export async function sessions(req, res) {
  res.json({ sessions: await listSessions(req.user.id, presentedRefreshToken(req)) });
}

export async function sessionRevoke(req, res) {
  if (!(await revokeSession(req.user.id, req.valid.params.id))) throw notFound('That device is already signed out');
  res.status(204).end();
}

export async function sessionsRevokeOthers(req, res) {
  res.json({ signedOut: await revokeOtherSessions(req.user.id, presentedRefreshToken(req)) });
}

export async function me(req, res) {
  const user = await User.findById(req.user.id);
  res.json({ user: user.toJSON() });
}

export async function updateProfile(req, res) {
  const { name, profile } = req.valid.body;
  const user = await User.findById(req.user.id);
  if (name) user.name = name;
  if (profile) {
    if (user.role === 'teacher') Object.assign(user.teacherProfile, profile);
    if (user.role === 'student') Object.assign(user.studentProfile, profile);
  }
  await user.save();
  res.json({ user: user.toJSON() });
}

export async function verifyEmail(req, res) {
  const user = await authService.verifyEmail(req.valid.body.token);
  res.json({ user: user.toJSON() });
}

export async function resendVerification(req, res) {
  const user = await User.findById(req.user.id);
  await authService.sendVerification(user);
  res.status(202).json({ ok: true });
}

export async function forgotPassword(req, res) {
  await authService.requestPasswordReset(req.valid.body.email, ctx(req));
  res.status(202).json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
}

export async function resetPassword(req, res) {
  await authService.resetPassword(req.valid.body.token, req.valid.body.password, ctx(req));
  res.json({ ok: true });
}
