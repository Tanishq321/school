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
import * as totp from './totp.js';

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

const lockedError = (until) =>
  new AppError(423, 'account_locked', `Too many failed attempts. Try again in ${Math.max(1, Math.ceil((until - Date.now()) / 60_000))} minutes, or reset your password.`);

/** Count a failed sign-in; after LOGIN_MAX_FAILURES in a row the account locks for LOGIN_LOCK_MINUTES. */
async function registerFailure(user, ctx, action) {
  const failed = (user.failedLogins || 0) + 1;
  const lock = failed >= env.LOGIN_MAX_FAILURES;
  await User.updateOne(
    { _id: user._id },
    lock ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000) } } : { $set: { failedLogins: failed } },
  );
  audit(action, { actor: user._id, ip: ctx.ip, meta: { email: user.email } });
  if (lock) audit('auth.account_locked', { actor: user._id, ip: ctx.ip, meta: { minutes: env.LOGIN_LOCK_MINUTES } });
}

/** Password check. Returns the user (with two-factor fields loaded) without starting a session. */
export async function authenticate(email, password, ctx = {}) {
  const user = await User.findOne({ email }).select('+passwordHash +failedLogins +lockedUntil +twoFactor.secret +twoFactor.lastStep +twoFactor.recoveryHashes');
  if (user?.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil.getTime());
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) await registerFailure(user, ctx, 'auth.login_failed');
    else audit('auth.login_failed', { ip: ctx.ip, meta: { email } });
    throw unauthorized('Incorrect email or password', 'invalid_credentials');
  }
  if (user.status !== 'active') throw new AppError(403, 'account_suspended', 'This account is suspended');
  return user;
}

/** Mark a completed sign-in (after the second step, when there is one). */
export async function completeLogin(user, ctx = {}, method = 'password') {
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), failedLogins: 0 }, $unset: { lockedUntil: 1 } });
  audit('auth.login', { actor: user._id, ip: ctx.ip, meta: { method } });
}

// ------------------------------------------------------------------ two-step sign-in (TOTP)

const TWO_FACTOR_FIELDS = '+twoFactor.secret +twoFactor.pendingSecret +twoFactor.lastStep +twoFactor.recoveryHashes +failedLogins +lockedUntil +passwordHash';

/** Second step of sign-in: a 6-digit authenticator code, or a single-use recovery code. */
export async function verifySecondStep(userId, code, ctx = {}) {
  const user = await User.findById(userId).select(TWO_FACTOR_FIELDS);
  if (!user || user.status !== 'active' || !user.twoFactor?.enabled) throw unauthorized('Sign in again', 'invalid_credentials');
  if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil.getTime());
  const step = totp.verifyCode(totp.unseal(user.twoFactor.secret), code, { lastStep: user.twoFactor.lastStep });
  if (step !== null) {
    await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.lastStep': step } });
    return { user, method: 'totp' };
  }
  const hash = sha256(totp.normalizeRecovery(code));
  if (totp.normalizeRecovery(code).length === 12 && user.twoFactor.recoveryHashes.includes(hash)) {
    await User.updateOne({ _id: user._id }, { $pull: { 'twoFactor.recoveryHashes': hash } });
    audit('auth.2fa_recovery_used', { actor: user._id, ip: ctx.ip, meta: { remaining: user.twoFactor.recoveryHashes.length - 1 } });
    return { user, method: 'recovery', recoveryCodesLeft: user.twoFactor.recoveryHashes.length - 1 };
  }
  await registerFailure(user, ctx, 'auth.2fa_failed');
  throw unauthorized('That code is not right. Check your authenticator app and try again.', 'invalid_code');
}

/** Begin enrolment: returns the secret and otpauth URL to show as a QR code. Not active until confirmed. */
export async function beginTwoFactor(userId) {
  const user = await User.findById(userId);
  if (user.twoFactor?.enabled) throw conflict('Two-step sign-in is already on', 'already_enabled');
  const secret = totp.newSecret();
  await User.updateOne({ _id: userId }, { $set: { 'twoFactor.pendingSecret': totp.seal(secret) } });
  return { secret, otpauthUrl: totp.otpauthUrl(secret, user.email) };
}

/** Confirm enrolment with a code from the app. Returns the recovery codes, shown exactly once. */
export async function confirmTwoFactor(userId, code, ctx = {}) {
  const user = await User.findById(userId).select(TWO_FACTOR_FIELDS);
  if (user.twoFactor?.enabled) throw conflict('Two-step sign-in is already on', 'already_enabled');
  if (!user.twoFactor?.pendingSecret) throw badRequest('Start setup again');
  const step = totp.verifyCode(totp.unseal(user.twoFactor.pendingSecret), code);
  if (step === null) throw new AppError(400, 'invalid_code', 'That code is not right. Make sure your phone’s clock is automatic and try the newest code.');
  const recoveryCodes = totp.newRecoveryCodes();
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.enabledAt': new Date(),
        'twoFactor.secret': user.twoFactor.pendingSecret,
        'twoFactor.lastStep': step,
        'twoFactor.recoveryHashes': recoveryCodes.map((c) => sha256(totp.normalizeRecovery(c))),
      },
      $unset: { 'twoFactor.pendingSecret': 1 },
    },
  );
  audit('auth.2fa_enabled', { actor: userId, ip: ctx.ip });
  return { recoveryCodes };
}

async function assertPassword(userId, password) {
  const user = await User.findById(userId).select(TWO_FACTOR_FIELDS);
  if (!(await bcrypt.compare(String(password || ''), user.passwordHash))) throw new AppError(403, 'invalid_password', 'Your current password is not right');
  return user;
}

/** Turning it off needs the password and a current code (or a recovery code). */
export async function disableTwoFactor(userId, { password, code }, ctx = {}) {
  await assertPassword(userId, password);
  await verifySecondStep(userId, code, ctx);
  await User.updateOne(
    { _id: userId },
    { $set: { 'twoFactor.enabled': false, 'twoFactor.recoveryHashes': [], 'twoFactor.lastStep': -1 }, $unset: { 'twoFactor.secret': 1, 'twoFactor.enabledAt': 1 } },
  );
  audit('auth.2fa_disabled', { actor: userId, ip: ctx.ip });
}

export async function regenerateRecoveryCodes(userId, { password }, ctx = {}) {
  const user = await assertPassword(userId, password);
  if (!user.twoFactor?.enabled) throw badRequest('Two-step sign-in is off');
  const recoveryCodes = totp.newRecoveryCodes();
  await User.updateOne({ _id: userId }, { $set: { 'twoFactor.recoveryHashes': recoveryCodes.map((c) => sha256(totp.normalizeRecovery(c))) } });
  audit('auth.2fa_recovery_regenerated', { actor: userId, ip: ctx.ip });
  return { recoveryCodes };
}

/** Change password: needs the current one; every other device is signed out. */
export async function changePassword(userId, { currentPassword, newPassword }, ctx = {}) {
  await assertPassword(userId, currentPassword);
  if (currentPassword === newPassword) throw badRequest('Choose a password you have not just used');
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(newPassword), sessionsValidAfter: new Date() } });
  audit('auth.password_changed', { actor: userId, ip: ctx.ip });
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
    { $set: { passwordHash: await hashPassword(password), emailVerified: true, failedLogins: 0, sessionsValidAfter: new Date() }, $unset: { lockedUntil: 1 } },
  );
  await revokeAllForUser(doc.user);
  audit('auth.password_reset', { actor: doc.user, ip: ctx.ip });
}
