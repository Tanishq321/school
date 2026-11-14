import Meeting, { MEETING_STATUS } from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';

/**
 * The teacher's view of their students, and each person's own progress figures.
 * Everything is derived from classes and attendance; nothing here is stored separately.
 */

const hours = (ms) => Math.round((ms / 3_600_000) * 10) / 10;
const heldMs = (m) => (m.startedAt && m.endedAt ? Math.max(0, new Date(m.endedAt) - new Date(m.startedAt)) : 0);
const openHomework = (m) => (m.lesson?.homework ?? []).filter((h) => !h.done).length;
const lessonRef = (m) => (m ? { code: m.code, title: m.title, at: m.scheduledStart, status: m.status } : null);

/** One line per student a teacher has taught or will teach. */
export async function roster(teacher, { email } = {}) {
  const filter = { host: teacher.id, status: { $ne: MEETING_STATUS.CANCELLED }, 'invitees.0': { $exists: true } };
  if (email) filter.invitees = email;
  const classes = await Meeting.find(filter).select('code title invitees status scheduledStart scheduledEnd startedAt endedAt durationMinutes lesson seriesId').sort({ scheduledStart: 1 }).lean();
  const byEmail = new Map();
  for (const m of classes) {
    const key = m.invitees[0];
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(m);
  }
  const users = await User.find({ email: { $in: [...byEmail.keys()] } }).select('name email').lean();
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const attended = new Set(
    (
      await Attendance.find({ user: { $in: users.map((u) => u._id) }, meeting: { $in: classes.map((m) => m._id) } })
        .select('meeting user')
        .lean()
    ).map((a) => `${a.user}:${a.meeting}`),
  );
  const now = Date.now();
  const rows = [...byEmail.entries()].map(([address, list]) => {
    const u = userByEmail.get(address);
    const past = list.filter((m) => [MEETING_STATUS.ENDED, MEETING_STATUS.EXPIRED].includes(m.status));
    const held = past.filter((m) => m.startedAt);
    const came = u ? held.filter((m) => attended.has(`${u._id}:${m._id}`)) : [];
    const upcoming = list.filter((m) => [MEETING_STATUS.SCHEDULED, MEETING_STATUS.LIVE].includes(m.status) && new Date(m.scheduledEnd) > now);
    return {
      email: address,
      name: u?.name ?? null,
      hasAccount: Boolean(u),
      lessonsHeld: held.length,
      lessonsAttended: came.length,
      // of the lessons that were due, how many the student actually came to
      attendanceRate: past.length ? Math.round((came.length / past.length) * 100) : null,
      hoursTaught: hours(held.reduce((t, m) => t + heldMs(m), 0)),
      upcoming: upcoming.length,
      inSeries: upcoming.some((m) => m.seriesId),
      lastLesson: lessonRef(held[held.length - 1]),
      nextLesson: lessonRef(upcoming[0]),
      homeworkOpen: list.reduce((t, m) => t + openHomework(m), 0),
      homeworkDone: list.reduce((t, m) => t + (m.lesson?.homework ?? []).filter((h) => h.done).length, 0),
      lessons: email
        ? list.map((m) => ({
            ...lessonRef(m),
            durationMinutes: m.durationMinutes,
            attended: u ? attended.has(`${u._id}:${m._id}`) : false,
            hasLessonNotes: Boolean(m.lesson?.summary || m.lesson?.homework?.length),
            homeworkTotal: m.lesson?.homework?.length ?? 0,
            homeworkOpen: openHomework(m),
          }))
        : undefined,
    };
  });
  // Next lesson soonest first; students with nothing booked after them, most recently taught first.
  rows.sort((a, b) => {
    if (a.nextLesson && b.nextLesson) return new Date(a.nextLesson.at) - new Date(b.nextLesson.at);
    if (a.nextLesson || b.nextLesson) return a.nextLesson ? -1 : 1;
    return new Date(b.lastLesson?.at ?? 0) - new Date(a.lastLesson?.at ?? 0);
  });
  return rows;
}

/** Monday 00:00 UTC of the week containing `d`. */
function weekStart(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.getTime();
}

/**
 * Figures for the Today page, over the period the client asks for (its own local week or month).
 * Teachers: lessons, hours, students. Students: lessons, hours, homework and a weekly streak.
 */
export async function stats(user, { from, to }) {
  const now = new Date();
  if (user.role === 'teacher' || user.role === 'admin') {
    const inPeriod = await Meeting.find({ host: user.id, status: { $ne: MEETING_STATUS.CANCELLED }, scheduledStart: { $gte: from, $lt: to } })
      .select('status startedAt endedAt durationMinutes invitees lesson')
      .lean();
    const held = inPeriod.filter((m) => m.status === MEETING_STATUS.ENDED && m.startedAt);
    const recentStudents = await Meeting.distinct('invitees', { host: user.id, status: { $ne: MEETING_STATUS.CANCELLED }, scheduledStart: { $gte: new Date(now - 30 * 86_400_000), $lt: new Date(now.getTime() + 30 * 86_400_000) } });
    const toWrite = await Meeting.countDocuments({ host: user.id, status: MEETING_STATUS.ENDED, startedAt: { $gte: new Date(now - 14 * 86_400_000) }, 'invitees.0': { $exists: true }, 'lesson.updatedAt': null });
    return {
      role: 'teacher',
      period: { from, to },
      lessons: inPeriod.length,
      lessonsHeld: held.length,
      hoursBooked: hours(inPeriod.reduce((t, m) => t + m.durationMinutes * 60_000, 0)),
      hoursTaught: hours(held.reduce((t, m) => t + heldMs(m), 0)),
      students: new Set(inPeriod.flatMap((m) => m.invitees)).size,
      activeStudents: recentStudents.length,
      notesToWrite: toWrite, // lessons in the last fortnight still without a summary for the student
    };
  }
  const sessions = await Attendance.find({ user: user.id, role: 'participant', joinedAt: { $gte: new Date(now - 26 * 7 * 86_400_000) } })
    .select('meeting joinedAt durationSec')
    .lean();
  const inPeriod = sessions.filter((a) => a.joinedAt >= from && a.joinedAt < to);
  const mine = user.email ? await Meeting.find({ invitees: user.email.toLowerCase(), 'lesson.homework.0': { $exists: true } }).select('lesson').lean() : [];
  const items = mine.flatMap((m) => m.lesson.homework);
  // Weeks in a row with at least one lesson, counting back from this week (or last, if none yet this week).
  const weeks = new Set(sessions.map((a) => weekStart(new Date(a.joinedAt))));
  let cursor = weekStart(now);
  if (!weeks.has(cursor)) cursor -= 7 * 86_400_000;
  let streak = 0;
  while (weeks.has(cursor)) {
    streak += 1;
    cursor -= 7 * 86_400_000;
  }
  return {
    role: 'student',
    period: { from, to },
    lessons: new Set(inPeriod.map((a) => String(a.meeting))).size,
    hours: hours(inPeriod.reduce((t, a) => t + (a.durationSec ?? 0) * 1000, 0)),
    homeworkOpen: items.filter((h) => !h.done).length,
    homeworkDone: items.filter((h) => h.done).length,
    streakWeeks: streak,
  };
}
