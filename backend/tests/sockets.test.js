import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import Attendance from '../src/models/Attendance.js';
import Meeting from '../src/models/Meeting.js';
import { sweep } from '../src/services/meetingExpiryJob.js';
import { connected, createUser, emitAck, once, sleep, startTestServer } from './helpers.js';

let srv, teacher, student, student2;
beforeAll(async () => {
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Ms Teacher' });
  student = await createUser(srv.app, { role: 'student', name: 'Sam Student' });
  student2 = await createUser(srv.app, { role: 'student', name: 'Third Wheel' });
});
afterAll(async () => srv.close());

async function newMeeting(body = {}) {
  const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', ...body });
  return res.body.meeting;
}
async function joinToken(user, code, body = {}) {
  const res = await request(srv.app).post(`/api/meetings/${code}/join`).set(user.auth).send(body);
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.joinToken;
}
async function socketFor(user) {
  const s = srv.connect(user.accessToken);
  await connected(s);
  return s;
}

describe('socket authentication', () => {
  it('rejects sockets without a valid access token', async () => {
    const s = srv.connect('bogus');
    const err = await new Promise((r) => s.once('connect_error', r));
    expect(err.message).toMatch(/invalid|expired/i);
    const s2 = srv.connect(undefined);
    const err2 = await new Promise((r) => s2.once('connect_error', r));
    expect(err2.data.code).toBe('unauthorized');
  });

  it('rejects unverified users', async () => {
    const u = await createUser(srv.app, { role: 'student', verified: false });
    const s = srv.connect(u.accessToken);
    const err = await new Promise((r) => s.once('connect_error', r));
    expect(err.data.code).toBe('email_not_verified');
  });
});

describe('waiting room, admission and signalling', () => {
  let meeting, host, guest;

  it('host starts the meeting; student waits for approval', async () => {
    meeting = await newMeeting({ title: 'Waiting room test' });
    host = await socketFor(teacher);
    const h = await emitAck(host, 'meeting:join', { joinToken: await joinToken(teacher, meeting.code) });
    expect(h).toMatchObject({ ok: true, status: 'admitted', participants: [] });
    expect(h.self.isHost).toBe(true);
    expect((await Meeting.findOne({ code: meeting.code })).status).toBe('live');

    guest = await socketFor(student);
    const waitingNotice = once(host, 'waiting:updated');
    const g = await emitAck(guest, 'meeting:join', { joinToken: await joinToken(student, meeting.code) });
    expect(g).toMatchObject({ ok: true, status: 'waiting', reason: 'awaiting_approval' });
    const w = await waitingNotice;
    expect(w.waiting).toHaveLength(1);
    expect(w.waiting[0]).toMatchObject({ userId: student.id, name: 'Sam Student' });
    expect(w.waiting[0].socketId).toBeUndefined();
  });

  it('waiting participants cannot signal and non-hosts cannot admit', async () => {
    const sig = await emitAck(guest, 'p2p:signal', { to: teacher.id, data: { pcId: 'abcd', type: 'bye' } });
    expect(sig.error.code).toBe('not_in_meeting');
    const adm = await emitAck(guest, 'waiting:admit', { userId: student.id });
    expect(adm.ok).toBe(false);
  });

  it('host admits; both sides are notified', async () => {
    const admitted = once(guest, 'meeting:admitted');
    const joined = once(host, 'participant:joined');
    const r = await emitAck(host, 'waiting:admit', { userId: student.id });
    expect(r.ok).toBe(true);
    const a = await admitted;
    expect(a.status).toBe('admitted');
    expect(a.participants.map((p) => p.userId)).toEqual([teacher.id]);
    expect((await joined).userId).toBe(student.id);
  });

  it('relays signalling only between members, tagged with the sender', async () => {
    const got = once(guest, 'p2p:signal');
    const offer = { pcId: 'pc-1234', type: 'description', description: { type: 'offer', sdp: 'v=0\r\n' } };
    const r = await emitAck(host, 'p2p:signal', { to: student.id, data: offer });
    expect(r.ok).toBe(true);
    expect(await got).toEqual({ from: teacher.id, data: offer });

    const bad = await emitAck(guest, 'p2p:signal', { to: student2.id, data: { pcId: 'pc-1234', type: 'bye' } });
    expect(bad.error.code).toBe('peer_unavailable');
    const junk = await emitAck(guest, 'p2p:signal', { to: teacher.id, data: { pcId: 'pc-1', type: 'evil', extra: 1 } });
    expect(junk.error.code).toBe('bad_request');
  });

  it('broadcasts media state and provides fresh ICE servers to members', async () => {
    const st = once(host, 'participant:mediaState');
    await emitAck(guest, 'media:state', { audio: true, video: false });
    expect(await st).toEqual({ userId: student.id, audio: true, video: false });
    const ice = await emitAck(guest, 'ice:refresh');
    expect(ice.ok).toBe(true);
    expect(ice.iceServers.length).toBeGreaterThan(0);
  });

  it('enforces the 1-to-1 capacity in Phase 1 even if the host admits', async () => {
    const third = await socketFor(student2);
    const notice = once(host, 'waiting:updated');
    await emitAck(third, 'meeting:join', { joinToken: await joinToken(student2, meeting.code) });
    await notice;
    const r = await emitAck(host, 'waiting:admit', { userId: student2.id });
    expect(r.error.code).toBe('meeting_full');
    const denied = once(third, 'meeting:denied');
    await emitAck(host, 'waiting:deny', { userId: student2.id });
    await denied;
  });

  it('rejects join tokens issued to someone else', async () => {
    const tokenForStudent = await joinToken(student, meeting.code);
    const thief = await socketFor(student2);
    const r = await emitAck(thief, 'meeting:join', { joinToken: tokenForStudent });
    expect(r.error.code).toBe('token_mismatch');
  });

  it('keeps a seat during a short disconnect, then frees it after the grace period', async () => {
    const reconnecting = once(host, 'participant:reconnecting');
    guest.disconnect();
    expect((await reconnecting).userId).toBe(student.id);

    guest = await socketFor(student);
    const back = once(host, 'participant:reconnected');
    const r = await emitAck(guest, 'meeting:join', { joinToken: await joinToken(student, meeting.code) });
    expect(r).toMatchObject({ ok: true, status: 'admitted', resumed: true });
    await back;
    const sessions = await Attendance.find({ user: student.id }).lean();
    expect(sessions).toHaveLength(1); // not split by the reconnect

    const left = once(host, 'participant:left', 4000);
    guest.disconnect();
    expect(await left).toEqual({ userId: student.id, reason: 'disconnected' });
    const closed = await Attendance.findOne({ user: student.id }).lean();
    expect(closed.leftAt).toBeTruthy();
    expect(closed.leaveReason).toBe('disconnected');
  });

  it('host can end the meeting for everyone and attendance is closed', async () => {
    guest = await socketFor(student);
    // Previously admitted users are not sent back to the waiting room.
    const r = await emitAck(guest, 'meeting:join', { joinToken: await joinToken(student, meeting.code) });
    expect(r.status).toBe('admitted');
    await sleep(1100);

    const nonHost = await emitAck(guest, 'meeting:end');
    expect(nonHost.error.code).toBe('not_host');

    const ended = once(guest, 'meeting:ended');
    const res = await emitAck(host, 'meeting:end');
    expect(res.ok).toBe(true);
    expect((await ended).reason).toBe('host_ended');
    expect((await Meeting.findOne({ code: meeting.code })).status).toBe('ended');

    const report = await request(srv.app).get(`/api/meetings/${meeting.code}/attendance`).set(teacher.auth);
    const s = report.body.attendance.find((a) => a.user.id === student.id);
    expect(s.sessions).toBe(2);
    expect(s.present).toBe(false);
    expect(s.totalSeconds).toBeGreaterThanOrEqual(1);
    const open = await Attendance.countDocuments({ leftAt: null });
    expect(open).toBe(0);
  });
});

