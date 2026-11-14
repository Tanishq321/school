import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Meeting from '../src/models/Meeting.js';
import Attendance from '../src/models/Attendance.js';
import User from '../src/models/User.js';
import env from '../src/config/env.js';
import { devOutbox } from '../src/services/mailer.js';
import { sendDueReminders } from '../src/services/reminderJob.js';
import { buildIcs } from '../src/services/calendarService.js';
import { hashPassword } from '../src/services/authService.js';
import { createUser, sleep, startTestServer } from './helpers.js';

let srv, teacher, student, outsider, otherTeacher;
const DAY = 86_400_000;
const mailsTo = (email) => devOutbox.filter((m) => m.to === email);
const lastMail = (email) => mailsTo(email).at(-1);
// emails are sent without blocking the response
const settle = () => sleep(150);

beforeAll(async () => {
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Clara Teacher' });
  student = await createUser(srv.app, { role: 'student', name: 'Sam Student' });
  outsider = await createUser(srv.app, { role: 'student' });
  otherTeacher = await createUser(srv.app, { role: 'teacher' });
  await request(srv.app).patch('/api/auth/me').set(student.auth).send({ timeZone: 'Asia/Tokyo' }).expect(200);
});
afterAll(async () => srv.close());

const schedule = (body, who = teacher) => request(srv.app).post('/api/meetings').set(who.auth).send({ type: 'scheduled', title: 'Piano; grade 8', invitees: [student.email], ...body });

describe('weekly series', () => {
  let series;
  it('creates one class per week, each with its own code, and invites once', async () => {
    const start = new Date(Date.now() + 2 * DAY);
    const before = mailsTo(student.email).length;
    const res = await schedule({ scheduledStart: start, durationMinutes: 45, repeatWeeks: 4 });
    expect(res.status).toBe(201);
    expect(res.body.series.count).toBe(4);
    const list = await Meeting.find({ seriesId: res.body.series.id }).sort({ scheduledStart: 1 });
    expect(list).toHaveLength(4);
    expect(new Set(list.map((m) => m.code)).size).toBe(4);
    list.forEach((m, i) => {
      expect(m.seriesIndex).toBe(i);
      expect(m.scheduledStart.getTime() - start.getTime()).toBe(i * 7 * DAY);
      expect(m.invitees).toEqual([student.email]);
    });
    await settle();
    const sent = mailsTo(student.email).slice(before);
    expect(sent).toHaveLength(1); // one email for the whole series
    expect(sent[0].text).toMatch(/4 lessons/);
    expect(sent[0].text).toMatch(/GMT\+9/); // shown in the student's own time zone
    const ics = sent[0].attachments[0].content;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(ics).toContain('SUMMARY:Piano\\; grade 8'); // semicolons escaped (RFC 5545)
    series = list;
  });

  it('refuses a repeating instant class and more than 26 weeks', async () => {
    await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', repeatWeeks: 3 }).expect(400);
    await schedule({ scheduledStart: new Date(Date.now() + DAY), repeatWeeks: 27 }).expect(400);
  });

  it('the class page lists the whole series', async () => {
    const res = await request(srv.app).get(`/api/meetings/${series[1].code}/summary`).set(student.auth).expect(200);
    expect(res.body.series.lessons.map((l) => l.code)).toEqual(series.map((m) => m.code));
  });

  it('cancels this and the following lessons, with one email that removes them', async () => {
    const before = mailsTo(student.email).length;
    const res = await request(srv.app).delete(`/api/meetings/${series[2].code}?scope=following`).set(teacher.auth).expect(200);
    expect(res.body.cancelled).toBe(2);
    const statuses = (await Meeting.find({ seriesId: series[0].seriesId }).sort({ scheduledStart: 1 })).map((m) => m.status);
    expect(statuses).toEqual(['scheduled', 'scheduled', 'cancelled', 'cancelled']);
    await settle();
    const sent = mailsTo(student.email).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/Cancelled: .*2 lessons/);
    const ics = sent[0].attachments[0].content;
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics.match(/STATUS:CANCELLED/g)).toHaveLength(2);
  });

  it('cancelling one lesson leaves the rest of the series', async () => {
    const res = await request(srv.app).delete(`/api/meetings/${series[0].code}`).set(teacher.auth).expect(200);
    expect(res.body.cancelled).toBe(1);
    expect((await Meeting.findById(series[1]._id)).status).toBe('scheduled');
  });

  it('only the teacher can cancel', async () => {
    await request(srv.app).delete(`/api/meetings/${series[1].code}?scope=following`).set(student.auth).expect(403);
    await request(srv.app).delete(`/api/meetings/${series[1].code}`).set(otherTeacher.auth).expect(403);
  });
});

