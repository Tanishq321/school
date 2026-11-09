import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../utils/logger.js';

let transport;
/** In dev/test without SMTP, emails are kept here and logged so links can be clicked from the console. */
export const devOutbox = [];

function getTransport() {
  if (transport !== undefined) return transport;
  if (env.SMTP_HOST) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  } else {
    transport = null;
  }
  return transport;
}

export async function sendMail({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    devOutbox.push({ to, subject, text, at: new Date() });
    if (devOutbox.length > 50) devOutbox.shift();
    if (!env.isTest) logger.warn({ to, subject }, `[dev-mail] SMTP not configured. Email body:\n${text}`);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function verificationEmail(name, link) {
  return {
    subject: 'Verify your email address',
    text: `Hi ${name},\n\nConfirm your email address by opening this link (valid for 24 hours):\n${link}\n\nIf you didn't create an account, ignore this email.`,
    html: `<p>Hi ${esc(name)},</p><p>Confirm your email address (link valid for 24 hours):</p><p><a href="${esc(link)}">Verify email</a></p><p>If you didn't create an account, ignore this email.</p>`,
  };
}

export function resetEmail(name, link) {
  return {
    subject: 'Reset your password',
    text: `Hi ${name},\n\nReset your password with this link (valid for 1 hour):\n${link}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Hi ${esc(name)},</p><p>Reset your password (link valid for 1 hour):</p><p><a href="${esc(link)}">Reset password</a></p><p>If you didn't request this, ignore this email.</p>`,
  };
}
