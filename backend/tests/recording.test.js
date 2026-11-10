import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-test-'));
vi.hoisted(() => {
  process.env.MEDIASOUP_ENABLED = 'true';
  process.env.MEDIASOUP_NUM_WORKERS = '1';
  process.env.MEDIASOUP_LISTEN_IP = '127.0.0.1';
  process.env.MEDIASOUP_PORT_BASE = '44200';
  process.env.RECORDING_ENABLED = 'true';
  process.env.RECORDING_MIN_FREE_MB = '0';
});
process.env.RECORDINGS_DIR = recDir;

const request = (await import('supertest')).default;
const { workerPool } = await import('../src/mediasoup/workerPool.js');
const { rooms } = await import('../src/sockets/realtime.js');
const recordingService = await import('../src/services/recordingService.js');
const Recording = (await import('../src/models/Recording.js')).default;
const Meeting = (await import('../src/models/Meeting.js')).default;
const env = (await import('../src/config/env.js')).default;
const { devOutbox } = await import('../src/services/mailer.js');
const { connected, createUser, emitAck, once, sleep, startTestServer } = await import('./helpers.js');

env.RECORDINGS_DIR = recDir;

let srv, teacher, student, outsider, invitee;
const procs = [];
beforeAll(async () => {
  await workerPool.start();
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Professor Vale' });
  student = await createUser(srv.app, { role: 'student', name: 'Iris Student' });
  outsider = await createUser(srv.app, { role: 'student', name: 'Out Sider' });
  invitee = await createUser(srv.app, { role: 'student', name: 'Invited Guest' });
});
afterAll(async () => {
  procs.forEach((p) => p.kill('SIGKILL'));
  await srv.close();
  await workerPool.close();
  fs.rmSync(recDir, { recursive: true, force: true });
});

let meeting;
const sockets = {};
async function joinAs(user, key) {
  const tok = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(user.auth).send({});
  const s = srv.connect(user.accessToken);
  await connected(s);
  sockets[key] = s;
  return emitAck(s, 'meeting:join', { joinToken: tok.body.joinToken });
}
async function joinMedia(s) {
  const caps = await emitAck(s, 'mediasoup:getRouterRtpCapabilities');
  await emitAck(s, 'mediasoup:join', { sessionId: `sess-${Math.random().toString(36).slice(2)}`, rtpCapabilities: caps.rtpCapabilities });
}

