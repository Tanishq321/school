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

/** "Tuesday 4 March, 16:00 GMT" in the reader's own time zone when we know it, UTC otherwise. */
export function whenLine(when, timeZone) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
  try {
    return new Date(when).toLocaleString('en-GB', { ...opts, timeZone: timeZone || 'UTC' });
  } catch {
    return new Date(when).toLocaleString('en-GB', { ...opts, timeZone: 'UTC' });
  }
}

const P = (txt, extra = '') => `<p style="font:15px/1.6 Helvetica,Arial,sans-serif;color:#4a4f5c;margin:0 0 6px;${extra}">${txt}</p>`;
const H = (txt) => `<h1 style="font-weight:400;font-size:30px;line-height:1.2;margin:0 0 12px">${esc(txt)}</h1>`;
const BUTTON = (link, label) =>
  `<a href="${esc(link)}" style="display:inline-block;background:#8d6c3b;color:#fbf7ef;text-decoration:none;font:600 14px Helvetica,Arial,sans-serif;letter-spacing:.04em;padding:14px 26px;border-radius:999px">${esc(label)}</a>`;
const SMALL = (txt) => `<p style="font:12px/1.6 Helvetica,Arial,sans-serif;color:#7a7466;margin:22px 0 0">${txt}</p>`;

/** A first invitation; `series` adds the weekly pattern ("every Tuesday, 8 lessons"). */
export function invitationEmail({ hostName, title, when, link, description, timeZone, series }) {
  const dateLine = whenLine(when, timeZone);
  const seriesLine = series ? `Every ${new Date(when).toLocaleDateString('en-GB', { weekday: 'long', timeZone: timeZone || 'UTC' })} at this time, ${series.count} lessons.` : '';
  return {
    subject: `${hostName} invited you: ${title}`,
    text: `${hostName} has invited you to "${title}".\n\nWhen: ${dateLine}${seriesLine ? `\n${seriesLine}` : ''}\nJoin: ${link}\n${description ? `\n${description}\n` : ''}\nThe attached calendar file adds ${series ? 'every lesson' : 'it'} to your calendar.`,
    html: frame(`${H(title)}
${P(`${esc(hostName)} has reserved a seat for you.`)}
${P(esc(dateLine), seriesLine ? '' : 'margin-bottom:28px')}
${seriesLine ? P(esc(seriesLine), 'margin-bottom:28px') : ''}
${description ? P(esc(description), 'font-size:14px;line-height:1.7;margin-bottom:28px;white-space:pre-line') : ''}
${BUTTON(link, 'Take your seat')}
${SMALL(`The attached calendar file adds ${series ? 'every lesson in the series' : 'the class'} to your calendar. You will be let straight in.`)}`),
  };
}

export function rescheduleEmail({ hostName, title, when, previous, link, timeZone }) {
  const dateLine = whenLine(when, timeZone);
  const wasLine = previous ? whenLine(previous, timeZone) : null;
  return {
    subject: `New time: ${title}`,
    text: `${hostName} has moved "${title}".\n\nNow: ${dateLine}${wasLine ? `\nWas: ${wasLine}` : ''}\nJoin: ${link}\n\nThe attached calendar file updates your calendar.`,
    html: frame(`${H(title)}
${P(`${esc(hostName)} has moved this lesson to a new time.`)}
${P(`<strong style="color:#1b2233">${esc(dateLine)}</strong>`)}
${wasLine ? P(`<span style="text-decoration:line-through;color:#9a9486">${esc(wasLine)}</span>`, 'margin-bottom:28px') : ''}
${BUTTON(link, 'Open the class')}
${SMALL('The attached calendar file updates the entry already in your calendar.')}`),
  };
}

export function cancellationEmail({ hostName, title, when, count = 1, timeZone }) {
  const dateLine = whenLine(when, timeZone);
  const what = count > 1 ? `${count} lessons of "${title}", from ${dateLine}` : `"${title}" on ${dateLine}`;
  return {
    subject: count > 1 ? `Cancelled: ${title} (${count} lessons)` : `Cancelled: ${title}`,
    text: `${hostName} has cancelled ${what}.\n\nThe attached calendar file removes ${count > 1 ? 'them' : 'it'} from your calendar.`,
    html: frame(`${H(count > 1 ? `${title}: ${count} lessons cancelled` : `${title}: cancelled`)}
${P(`${esc(hostName)} has cancelled ${esc(what)}.`, 'margin-bottom:8px')}
${SMALL(`The attached calendar file removes ${count > 1 ? 'these lessons' : 'the lesson'} from your calendar.`)}`),
  };
}

export function reminderEmail({ title, when, link, withName, minutes, timeZone }) {
  const dateLine = whenLine(when, timeZone);
  return {
    subject: `In ${minutes} minutes: ${title}`,
    text: `"${title}" with ${withName} begins at ${dateLine}.\n\nJoin: ${link}\n\nCheck your camera and microphone a few minutes early.`,
    html: frame(`${H(title)}
${P(`Begins in ${minutes} minutes, with ${esc(withName)}.`)}
${P(esc(dateLine), 'margin-bottom:28px')}
${BUTTON(link, 'Take your seat')}
${SMALL('Open the room a few minutes early to check your camera and microphone.')}`),
  };
}

export function lessonNotesEmail({ hostName, title, summary, homework, link }) {
  const list = homework.map((h) => `- ${h.text}`).join('\n');
  return {
    subject: `Notes from your lesson: ${title}`,
    text: `${hostName} left notes from "${title}".\n\n${summary ? `${summary}\n\n` : ''}${homework.length ? `Homework:\n${list}\n\n` : ''}Open the class: ${link}`,
    html: frame(`${H(title)}
${P(`${esc(hostName)} left notes from your lesson.`, 'margin-bottom:22px')}
${summary ? P(esc(summary), 'font-size:14px;line-height:1.7;margin-bottom:22px;white-space:pre-line') : ''}
${
  homework.length
    ? `<div style="font:11px Helvetica,Arial,sans-serif;letter-spacing:.24em;text-transform:uppercase;color:#8d6c3b;margin:0 0 10px">Homework</div>
<ul style="font:14px/1.7 Helvetica,Arial,sans-serif;color:#1b2233;margin:0 0 28px;padding-left:18px">${homework.map((h) => `<li>${esc(h.text)}</li>`).join('')}</ul>`
    : ''
}
${BUTTON(link, 'Open the class')}
${SMALL('Tick each piece of homework off on the class page as you finish it. Your teacher sees your progress.')}`),
  };
}
