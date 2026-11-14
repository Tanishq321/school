import env from '../config/env.js';
import Meeting, { MEETING_STATUS } from '../models/Meeting.js';
import User from '../models/User.js';
import JobClaim, { claim, pruneClaims } from '../models/JobClaim.js';
import logger from '../utils/logger.js';
import { reminderEmail, sendMail } from './mailer.js';
import { inviteUrlFor, zonesFor } from './meetingService.js';

/**
 * Email the teacher and the student shortly before each scheduled class.
 *
 * Safe with several API processes: each class is claimed (a unique-key insert) before any email goes
 * out, so only one process sends it. A class that was invited or moved in the last ten minutes
 * is claimed but not reminded (the person has just had an email about it).
 */
export async function sendDueReminders(now = new Date()) {
  const minutes = env.REMINDER_MINUTES;
  if (!minutes) return 0;
  await JobClaim.init(); // the unique index must exist before the first claim
  const due = await Meeting.find({
    type: 'scheduled',
    status: MEETING_STATUS.SCHEDULED,
    reminderSentAt: null,
    scheduledStart: { $gt: now, $lte: new Date(now.getTime() + minutes * 60_000) },
  })
    .select('+inviteNonce')
    .populate('host', 'name email timeZone')
    .limit(200);
  let sent = 0;
  for (const m of due) {
    // The claim key includes the start time, so a class moved after its reminder is reminded again.
    if (!(await claim(`reminder:${m._id}:${m.scheduledStart.toISOString()}`))) continue;
    await Meeting.updateOne({ _id: m._id }, { $set: { reminderSentAt: now } });
    if (m.noticeSentAt && now - m.noticeSentAt < 10 * 60_000) continue;
    const left = Math.max(1, Math.round((m.scheduledStart - now) / 60_000));
    const student = m.invitees[0];
    const studentUser = student ? await User.findOne({ email: student }).select('name').lean() : null;
    const zones = await zonesFor(student ? [student] : []);
    const letters = [];
    if (m.host?.email) {
      letters.push({ to: m.host.email, ...reminderEmail({ title: m.title, when: m.scheduledStart, link: `${env.APP_URL}/m/${m.code}`, withName: studentUser?.name || student || 'your student', minutes: left, timeZone: m.host.timeZone }) });
    }
    if (student) {
      letters.push({ to: student, ...reminderEmail({ title: m.title, when: m.scheduledStart, link: inviteUrlFor(m), withName: m.host?.name || 'your teacher', minutes: left, timeZone: zones.get(student) }) });
    }
    for (const letter of letters) {
      try {
        await sendMail(letter);
        sent += 1;
      } catch (err) {
        logger.error({ err }, 'reminder email failed');
      }
    }
  }
  return sent;
}

export function startReminderJob() {
  if (!env.REMINDER_MINUTES) return () => {};
  const timer = setInterval(() => sendDueReminders().catch((err) => logger.error({ err }, 'reminder sweep failed')), 60_000);
  const prune = setInterval(() => pruneClaims().catch((err) => logger.error({ err }, 'claim pruning failed')), 6 * 3_600_000);
  timer.unref();
  prune.unref();
  return () => {
    clearInterval(timer);
    clearInterval(prune);
  };
}