/** Publishes a synthetic stream for a participant: FFmpeg → RTP → mediasoup producer. */
async function publish(userId, source, ffArgs) {
  const sfu = rooms.get(meeting.id).sfu;
  const kind = source === 'mic' ? 'audio' : 'video';
  const ssrc = 1000 + Math.floor(Math.random() * 100000);
  const pt = kind === 'audio' ? 100 : 101;
  const t = await sfu.router.createPlainTransport({ listenInfo: { protocol: 'udp', ip: '127.0.0.1' }, rtcpMux: false, comedia: true });
  const codec = kind === 'audio' ? { mimeType: 'audio/opus', clockRate: 48000, channels: 2, payloadType: pt } : { mimeType: 'video/VP8', clockRate: 90000, payloadType: pt };
  const producer = await t.produce({ kind, rtpParameters: { codecs: [codec], encodings: [{ ssrc }] }, appData: { userId, source } });
  sfu.peers.get(userId).producers.set(producer.id, producer);
  for (const ev of ['pause', 'resume', 'close']) producer.observer.on(ev, () => sfu.changed());
  sfu.changed();
  const url = `rtp://127.0.0.1:${t.tuple.localPort}?rtcpport=${t.rtcpTuple.localPort}`;
  procs.push(spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-re', ...ffArgs, '-ssrc', String(ssrc), '-payload_type', String(pt), '-f', 'rtp', url], { stdio: 'ignore' }));
  return producer;
}
const tone = (hz) => ['-f', 'lavfi', '-i', `sine=f=${hz}:d=60`, '-c:a', 'libopus', '-ac', '1', '-b:a', '48k'];
const picture = ['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=60', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k', '-g', '25'];

/** RMS level (dBFS) of one frequency band in a time window of the final file. */
function rms(file, hz, from, to) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-to', String(to), '-i', file, '-af', `bandpass=f=${hz}:width_type=q:w=8,astats=metadata=0`, '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /Overall[\s\S]*?RMS level dB:\s*(-?[\d.]+|-inf)/.exec(res.stderr);
  return m ? (m[1] === '-inf' ? -200 : Number(m[1])) : NaN;
}

let recordingId;

describe('class invitations, calendar and notes', () => {
  it('a scheduled class invites guests by email with a calendar file', async () => {
    const start = new Date(Date.now() + 3600_000);
    const res = await request(srv.app)
      .post('/api/meetings')
      .set(teacher.auth)
      .send({ type: 'scheduled', title: 'Seminar on Ethics', scheduledStart: start.toISOString(), durationMinutes: 45, invitees: [invitee.email.toUpperCase()] })
      .expect(201);
    expect(res.body.meeting.invitees).toEqual([invitee.email]);
    // One-to-one: a class has exactly one student.
    const two = await request(srv.app)
      .post('/api/meetings')
      .set(teacher.auth)
      .send({ type: 'scheduled', title: 'Too many', scheduledStart: start.toISOString(), invitees: [invitee.email, 'someone@example.test'] })
      .expect(400);
    expect(two.body.error.message).toMatch(/one student/);
    const mail = [...devOutbox].reverse().find((m) => m.to === invitee.email);
    expect(mail.subject).toContain('Seminar on Ethics');
    expect(mail.attachments[0].content).toMatch(/BEGIN:VCALENDAR[\s\S]*DTSTART:\d{8}T\d{6}Z[\s\S]*END:VEVENT/);

    const range = await request(srv.app)
      .get('/api/meetings')
      .query({ scope: 'range', from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000 * 2).toISOString() })
      .set(invitee.auth)
      .expect(200);
    expect(range.body.meetings.map((m) => m.title)).toContain('Seminar on Ethics');
    expect(range.body.meetings.find((m) => m.title === 'Seminar on Ethics')).toMatchObject({ invited: true, isHost: false });
    const outsiderRange = await request(srv.app).get('/api/meetings').query({ scope: 'range', from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000 * 2).toISOString() }).set(outsider.auth);
    expect(outsiderRange.body.meetings.map((m) => m.title)).not.toContain('Seminar on Ethics');
    await request(srv.app).get('/api/meetings').query({ scope: 'range', from: new Date().toISOString(), to: new Date(Date.now() + 90 * 86400_000).toISOString() }).set(invitee.auth).expect(400);

    const code = res.body.meeting.code;
    const ics = await request(srv.app).get(`/api/meetings/${code}/calendar.ics`).set(invitee.auth).expect(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.text).toContain('SUMMARY:Seminar on Ethics');
    await request(srv.app).get(`/api/meetings/${code}/calendar.ics`).set(outsider.auth).expect(403);
    await request(srv.app).get(`/api/meetings/${code}/summary`).set(outsider.auth).expect(403);

    await request(srv.app).put(`/api/meetings/${code}/notes`).set(teacher.auth).send({ notes: 'Bring Kant.' }).expect(200);
    await request(srv.app).put(`/api/meetings/${code}/notes`).set(invitee.auth).send({ notes: 'x' }).expect(403);
    const host = await request(srv.app).get(`/api/meetings/${code}/summary`).set(teacher.auth).expect(200);
    expect(host.body).toMatchObject({ notes: 'Bring Kant.', transcript: [], attendance: [] });
    expect(host.body.guests).toEqual(expect.arrayContaining([{ email: invitee.email, name: 'Invited Guest', hasAccount: true }]));
    const guest = await request(srv.app).get(`/api/meetings/${code}/summary`).set(invitee.auth).expect(200);
    expect(guest.body.notes).toBeUndefined();
    expect(guest.body.transcript).toBeUndefined();
    expect(JSON.stringify(guest.body)).not.toContain('Bring Kant');
  });
});

