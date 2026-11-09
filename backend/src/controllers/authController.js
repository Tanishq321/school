import env from '../config/env.js';
import User from '../models/User.js';
import * as authService from '../services/authService.js';
import {
  issueRefreshToken,
  revokeRefreshFamily,
  rotateRefreshToken,
  signAccessToken,
} from '../services/tokenService.js';
import { forbidden, unauthorized } from '../utils/errors.js';

export const REFRESH_COOKIE = 'vp_rt';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86400_000,
});

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/** Cookie-authenticated endpoints must come from an allowed origin (CSRF defence in depth beyond SameSite). */
function assertAllowedOrigin(req) {
  const origin = req.get('origin');
  if (origin && !env.corsOrigins.includes(origin)) throw forbidden('Origin not allowed', 'bad_origin');
}

async function startSession(res, user, req) {
  const refreshToken = await issueRefreshToken(user._id, ctx(req));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  return { user: user.toJSON(), accessToken: signAccessToken(user) };
}

export async function register(req, res) {
  const user = await authService.register(req.valid.body, ctx(req));
  res.status(201).json(await startSession(res, user, req));
}

export async function login(req, res) {
  const { email, password } = req.valid.body;
  const user = await authService.authenticate(email, password, ctx(req));
  res.json(await startSession(res, user, req));
}

export async function refresh(req, res) {
  assertAllowedOrigin(req);
  try {
    const { userId, refreshToken } = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE], ctx(req));
    const user = await User.findById(userId);
    if (!user || user.status !== 'active') throw unauthorized('Session no longer valid', 'invalid_refresh_token');
    res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
    res.json({ user: user.toJSON(), accessToken: signAccessToken(user) });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
    throw err;
  }
}

export async function logout(req, res) {
  assertAllowedOrigin(req);
  await revokeRefreshFamily(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.status(204).end();
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