describe('reschedule and reminders', () => {
  it('tells the student the new time with a calendar update, and reminds again', async () => {
    const res = await schedule({ title: 'Theory', scheduledStart: new Date(Date.now() + 3 * DAY) });
    const code = res.body.meeting.code;
    await Meeting.updateOne({ code }, { $set: { reminderSentAt: new Date() } });
    await settle();
    const before = mailsTo(student.email).length;
    const moved = new Date(Date.now() + 4 * DAY);
    await request(srv.app).patch(`/api/meetings/${code}`).set(teacher.auth).send({ scheduledStart: moved }).expect(200);
    await settle();
    const sent = mailsTo(student.email).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('New time: Theory');
    expect(sent[0].text).toMatch(/Was: /);
    expect(sent[0].attachments[0].content).toContain('METHOD:REQUEST');
    expect((await Meeting.findOne({ code })).reminderSentAt).toBeNull();
    // a title change alone sends nothing
    await request(srv.app).patch(`/api/meetings/${code}`).set(teacher.auth).send({ title: 'Theory II' }).expect(200);
    await settle();
    expect(mailsTo(student.email).length).toBe(before + 1);
  });

  it('reminds teacher and student once, shortly before the class, across concurrent sweeps', async () => {
    const res = await schedule({ title: 'Sight-reading', scheduledStart: new Date(Date.now() + 2 * DAY) });
    const code = res.body.meeting.code;
    const now = new Date();
    // as if created long ago, and starting in 20 minutes
    await Meeting.updateOne({ code }, { $set: { scheduledStart: new Date(now.getTime() + 20 * 60_000), scheduledEnd: new Date(now.getTime() + 80 * 60_000), noticeSentAt: new Date(now - DAY) } });
    const s0 = mailsTo(student.email).length;
    const t0 = mailsTo(teacher.email).length;
    await Promise.all([sendDueReminders(now), sendDueReminders(now)]);
    const toStudent = mailsTo(student.email).slice(s0).filter((m) => m.subject.includes('Sight-reading'));
    const toTeacher = mailsTo(teacher.email).slice(t0).filter((m) => m.subject.includes('Sight-reading'));
    expect(toStudent).toHaveLength(1);
    expect(toTeacher).toHaveLength(1);
    expect(toStudent[0].subject).toBe('In 20 minutes: Sight-reading');
    expect(toStudent[0].text).toContain('?invite='); // the student's link lets them straight in
    expect(toTeacher[0].text).toContain('Sam Student');
    await sendDueReminders(new Date(now.getTime() + 60_000));
    expect(mailsTo(student.email).slice(s0).filter((m) => m.subject.includes('Sight-reading'))).toHaveLength(1);
  });

  it('does not remind right after the invitation went out', async () => {
    const start = new Date(Date.now() + 15 * 60_000);
    const res = await schedule({ title: 'Scales', scheduledStart: start });
    await settle();
    const before = mailsTo(student.email).length;
    await sendDueReminders(new Date());
    expect(mailsTo(student.email).length).toBe(before);
    expect((await Meeting.findOne({ code: res.body.meeting.code })).reminderSentAt).not.toBeNull();
  });
});

