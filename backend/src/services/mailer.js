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

export async function sendMail({ to, subject, text, html, attachments }) {
  const t = getTransport();
  if (!t) {
    devOutbox.push({ to, subject, text, attachments, at: new Date() });
    if (devOutbox.length > 50) devOutbox.shift();
    if (!env.isTest) logger.warn({ to, subject }, `[dev-mail] SMTP not configured. Email body:\n${text}`);
    return;
  }
  await t.sendMail({ from: env.MAIL_FROM, to, subject, text, html, attachments });
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

/** Shared shell so every message looks like it came from the same house. */
function frame(inner) {
  return `<div style="background:#0f1628;padding:40px 16px;font-family:Georgia,'Times New Roman',serif">
<div style="max-width:520px;margin:0 auto;background:#f4f3ef;border-radius:14px;padding:40px 40px 32px;color:#1b2233">
<div style="font-size:13px;letter-spacing:.32em;text-transform:uppercase;color:#8d6c3b;margin-bottom:28px">${esc(env.APP_NAME)}</div>
${inner}
<div style="margin-top:36px;padding-top:18px;border-top:1px solid #d9d3c6;font:12px/1.6 Helvetica,Arial,sans-serif;color:#7a7466">Sent by ${esc(env.APP_NAME)} on behalf of your teacher.</div>
</div></div>`;
}

export function invitationEmail({ hostName, title, when, link, description }) {
  const dateLine = when.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' });
  return {
    subject: `${hostName} invited you: ${title}`,
    text: `${hostName} has invited you to "${title}".\n\nWhen: ${dateLine}\nJoin: ${link}\n${description ? `\n${description}\n` : ''}\nThe attached calendar file adds it to your calendar.`,
    html: frame(`<h1 style="font-weight:400;font-size:30px;line-height:1.2;margin:0 0 12px">${esc(title)}</h1>
<p style="font:15px/1.6 Helvetica,Arial,sans-serif;color:#4a4f5c;margin:0 0 6px">${esc(hostName)} has reserved a seat for you.</p>
<p style="font:15px/1.6 Helvetica,Arial,sans-serif;color:#4a4f5c;margin:0 0 28px">${esc(dateLine)}</p>
${description ? `<p style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#4a4f5c;margin:0 0 28px;white-space:pre-line">${esc(description)}</p>` : ''}
<a href="${esc(link)}" style="display:inline-block;background:#8d6c3b;color:#fbf7ef;text-decoration:none;font:600 14px Helvetica,Arial,sans-serif;letter-spacing:.04em;padding:14px 26px;border-radius:999px">Take your seat</a>
<p style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#7a7466;margin:22px 0 0">The attached calendar file adds the class to your calendar. You will be let straight in.</p>`),
  };
}