describe('recording', () => {
  it('only the host may record; everyone sees the state and is asked for consent', async () => {
    const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Recorded tutorial', waitingRoom: true, invitees: [student.email] });
    meeting = res.body.meeting;
    const h = await joinAs(teacher, 'host');
    expect(h.recording).toMatchObject({ active: false, available: true });
    // The invited student skips the waiting room.
    const s = await joinAs(student, 'stu');
    expect(s.status).toBe('admitted');
    // Someone else is held in the waiting room and cannot be admitted: the seat is taken.
    const g = await joinAs(invitee, 'guest');
    expect(g.status).toBe('waiting');
    expect((await emitAck(sockets.host, 'waiting:admit', { userId: invitee.id })).error.code).toBe('meeting_full');
    await emitAck(sockets.host, 'waiting:deny', { userId: invitee.id });

    await joinMedia(sockets.host);
    await joinMedia(sockets.stu);
    await publish(teacher.id, 'mic', tone(440));
    await publish(teacher.id, 'camera', picture);
    await publish(student.id, 'mic', tone(1500));
    await sleep(800);

    const denied = await emitAck(sockets.stu, 'recording:start');
    expect(denied).toMatchObject({ ok: false, error: { code: 'not_host' } });

    const stuState = once(sockets.stu, 'recording:state');
    const consents = once(sockets.host, 'recording:consents');
    const started = await emitAck(sockets.host, 'recording:start');
    expect(started).toMatchObject({ ok: true, recording: { active: true, myConsent: 'accepted' } });
    recordingId = started.recording.id;
    expect(await stuState).toMatchObject({ active: true, myConsent: 'pending', startedBy: 'Professor Vale' });
    expect((await consents).consents).toEqual(expect.arrayContaining([expect.objectContaining({ userId: student.id, decision: 'pending' })]));
    expect(await emitAck(sockets.host, 'recording:start')).toMatchObject({ ok: false, error: { code: 'already_recording' } });
  });

  it('a participant who declines is never captured, and is captured from the moment they agree', async () => {
    const declined = await emitAck(sockets.stu, 'recording:consent', { accept: false });
    expect(declined).toMatchObject({ ok: true, recording: { myConsent: 'declined' } });
    await sleep(3500);
    const accepted = await emitAck(sockets.stu, 'recording:consent', { accept: true });
    expect(accepted.recording.myConsent).toBe('accepted');
    await sleep(4000);
    const doc = await Recording.findById(recordingId);
    expect(doc.consent.map((c) => [c.name, c.decision])).toEqual(expect.arrayContaining([['Iris Student', 'accepted'], ['Professor Vale', 'accepted']]));

    const done = new Promise((resolve) => {
      const off = recordingService.onProcessed((e) => {
        if (e.id === recordingId) {
          off();
          resolve(e);
        }
      });
    });
    const stopped = once(sockets.stu, 'recording:stopped');
    expect(await emitAck(sockets.host, 'recording:stop')).toMatchObject({ ok: true, stopped: true, id: recordingId });
    await stopped;
    expect((await Recording.findById(recordingId)).status).toBe('processing');
    expect(await done).toMatchObject({ status: 'ready' });

    const rec = await Recording.findById(recordingId).select('+file +thumbnail');
    expect(rec.status).toBe('ready');
    expect(rec.durationSec).toBeGreaterThanOrEqual(6);
    const file = path.join(recDir, rec.file);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height', '-of', 'json', file]).toString());
    expect(probe.streams).toEqual(expect.arrayContaining([expect.objectContaining({ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 }), expect.objectContaining({ codec_type: 'audio', codec_name: 'aac' })]));
    expect(fs.existsSync(path.join(recDir, rec.thumbnail))).toBe(true);
    // Raw tracks are cleaned up once the final file exists.
    expect(fs.readdirSync(path.dirname(file)).filter((f) => /\.(ogg|ivf)$/.test(f))).toEqual([]);

    // The host's voice is there throughout; the student's only after they agreed (~3.5 s in).
    const hostEarly = rms(file, 440, 0.5, 2.5);
    const stuEarly = rms(file, 1500, 0.5, 2.5);
    const stuLate = rms(file, 1500, 5, 7);
    expect(hostEarly).toBeGreaterThan(-40);
    expect(stuLate).toBeGreaterThan(-40);
    expect(stuLate - stuEarly).toBeGreaterThan(20); // before consent: only filter bleed from the host's tone
  }, 60_000);

  it('recordings are private to the host until shared; playback uses short-lived signed URLs with Range support', async () => {
    const list = await request(srv.app).get('/api/recordings').set(teacher.auth).expect(200);
    expect(list.body.recordings[0]).toMatchObject({ id: recordingId, status: 'ready', mine: true, meetingTitle: 'Recorded tutorial' });
    expect(list.body.recordings[0].file).toBeUndefined();
    // Library posters come with poster-only tokens that cannot stream the film.
    const posterOnly = list.body.recordings[0].posterUrl;
    await request(srv.app).get(posterOnly).expect(200).expect('content-type', /image\/jpeg/);
    await request(srv.app).get(posterOnly.replace('/poster?', '/media?')).expect(401);

    expect((await request(srv.app).get('/api/recordings').set(student.auth)).body.recordings).toEqual([]);
    await request(srv.app).get(`/api/recordings/${recordingId}`).set(student.auth).expect(404);
    await request(srv.app).post(`/api/recordings/${recordingId}/playback`).set(student.auth).expect(404);

    const pb = await request(srv.app).post(`/api/recordings/${recordingId}/playback`).set(teacher.auth).expect(200);
    const head = await request(srv.app).get(pb.body.mediaUrl).set('Range', 'bytes=0-1023').expect(206);
    expect(head.headers['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
    expect(head.headers['content-type']).toBe('video/mp4');
    expect(head.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(head.body.length ?? Buffer.byteLength(head.text || '')).toBe(1024);
    const total = Number(head.headers['content-range'].split('/')[1]);
    await request(srv.app).get(pb.body.mediaUrl).set('Range', `bytes=${total + 10}-`).expect(416);
    await request(srv.app).get(pb.body.posterUrl).expect(200).expect('content-type', /image\/jpeg/);
    const dl = await request(srv.app).get(pb.body.downloadUrl).set('Range', 'bytes=0-10').expect(206);
    expect(dl.headers['content-disposition']).toMatch(/attachment; filename="Recorded tutorial \d{4}-\d{2}-\d{2}\.mp4"/);
    // tampered / wrong-recording tokens are refused
    await request(srv.app).get(pb.body.mediaUrl.replace(/token=([^&]+)/, (_m, t) => `token=${t.slice(0, -3)}abc`)).expect(401);
    await request(srv.app).get(`/api/recordings/${'0'.repeat(24)}/media?${pb.body.mediaUrl.split('?')[1]}`).expect(401);

    // The student attended, so sharing makes it visible to them — but not to outsiders.
    await request(srv.app).patch(`/api/recordings/${recordingId}`).set(student.auth).send({ shareWithParticipants: true }).expect(404);
    await request(srv.app).patch(`/api/recordings/${recordingId}`).set(teacher.auth).send({ shareWithParticipants: true, title: 'Tutorial — week 1' }).expect(200);
    const sl = await request(srv.app).get('/api/recordings').set(student.auth).expect(200);
    expect(sl.body.recordings).toHaveLength(1);
    expect(sl.body.recordings[0]).toMatchObject({ title: 'Tutorial — week 1', mine: false });
    expect(sl.body.recordings[0].meetingCode).toBeUndefined();
    const one = await request(srv.app).get(`/api/recordings/${recordingId}`).set(student.auth).expect(200);
    expect(one.body.recording.consent).toBeUndefined();
    const spb = await request(srv.app).post(`/api/recordings/${recordingId}/playback`).set(student.auth).expect(200);
    await request(srv.app).get(spb.body.mediaUrl).set('Range', 'bytes=0-99').expect(206);
    // A student who was invited but missed the class can watch a shared recording too; strangers never.
    expect((await request(srv.app).get('/api/recordings').set(invitee.auth)).body.recordings).toEqual([]);
    await Meeting.updateOne({ _id: meeting.id }, { $set: { invitees: [invitee.email] } });
    expect((await request(srv.app).get('/api/recordings').set(invitee.auth)).body.recordings).toHaveLength(1);
    expect((await request(srv.app).get('/api/recordings').set(outsider.auth)).body.recordings).toEqual([]);
    await request(srv.app).post(`/api/recordings/${recordingId}/playback`).set(outsider.auth).expect(404);

    // Un-sharing revokes outstanding student links immediately.
    await request(srv.app).patch(`/api/recordings/${recordingId}`).set(teacher.auth).send({ shareWithParticipants: false }).expect(200);
    await request(srv.app).get(spb.body.mediaUrl).set('Range', 'bytes=0-99').expect(404);

    const summary = await request(srv.app).get(`/api/meetings/${meeting.code}/summary`).set(teacher.auth).expect(200);
    expect(summary.body.recordings.map((r) => r.id)).toContain(recordingId);
  });

  it('the host can delete a recording; files are removed', async () => {
    await request(srv.app).delete(`/api/recordings/${recordingId}`).set(student.auth).expect(404);
    await request(srv.app).delete(`/api/recordings/${recordingId}`).set(teacher.auth).expect(204);
    expect(fs.existsSync(path.join(recDir, recordingId))).toBe(false);
    await request(srv.app).get(`/api/recordings/${recordingId}`).set(teacher.auth).expect(404);
    expect((await Recording.findById(recordingId)).status).toBe('deleted');
  });

  it('nothing is kept when nobody consented; ending the class stops recording; retention removes old files', async () => {
    // Student only: host leaves camera/mic paused → only the student could be captured, and they decline.
    const room = rooms.get(meeting.id);
    for (const p of room.sfu.peers.get(teacher.id).producers.values()) await p.pause();
    const r = await emitAck(sockets.host, 'recording:start');
    await emitAck(sockets.stu, 'recording:consent', { accept: false });
    await sleep(1500);
    await emitAck(sockets.host, 'recording:stop');
    const doc = await Recording.findById(r.recording.id);
    expect(doc.status).toBe('failed');
    expect(doc.error).toMatch(/Nothing was captured/);

    for (const p of room.sfu.peers.get(teacher.id).producers.values()) await p.resume();
    const r2 = await emitAck(sockets.host, 'recording:start');
    await sleep(2500);
    const done = new Promise((resolve) => {
      const off = recordingService.onProcessed((e) => e.id === r2.recording.id && (off(), resolve(e)));
    });
    const ended = once(sockets.stu, 'meeting:ended');
    await request(srv.app).post(`/api/meetings/${meeting.code}/end`).set(teacher.auth).expect(200);
    await ended;
    expect(await done).toMatchObject({ status: 'ready' });

    // Pretend it is old and run the retention sweep.
    await Recording.updateOne({ _id: r2.recording.id }, { $set: { startedAt: new Date(Date.now() - 400 * 86400_000) } });
    expect(await recordingService.retentionSweep()).toBeGreaterThanOrEqual(1);
    expect((await Recording.findById(r2.recording.id)).status).toBe('deleted');
    expect(fs.existsSync(path.join(recDir, r2.recording.id))).toBe(false);
  }, 60_000);

  it('recording is refused where it is not available', () => {
    expect(recordingService.recordingAvailability({ mode: 'p2p' })).toMatchObject({ available: false });
    expect(recordingService.safePath('../../etc/passwd')).toBeNull();
  });
});