describe('lesson summary and homework', () => {
  let code;
  it('the teacher writes notes and homework; the student reads them, the private notes stay private', async () => {
    const res = await schedule({ title: 'Harmony', scheduledStart: new Date(Date.now() + DAY) });
    code = res.body.meeting.code;
    await request(srv.app).put(`/api/meetings/${code}/notes`).set(teacher.auth).send({ notes: 'private: needs encouragement' }).expect(200);
    const before = mailsTo(student.email).length;
    const saved = await request(srv.app)
      .put(`/api/meetings/${code}/lesson`)
      .set(teacher.auth)
      .send({ summary: 'Good work on cadences.', homework: [{ text: 'Exercise 4, bars 1-16' }, { text: 'Listen to Bach chorale 12' }], notify: true })
      .expect(200);
    expect(saved.body.lesson.homework).toHaveLength(2);
    await settle();
    const mail = mailsTo(student.email).slice(before);
    expect(mail).toHaveLength(1);
    expect(mail[0].subject).toBe('Notes from your lesson: Harmony');
    expect(mail[0].text).toContain('- Exercise 4, bars 1-16');

    const seen = await request(srv.app).get(`/api/meetings/${code}/summary`).set(student.auth).expect(200);
    expect(seen.body.lesson.summary).toBe('Good work on cadences.');
    expect(seen.body.notes).toBeUndefined();
    expect(JSON.stringify(seen.body)).not.toContain('encouragement');
    expect(seen.body.meeting.homeworkOpen).toBe(2);
  });

  it('only the teacher writes; only the class may tick', async () => {
    await request(srv.app).put(`/api/meetings/${code}/lesson`).set(student.auth).send({ summary: 'x' }).expect(403);
    const lesson = (await request(srv.app).get(`/api/meetings/${code}/summary`).set(student.auth)).body.lesson;
    const item = lesson.homework[0].id;
    await request(srv.app).post(`/api/meetings/${code}/homework/${item}`).set(outsider.auth).send({ done: true }).expect(403);
    const ticked = await request(srv.app).post(`/api/meetings/${code}/homework/${item}`).set(student.auth).send({ done: true }).expect(200);
    expect(ticked.body.lesson.homework[0].done).toBe(true);
    expect(ticked.body.lesson.homework[0].doneAt).toBeTruthy();
    await request(srv.app).post(`/api/meetings/${code}/homework/0123456789abcdef01234567`).set(student.auth).send({ done: true }).expect(404);
    await request(srv.app).post(`/api/meetings/${code}/homework/nope`).set(student.auth).send({ done: true }).expect(400);
  });

  it('editing around a ticked item keeps its tick', async () => {
    const lesson = (await request(srv.app).get(`/api/meetings/${code}/summary`).set(teacher.auth)).body.lesson;
    const [done, other] = lesson.homework;
    const res = await request(srv.app)
      .put(`/api/meetings/${code}/lesson`)
      .set(teacher.auth)
      .send({ homework: [{ id: done.id, text: 'Exercise 4, bars 1-24' }, { text: 'New: scales in F# minor' }] })
      .expect(200);
    expect(res.body.lesson.summary).toBe('Good work on cadences.'); // untouched when not sent
    expect(res.body.lesson.homework.map((h) => [h.text, h.done])).toEqual([
      ['Exercise 4, bars 1-24', true],
      ['New: scales in F# minor', false],
    ]);
    expect(res.body.lesson.homework.some((h) => h.id === other.id)).toBe(false);
  });

  it('rejects empty and oversized homework', async () => {
    await request(srv.app).put(`/api/meetings/${code}/lesson`).set(teacher.auth).send({ homework: [{ text: '' }] }).expect(400);
    await request(srv.app)
      .put(`/api/meetings/${code}/lesson`)
      .set(teacher.auth)
      .send({ homework: Array.from({ length: 21 }, (_, i) => ({ text: `item ${i}` })) })
      .expect(400);
  });
});

