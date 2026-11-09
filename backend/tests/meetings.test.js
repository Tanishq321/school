import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Meeting from '../src/models/Meeting.js';
import { sweep } from '../src/services/meetingExpiryJob.js';
import { createUser, startTestServer } from './helpers.js';

let srv, teacher, student, other;
beforeAll(async () => {
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher' });
  student = await createUser(srv.app, { role: 'student' });
  other = await createUser(srv.app, { role: 'teacher' });
});
afterAll(async () => srv.close());

describe('meeting creation', () => {
  it('only verified teachers/admins can create meetings', async () => {
    await request(srv.app).post('/api/meetings').set(student.auth).send({ type: 'instant' }).expect(403);
    const unverified = await createUser(srv.app, { role: 'teacher', verified: false });
    const res = await request(srv.app).post('/api/meetings').set(unverified.auth).send({ type: 'instant' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_not_verified');
    await request(srv.app).post('/api/meetings').send({ type: 'instant' }).expect(401);
  });

  it('creates an instant meeting with an unpredictable code and invite link', async () => {
    const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Algebra 1:1' });
    expect(res.status).toBe(201);
    const m = res.body.meeting;
    expect(m.code).toMatch(/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
    expect(m.inviteUrl).toContain(`/m/${m.code}?invite=`);
    expect(m.status).toBe('scheduled');
    expect(m.settings.passwordHash).toBeUndefined();
    expect(m.inviteNonce).toBeUndefined();
    const codes = new Set();
    for (let i = 0; i < 5; i += 1) {
      const r = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant' });
      codes.add(r.body.meeting.code);
    }
    expect(codes.size).toBe(5);
  });

  it('validates scheduled meetings', async () => {
    await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'scheduled' }).expect(400);
    await request(srv.app)
      .post('/api/meetings')
      .set(teacher.auth)
      .send({ type: 'scheduled', scheduledStart: new Date(Date.now() - 86400_000).toISOString() })
      .expect(400);
    const start = new Date(Date.now() + 86400_000);
    const res = await request(srv.app)
      .post('/api/meetings')
      .set(teacher.auth)
      .send({ type: 'scheduled', title: 'Physics', scheduledStart: start.toISOString(), durationMinutes: 45 });
    expect(res.status).toBe(201);
    expect(new Date(res.body.meeting.scheduledEnd).getTime()).toBe(start.getTime() + 45 * 60_000);
    await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', hack: true }).expect(400);
  });
});

describe('meeting access control', () => {
  let meeting;
  beforeAll(async () => {
    const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Secret class', password: 'open-sesame' });
    meeting = res.body.meeting;
  });

  it('shows hosts full details and others only a summary', async () => {
    const host = await request(srv.app).get(`/api/meetings/${meeting.code}`).set(teacher.auth);
    expect(host.body.meeting.inviteUrl).toBeTruthy();
    const guest = await request(srv.app).get(`/api/meetings/${meeting.code.toUpperCase()}`).set(student.auth);
    expect(guest.status).toBe(200);
    expect(guest.body.meeting).toMatchObject({ title: 'Secret class', hasPassword: true, isHost: false });
    expect(guest.body.meeting.inviteUrl).toBeUndefined();
    expect(guest.body.meeting.id).toBeUndefined();
  });

  it('rejects malformed and unknown codes', async () => {
    await request(srv.app).get('/api/meetings/not-a-code').set(student.auth).expect(400);
    const r = await request(srv.app).get('/api/meetings/aaa-aaaa-aaa').set(student.auth);
    expect(r.status).toBe(404);
  });

  it('enforces the meeting password unless a valid invite token is used', async () => {
    const none = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({});
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('password_required');
    const wrong = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ password: 'nope' });
    expect(wrong.body.error.code).toBe('invalid_meeting_password');
    const forged = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ invite: 'x'.repeat(32) });
    expect(forged.status).toBe(401);

    const ok = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ password: 'open-sesame' });
    expect(ok.status).toBe(200);
    expect(ok.body.joinToken).toBeTruthy();
    expect(ok.body.meeting.isHost).toBe(false);

    const invite = new URL(meeting.inviteUrl).searchParams.get('invite');
    const viaInvite = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ invite });
    expect(viaInvite.status).toBe(200);
  });

  it('returns short-lived TURN credentials in coturn REST format, never the secret', async () => {
    const res = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(teacher.auth).send({});
    expect(res.status).toBe(200);
    const turn = res.body.iceServers.find((s) => String(s.urls).includes('turn:'));
    const [expiry, uid] = turn.username.split(':');
    expect(uid).toBe(teacher.id);
    expect(Number(expiry)).toBeGreaterThan(Date.now() / 1000);
    expect(Number(expiry)).toBeLessThanOrEqual(Date.now() / 1000 + 10800 + 5);
    expect(JSON.stringify(res.body)).not.toContain(process.env.TURN_SECRET);
  });

  it('rotating the invite invalidates old invite links', async () => {
    const oldInvite = new URL(meeting.inviteUrl).searchParams.get('invite');
    const upd = await request(srv.app).patch(`/api/meetings/${meeting.code}`).set(teacher.auth).send({ rotateInvite: true });
    expect(upd.status).toBe(200);
    const r = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ invite: oldInvite });
    expect(r.status).toBe(401);
  });

  it('only the host can update, end or view attendance', async () => {
    await request(srv.app).patch(`/api/meetings/${meeting.code}`).set(other.auth).send({ title: 'pwned' }).expect(403);
    await request(srv.app).post(`/api/meetings/${meeting.code}/end`).set(student.auth).expect(403);
    await request(srv.app).get(`/api/meetings/${meeting.code}/attendance`).set(student.auth).expect(403);
    await request(srv.app).get(`/api/meetings/${meeting.code}/attendance`).set(teacher.auth).expect(200);
  });

  it('ending closes the meeting for new joins', async () => {
    const end = await request(srv.app).post(`/api/meetings/${meeting.code}/end`).set(teacher.auth);
    expect(end.status).toBe(200);
    expect(end.body.meeting.status).toBe('cancelled'); // never went live
    const join = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(student.auth).send({ password: 'open-sesame' });
    expect(join.status).toBe(410);
  });
});

describe('listing & expiry', () => {
  it('lists upcoming meetings for the host', async () => {
    const res = await request(srv.app).get('/api/meetings?scope=upcoming').set(teacher.auth);
    expect(res.status).toBe(200);
    expect(res.body.meetings.length).toBeGreaterThan(0);
    expect(res.body.meetings.every((m) => m.isHost)).toBe(true);
    const s = await request(srv.app).get('/api/meetings?scope=upcoming').set(student.auth);
    expect(s.body.meetings).toEqual([]);
  });

  it('expires scheduled meetings that never started', async () => {
    const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'stale' });
    await Meeting.updateOne(
      { code: res.body.meeting.code },
      { $set: { scheduledStart: new Date(Date.now() - 5 * 3600_000), scheduledEnd: new Date(Date.now() - 4 * 3600_000) } },
    );
    await sweep();
    const m = await Meeting.findOne({ code: res.body.meeting.code });
    expect(m.status).toBe('expired');
    const past = await request(srv.app).get('/api/meetings?scope=past').set(teacher.auth);
    expect(past.body.meetings.some((x) => x.code === m.code)).toBe(true);
  });
});
