import bcrypt from 'bcrypt';
import env from '../config/env.js';
import User from '../models/User.js';
import OneTimeToken, { TOKEN_PURPOSES } from '../models/OneTimeToken.js';
import { randomToken, sha256 } from '../utils/crypto.js';
import { AppError, badRequest, conflict, unauthorized } from '../utils/errors.js';
import { sendMail, verificationEmail, resetEmail } from './mailer.js';
import { audit } from './auditService.js';
import { revokeAllForUser } from './tokenService.js';
import logger from '../utils/logger.js';

// Used to equalise timing when the email doesn't exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 10);

export const hashPassword = (pw) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);

export async function register({ name, email, password, role, profile }, ctx = {}) {
  if (!['teacher', 'student'].includes(role)) throw badRequest('Role must be teacher or student');
  const existing = await User.exists({ email });
  if (existing) throw conflict('An account with this email already exists', 'email_taken');

  const user = await User.create({
    name,
    email,
    role,
    passwordHash: await hashPassword(password),
    emailVerified: false,
    ...(role === 'teacher' && profile ? { teacherProfile: profile } : {}),
    ...(role === 'student' && profile ? { studentProfile: profile } : {}),
  });
  audit('auth.register', { actor: user._id, ip: ctx.ip, meta: { role } });
  await sendVerification(user).catch((err) => logger.error({ err }, 'Failed to send verification email'));
  return user;
}

export async function authenticate(email, password, ctx = {}) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    audit('auth.login_failed', { actor: user?._id, ip: ctx.ip, meta: { email } });
    throw unauthorized('Incorrect email or password', 'invalid_credentials');
  }
  if (user.status !== 'active') throw new AppError(403, 'account_suspended', 'This account is suspended');
  user.lastLoginAt = new Date();
  await user.save();
  audit('auth.login', { actor: user._id, ip: ctx.ip });
  return user;
}

async function createOneTimeToken(userId, purpose, ttlMs) {
  // Invalidate previous unused tokens of the same purpose.
  await OneTimeToken.updateMany({ user: userId, purpose, usedAt: null }, { $set: { usedAt: new Date() } });
  const token = randomToken(32);
  await OneTimeToken.create({ user: userId, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

async function consumeOneTimeToken(token, purpose) {
  const doc = await OneTimeToken.findOneAndUpdate(
    { tokenHash: sha256(String(token)), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!doc) throw badRequest('This link is invalid or has expired');
  return doc;
}

export async function sendVerification(user) {
  if (user.emailVerified) return;
  const token = await createOneTimeToken(user._id, TOKEN_PURPOSES.EMAIL_VERIFY, 24 * 3600_000);
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...verificationEmail(user.name, link) });
}

export async function verifyEmail(token) {
  const doc = await consumeOneTimeToken(token, TOKEN_PURPOSES.EMAIL_VERIFY);
  await User.updateOne({ _id: doc.user }, { $set: { emailVerified: true } });
  const user = await User.findById(doc.user);
  audit('auth.email_verified', { actor: doc.user });
  return user;
}

export async function requestPasswordReset(email, ctx = {}) {
  const user = await User.findOne({ email });
  audit('auth.password_reset_requested', { actor: user?._id, ip: ctx.ip, meta: { email } });
  if (!user || user.status !== 'active') return; // Same response either way: no account enumeration.
  const token = await createOneTimeToken(user._id, TOKEN_PURPOSES.PASSWORD_RESET, 3600_000);
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({ to: user.email, ...resetEmail(user.name, link) });
}

export async function resetPassword(token, password, ctx = {}) {
  const doc = await consumeOneTimeToken(token, TOKEN_PURPOSES.PASSWORD_RESET);
  await User.updateOne(
    { _id: doc.user },
    // Clicking the reset link also proves control of the mailbox.
    { $set: { passwordHash: await hashPassword(password), emailVerified: true } },
  );
  await revokeAllForUser(doc.user);
  audit('auth.password_reset', { actor: doc.user, ip: ctx.ip });
}
