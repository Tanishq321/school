import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.MEDIASOUP_ENABLED = 'true';
  process.env.MEDIASOUP_NUM_WORKERS = '1';
  process.env.MEDIASOUP_LISTEN_IP = '127.0.0.1';
  process.env.MEDIASOUP_PORT_BASE = '44100';
});

const request = (await import('supertest')).default;
const { workerPool } = await import('../src/mediasoup/workerPool.js');
const { rooms } = await import('../src/sockets/realtime.js');
const { connected, createUser, emitAck, once, startTestServer } = await import('./helpers.js');

let srv, teacher, s1, s2, s3;
beforeAll(async () => {
  await workerPool.start();
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Host Teacher' });
  s1 = await createUser(srv.app, { role: 'student', name: 'Student One' });
  s2 = await createUser(srv.app, { role: 'student', name: 'Student Two' });
  s3 = await createUser(srv.app, { role: 'student', name: 'Student Three' });
});
afterAll(async () => {
  await srv.close();
  await workerPool.close();
});

const opusParams = (ssrc) => ({
  mid: '0',
  codecs: [{ mimeType: 'audio/opus', payloadType: 111, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: `c${ssrc}` },
});

let meeting;
const sockets = {};
async function joinAs(user, key) {
  const tok = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(user.auth).send({});
  if (tok.status !== 200) return { rest: tok };
  const s = srv.connect(user.accessToken);
  await connected(s);
  sockets[key] = s;
  return emitAck(s, 'meeting:join', { joinToken: tok.body.joinToken });
}
async function startMedia(s) {
  const caps = await emitAck(s, 'mediasoup:getRouterRtpCapabilities');
  const j = await emitAck(s, 'mediasoup:join', { sessionId: `sess-${Math.random().toString(36).slice(2)}`, rtpCapabilities: caps.rtpCapabilities });
  const send = await emitAck(s, 'mediasoup:createWebRtcTransport', { direction: 'send' });
  const recv = await emitAck(s, 'mediasoup:createWebRtcTransport', { direction: 'recv' });
  return { caps, join: j, send: send.transport, recv: recv.transport };
}
const media = {};
const sfuOf = () => rooms.get(meeting.id).sfu;

describe('SFU group meeting', () => {
  it('meetings run in SFU mode with group capacity', async () => {
    const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Group class', waitingRoom: true });
    meeting = res.body.meeting;
    expect(meeting.mediaMode).toBe('sfu');
    expect(meeting.effectiveMaxParticipants).toBe(20);
    const h = await joinAs(teacher, 'host');
    expect(h.meeting.mediaMode).toBe('sfu');
    const cfg = await request(srv.app).get('/api/config');
    expect(cfg.body).toMatchObject({ mediaMode: 'sfu', maxParticipantsNow: 20 });
    const health = await request(srv.app).get('/api/health');
    expect(health.body).toMatchObject({ mediaMode: 'sfu', mediasoupWorkers: 1 });
  });

  it('host admits everyone at once; more than two people can be in the room', async () => {
    await joinAs(s1, 's1');
    await joinAs(s2, 's2');
    const notice = once(sockets.s2, 'meeting:admitted');
    const r = await emitAck(sockets.host, 'waiting:admitAll');
    expect(r).toMatchObject({ ok: true, admitted: 2 });
    const a = await notice;
    expect(a.participants).toHaveLength(2);
  });

  it('rejects media operations from non-members and validates ownership of ids', async () => {
    const outsider = srv.connect(s3.accessToken);
    await connected(outsider);
    const r = await emitAck(outsider, 'mediasoup:getRouterRtpCapabilities');
    expect(r.error.code).toBe('not_in_meeting');

    media.host = await startMedia(sockets.host);
    media.s1 = await startMedia(sockets.s1);
    media.s2 = await startMedia(sockets.s2);
    expect(media.host.send.iceCandidates[0]).toMatchObject({ ip: '127.0.0.1', port: 44100 });

    const dup = await emitAck(sockets.host, 'mediasoup:createWebRtcTransport', { direction: 'send' });
    expect(dup.error.code).toBe('transport_exists');
    // A student cannot use the host's transport id.
    const steal = await emitAck(sockets.s1, 'mediasoup:produce', { transportId: media.host.send.id, kind: 'audio', source: 'mic', rtpParameters: opusParams(1) });
    expect(steal.ok).toBe(false);
    const wrongKind = await emitAck(sockets.s1, 'mediasoup:produce', { transportId: media.s1.send.id, kind: 'video', source: 'mic', rtpParameters: opusParams(2) });
    expect(wrongKind.ok).toBe(false);
  });

  it('a new producer is announced to others, who can consume and resume it', async () => {
    const announced = once(sockets.s2, 'mediasoup:newProducer');
    const p = await emitAck(sockets.s1, 'mediasoup:produce', { transportId: media.s1.send.id, kind: 'audio', source: 'mic', rtpParameters: opusParams(1111) });
    expect(p.error).toBeUndefined();
    media.s1.micId = p.id;
    const ann = await announced;
    expect(ann).toMatchObject({ producerId: p.id, userId: s1.id, kind: 'audio', source: 'mic' });

    const c = await emitAck(sockets.s2, 'mediasoup:consume', { producerId: p.id });
    expect(c.ok).toBe(true);
    expect(c.consumer).toMatchObject({ producerId: p.id, kind: 'audio', userId: s1.id });
    expect((await emitAck(sockets.s2, 'mediasoup:resumeConsumer', { consumerId: c.consumer.id })).ok).toBe(true);
    const again = await emitAck(sockets.s2, 'mediasoup:consume', { producerId: p.id });
    expect(again.error.code).toBe('already_consuming');
    // A late joiner's media join lists existing producers.
    const caps = await emitAck(sockets.host, 'mediasoup:getRouterRtpCapabilities');
    const rejoin = await emitAck(sockets.host, 'mediasoup:join', { sessionId: 'sess-host-2', rtpCapabilities: caps.rtpCapabilities });
    expect(rejoin.resumed).toBe(false);
    expect(rejoin.producers.map((x) => x.producerId)).toContain(p.id);
  });

  it('host mute pauses the student’s mic on the server; mute-all reaches everyone', async () => {
    const muted = once(sockets.s1, 'participant:mutedByHost');
    expect((await emitAck(sockets.host, 'host:mute', { userId: s1.id })).ok).toBe(true);
    await muted;
    expect(sfuOf().findProducer(s1.id, 'mic').paused).toBe(true);
    // Self-unmute is allowed by default.
    expect((await emitAck(sockets.s1, 'mediasoup:resumeProducer', { producerId: media.s1.micId })).ok).toBe(true);
    const m2 = once(sockets.s2, 'participant:mutedByHost');
    await emitAck(sockets.host, 'host:muteAll');
    await m2;
    expect(sfuOf().findProducer(s1.id, 'mic').paused).toBe(true);
    const notHost = await emitAck(sockets.s1, 'host:mute', { userId: s2.id });
    expect(notHost.error.code).toBe('not_host');
  });

  it('with self-unmute off, students stay muted until the host lets them speak', async () => {
    const perm = once(sockets.s1, 'meeting:permissions');
    await emitAck(sockets.host, 'host:permissions', { allowSelfUnmute: false });
    expect(await perm).toEqual({ allowSelfUnmute: false });
    const denied = await emitAck(sockets.s1, 'mediasoup:resumeProducer', { producerId: media.s1.micId });
    expect(denied.error.code).toBe('unmute_not_allowed');

    const hand = once(sockets.host, 'participant:updated');
    await emitAck(sockets.s1, 'participant:raiseHand', { raised: true });
    expect(await hand).toMatchObject({ userId: s1.id, handRaised: true, canSpeak: false });

    const granted = once(sockets.s1, 'participant:speakPermission');
    await emitAck(sockets.host, 'host:grantSpeak', { userId: s1.id, granted: true });
    expect(await granted).toEqual({ canSpeak: true });
    expect((await emitAck(sockets.s1, 'mediasoup:resumeProducer', { producerId: media.s1.micId })).ok).toBe(true);
    expect(sfuOf().findProducer(s1.id, 'mic').paused).toBe(false);
    // Producing a fresh mic while not allowed is forced into the paused state.
    const p2 = await emitAck(sockets.s2, 'mediasoup:produce', { transportId: media.s2.send.id, kind: 'audio', source: 'mic', rtpParameters: opusParams(2222) });
    expect(p2.paused).toBe(true);
    await emitAck(sockets.host, 'host:permissions', { allowSelfUnmute: true });
  });

  it('locking blocks newcomers but not people already in the class', async () => {
    const lockEvt = once(sockets.s1, 'meeting:locked');
    await emitAck(sockets.host, 'host:lock', { locked: true });
    expect(await lockEvt).toEqual({ locked: true });
    const newcomer = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(s3.auth).send({});
    expect(newcomer.status).toBe(423);
    expect(newcomer.body.error.code).toBe('meeting_locked');
    const returning = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(s1.auth).send({});
    expect(returning.status).toBe(200);
    await emitAck(sockets.host, 'host:lock', { locked: false });
  });

  it('removing a participant closes their media, ends their session and bars rejoining', async () => {
    const removed = once(sockets.s1, 'meeting:removed');
    const left = once(sockets.s2, 'participant:left');
    const closed = once(sockets.s2, 'mediasoup:consumerClosed');
    expect((await emitAck(sockets.host, 'host:remove', { userId: s1.id })).ok).toBe(true);
    await removed;
    expect(await left).toEqual({ userId: s1.id, reason: 'removed' });
    expect((await closed).producerId).toBe(media.s1.micId);
    expect(sfuOf().peers.has(s1.id)).toBe(false);
    const rejoin = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(s1.auth).send({});
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe('removed_from_meeting');
    const cantRemoveHost = await emitAck(sockets.host, 'host:remove', { userId: teacher.id });
    expect(cantRemoveHost.ok).toBe(false);
  });

  it('ending the meeting closes the router', async () => {
    const sfu = sfuOf();
    await emitAck(sockets.host, 'meeting:end');
    expect(sfu.router.closed).toBe(true);
    expect(workerPool.status()[0].rooms).toBe(0);
  });
});