describe('joining before the host', () => {
  it('holds participants until the host arrives, then auto-admits when the waiting room is off', async () => {
    const meeting = await newMeeting({ waitingRoom: false });
    const guest = await socketFor(student);
    const g = await emitAck(guest, 'meeting:join', { joinToken: await joinToken(student, meeting.code) });
    expect(g).toMatchObject({ status: 'waiting', reason: 'host_not_started' });

    const admitted = once(guest, 'meeting:admitted');
    const host = await socketFor(teacher);
    const h = await emitAck(host, 'meeting:join', { joinToken: await joinToken(teacher, meeting.code) });
    expect(h.status).toBe('admitted');
    const a = await admitted;
    expect(a.participants[0].userId).toBe(teacher.id);
  });

  it('REST /leave tells the user’s live session to leave; /api/config exposes only public policy', async () => {
    const meeting = await newMeeting({ waitingRoom: false });
    const host = await socketFor(teacher);
    await emitAck(host, 'meeting:join', { joinToken: await joinToken(teacher, meeting.code) });
    const forced = once(host, 'meeting:force-leave');
    await request(srv.app).post(`/api/meetings/${meeting.code}/leave`).set(teacher.auth).expect(204);
    await forced;
    const cfg = await request(srv.app).get('/api/config').expect(200);
    expect(cfg.body).toMatchObject({ requireEmailVerification: true, mediaMode: 'p2p', maxParticipantsNow: 2 });
  });

  it('ends live meetings that sit empty past the idle limit', async () => {
    const meeting = await newMeeting({});
    const host = await socketFor(teacher);
    await emitAck(host, 'meeting:join', { joinToken: await joinToken(teacher, meeting.code) });
    await emitAck(host, 'meeting:leave');
    await sweep(Date.now() + 16 * 60_000);
    expect((await Meeting.findOne({ code: meeting.code })).status).toBe('ended');
  });
});