describe('students and progress', () => {
  it("lists the teacher's students with their lessons, attendance and homework", async () => {
    // one lesson held last week that the student came to, one the student missed
    const now = Date.now();
    const held = await Meeting.findOne({ host: teacher.id, title: 'Harmony' });
    held.status = 'ended';
    held.scheduledStart = new Date(now - 3 * DAY);
    held.scheduledEnd = new Date(now - 3 * DAY + 3_600_000);
    held.startedAt = new Date(now - 3 * DAY);
    held.endedAt = new Date(now - 3 * DAY + 50 * 60_000);
    await held.save();
    await Attendance.create({ meeting: held._id, user: student.id, role: 'participant', joinedAt: new Date(now - 3 * DAY + 60_000), leftAt: new Date(now - 3 * DAY + 49 * 60_000), durationSec: 48 * 60 });
    await Meeting.updateOne({ host: teacher.id, title: 'Scales' }, { $set: { status: 'expired', scheduledStart: new Date(now - 2 * DAY), scheduledEnd: new Date(now - 2 * DAY + 3_600_000) } });

    const res = await request(srv.app).get('/api/students').set(teacher.auth).expect(200);
    expect(res.body.students).toHaveLength(1);
    const s = res.body.students[0];
    expect(s).toMatchObject({ email: student.email, name: 'Sam Student', hasAccount: true, lessonsHeld: 1, lessonsAttended: 1, attendanceRate: 50, hoursTaught: 0.8, homeworkOpen: 1, homeworkDone: 1, inSeries: true });
    expect(s.nextLesson.code).toBeTruthy();
    expect(s.lastLesson.title).toBe('Harmony');
    expect(s.lessons).toBeUndefined();

    const one = await request(srv.app).get(`/api/students/${encodeURIComponent(student.email.toUpperCase())}`).set(teacher.auth).expect(200);
    expect(one.body.student.lessons.find((l) => l.title === 'Harmony')).toMatchObject({ attended: true, hasLessonNotes: true, homeworkOpen: 1 });
    await request(srv.app).get(`/api/students/${encodeURIComponent(student.email)}`).set(otherTeacher.auth).expect(404);
    await request(srv.app).get('/api/students').set(student.auth).expect(403);
    expect((await request(srv.app).get('/api/students').set(otherTeacher.auth)).body.students).toEqual([]);
  });

  it("gives each person their own figures for the period they ask", async () => {
    const from = new Date(Date.now() - 7 * DAY).toISOString();
    const to = new Date(Date.now() + 7 * DAY).toISOString();
    const t = await request(srv.app).get('/api/me/stats').query({ from, to }).set(teacher.auth).expect(200);
    expect(t.body).toMatchObject({ role: 'teacher', lessonsHeld: 1, hoursTaught: 0.8, students: 1 });
    expect(t.body.lessons).toBeGreaterThanOrEqual(3);
    const st = await request(srv.app).get('/api/me/stats').query({ from, to }).set(student.auth).expect(200);
    expect(st.body).toMatchObject({ role: 'student', lessons: 1, hours: 0.8, homeworkOpen: 1, homeworkDone: 1 });
    expect(st.body.streakWeeks).toBeGreaterThanOrEqual(1);
    await request(srv.app).get('/api/me/stats').query({ from: to, to: from }).set(student.auth).expect(400);
    await request(srv.app).get('/api/me/stats').query({ from: new Date(Date.now() - 90 * DAY).toISOString(), to }).set(student.auth).expect(400);
  });
});

describe('time zones', () => {
  it('accepts real zones only', async () => {
    await request(srv.app).patch('/api/auth/me').set(outsider.auth).send({ timeZone: 'Mars/Olympus' }).expect(400);
    await request(srv.app).patch('/api/auth/me').set(outsider.auth).send({ timeZone: 'Europe/London' }).expect(200);
    expect((await User.findById(outsider.id)).timeZone).toBe('Europe/London');
  });

  it('calendar files escape text per RFC 5545', () => {
    const ics = buildIcs({ _id: 'x', title: 'a;b,c\\d', scheduledStart: new Date(), durationMinutes: 30 }, { url: 'https://x.test/m/abc' });
    expect(ics).toContain('SUMMARY:a\\;b\\,c\\\\d');
  });
});

describe('administrators must use two-step sign-in', () => {
  it('closes the console until two-step is on', async () => {
    await User.create({ name: 'Second Admin', email: 'admin2@example.test', role: 'admin', emailVerified: true, passwordHash: await hashPassword('AdminPassw0rd!') });
    const login = await request(srv.app).post('/api/auth/login').send({ email: 'admin2@example.test', password: 'AdminPassw0rd!' }).expect(200);
    const auth = { Authorization: `Bearer ${login.body.accessToken}` };
    const was = env.ADMIN_REQUIRE_2FA;
    env.ADMIN_REQUIRE_2FA = true;
    try {
      const res = await request(srv.app).get('/api/admin/overview').set(auth).expect(403);
      expect(res.body.error.code).toBe('two_factor_required');
      expect((await request(srv.app).get('/api/config')).body.adminRequiresTwoFactor).toBe(true);
      await User.updateOne({ email: 'admin2@example.test' }, { $set: { 'twoFactor.enabled': true } });
      await request(srv.app).get('/api/admin/overview').set(auth).expect(200);
    } finally {
      env.ADMIN_REQUIRE_2FA = was;
    }
  });
});
