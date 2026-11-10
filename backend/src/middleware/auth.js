import User from '../models/User.js';
import env from '../config/env.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/** Resolves the bearer token to an active user and attaches req.user. */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub).lean();
  if (!user) throw unauthorized('Account not found', 'invalid_token');
  if (user.status !== 'active') throw forbidden('This account is suspended', 'account_suspended');
  if (user.sessionsValidAfter && payload.iat < Math.floor(user.sessionsValidAfter.getTime() / 1000)) {
    throw unauthorized('You were signed out. Please sign in again.', 'invalid_token');
  }
  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role, emailVerified: user.emailVerified, twoFactor: Boolean(user.twoFactor?.enabled) };
  next();
}

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };

/** Blocks meeting features until the email is verified (configurable via REQUIRE_EMAIL_VERIFICATION). */
export function requireVerifiedEmail(req, _res, next) {
  if (env.REQUIRE_EMAIL_VERIFICATION && !req.user.emailVerified) {
    throw forbidden('Please verify your email address first', 'email_not_verified');
  }
  next();
}
