// Fills a development database with a believable term of one-to-one teaching, for demos and screenshots.
// Usage: DEMO_PASSWORD='...' npm run seed:demo        (refuses to run with NODE_ENV=production)
//
// Creates a teacher, three students, a weekly series (some lessons held, with notes and homework,
// some ahead), a lesson starting soon and a lesson awaiting notes. Running it again replaces the demo.
import { connectDb, disconnectDb } from '../config/db.js';
import env from '../config/env.js';
import User from '../models/User.js';
import Meeting from '../models/Meeting.js';
import Attendance from '../models/Attendance.js';
import { hashPassword } from '../services/authService.js';
import { generateMeetingCode, randomToken } from '../utils/crypto.js';

if (env.isProd) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 10) {
  console.error('Set DEMO_PASSWORD (at least 10 characters) for the demo accounts.');
  process.exit(1);
}

await connectDb();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const domain = process.env.DEMO_DOMAIN || 'demo.schole.test';
const people = {
  teacher: { name: 'Eleanor Whitcombe', email: `eleanor@${domain}`, role: 'teacher', teacherProfile: { bio: 'Piano and theory.', subjects: ['Piano', 'Music theory'] } },
  amara: { name: 'Amara Okafor', email: `amara@${domain}`, role: 'student', studentProfile: { gradeLevel: 'Grade 8 piano' } },
  luca: { name: 'Luca Bianchi', email: `luca@${domain}`, role: 'student', studentProfile: { gradeLevel: 'Diploma' } },
  sofia: { name: 'Sofía Herrera', email: `sofia@${domain}`, role: 'student' },
};

// Start over: the demo's own accounts and classes only.
const emails = Object.values(people).map((p) => p.email);
const old = await User.find({ email: { $in: emails } }).select('_id').lean();
const oldMeetings = await Meeting.find({ host: { $in: old.map((u) => u._id) } }).select('_id').lean();
await Attendance.deleteMany({ meeting: { $in: oldMeetings.map((m) => m._id) } });
await Meeting.deleteMany({ _id: { $in: oldMeetings.map((m) => m._id) } });
await User.deleteMany({ email: { $in: emails } });

const passwordHash = await hashPassword(password);
const u = {};
for (const [key, p] of Object.entries(people)) {
  u[key] = await User.create({ ...p, passwordHash, emailVerified: true, status: 'active' });
}

const settings = { waitingRoom: true, allowScreenShare: true, allowDrawing: true, chatMode: 'everyone', saveChat: true, hasPassword: false };
async function lesson({ title, student, at, minutes = 60, held = false, notes, homework = [], series, description = '' }) {
  const start = new Date(at);
  const m = await Meeting.create({
    code: generateMeetingCode(),
    title,
    description,
    host: u.teacher._id,
    type: 'scheduled',
    status: held ? 'ended' : 'scheduled',
    scheduledStart: start,
    durationMinutes: minutes,
    scheduledEnd: new Date(start.getTime() + minutes * 60_000),
    startedAt: held ? start : undefined,
    endedAt: held ? new Date(start.getTime() + (minutes - 4) * 60_000) : undefined,
    endedReason: held ? 'host_ended' : null,
    settings,
    invitees: [student.email],
    inviteNonce: randomToken(12),
    seriesId: series?.id,
    seriesIndex: series?.index,
    noticeSentAt: new Date(start.getTime() - 7 * DAY),
    reminderSentAt: held ? new Date(start.getTime() - 30 * 60_000) : null,
    lesson: notes || homework.length ? { summary: notes || '', homework, updatedAt: new Date(start.getTime() + minutes * 60_000 + 20 * 60_000) } : undefined,
  });
  if (held) {
    for (const [who, role] of [
      [u.teacher, 'host'],
      [student, 'participant'],
    ]) {
      await Attendance.create({ meeting: m._id, user: who._id, role, joinedAt: new Date(start.getTime() + 60_000), leftAt: m.endedAt, durationSec: Math.round((m.endedAt - start) / 1000) - 60, leaveReason: 'meeting_ended' });
    }
  }
  return m;
}

const now = Date.now();
const today = new Date();
today.setHours(0, 0, 0, 0);
const at = (dayOffset, hour, minute = 0) => today.getTime() + dayOffset * DAY + hour * HOUR + minute * 60_000;

// Amara: a weekly series on this weekday, three held with notes, five ahead.
const series = { id: randomToken(12) };
const notes = [
  ['Opened with the Bach Invention in F. Evenness in the left hand is much better. We began the second movement of the Haydn sonata.', [{ text: 'Invention No. 8, hands separately, metronome at 76', done: true, doneAt: new Date(at(-19, 18)) }, { text: 'Haydn, bars 1–24, slow practice', done: true, doneAt: new Date(at(-18, 18)) }]],
  ['The Haydn is coming together: phrasing in bars 9–16 is lovely. Scales in thirds remain the weak point; we set a short daily routine.', [{ text: 'Scales in thirds: C, G and D major, five minutes a day', done: true, doneAt: new Date(at(-11, 19)) }, { text: 'Haydn to bar 40', done: true, doneAt: new Date(at(-10, 19)) }, { text: 'Listen to Brendel’s recording of the slow movement', done: false }]],
  ['Exam pieces are secure. Sight-reading needs daily exposure; aural intervals are excellent. Next week we run the whole programme.', [{ text: 'Sight-read one short piece a day (book 4, nos. 1–7)', done: false }, { text: 'Run the full programme once, recorded', done: false }, { text: 'Revise cadences: perfect, plagal, imperfect', done: true, doneAt: new Date(at(-2, 20)) }]],
];
for (let i = 0; i < 8; i += 1) {
  const offset = -21 + i * 7;
  const held = offset < 0;
  await lesson({ title: 'Piano, Grade 8 preparation', student: u.amara, at: at(offset, 17), held, notes: held ? notes[i]?.[0] : undefined, homework: held ? notes[i]?.[1] ?? [] : [], series: { ...series, index: i } });
}
// Luca: one held yesterday without notes yet, one starting in 25 minutes.
await lesson({ title: 'Harmony and counterpoint', student: u.luca, at: at(-1, 15), held: true });
await lesson({ title: 'Harmony and counterpoint', student: u.luca, at: now + 25 * 60_000, minutes: 45, description: 'Bring the chorale harmonisations from last week.' });
// Sofía: a first lesson later this week.
await lesson({ title: 'Introductory lesson', student: u.sofia, at: at(3, 11), minutes: 30, description: 'A first conversation: goals, repertoire and a short play-through.' });

console.log(`Demo ready on ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);
for (const p of Object.values(people)) console.log(`  ${p.role.padEnd(8)} ${p.email}`);
console.log('  password: the DEMO_PASSWORD you set');
await disconnectDb();
