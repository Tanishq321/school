import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.MEDIASOUP_ENABLED = 'true';
  process.env.MEDIASOUP_NUM_WORKERS = '1';
  process.env.MEDIASOUP_LISTEN_IP = '127.0.0.1';
  process.env.MEDIASOUP_PORT_BASE = '44150';
});

const request = (await import('supertest')).default;
const { workerPool } = await import('../src/mediasoup/workerPool.js');
const { rooms } = await import('../src/sockets/realtime.js');
const ChatMessage = (await import('../src/models/ChatMessage.js')).default;
const Whiteboard = (await import('../src/models/Whiteboard.js')).default;
const { connected, createUser, emitAck, once, sleep, startTestServer } = await import('./helpers.js');

let srv, teacher, s1, meeting;
const sock = {};

beforeAll(async () => {
  await workerPool.start();
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Prof Rao' });
  s1 = await createUser(srv.app, { role: 'student', name: 'Ira' });
  const res = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Seminar', waitingRoom: false });
  meeting = res.body.meeting;
  for (const [key, u] of [['host', teacher], ['s1', s1]]) {
    const tok = await request(srv.app).post(`/api/meetings/${meeting.code}/join`).set(u.auth).send({});
    const s = srv.connect(u.accessToken);
    await connected(s);
    sock[key] = s;
    const r = await emitAck(s, 'meeting:join', { joinToken: tok.body.joinToken });
    expect(r.status).toBe('admitted');
  }
});
afterAll(async () => {
  await srv.close();
  await workerPool.close();
});

/** Resolve on the first `event` whose payload satisfies `pred` (ignores stale events). */
const until = (socket, event, pred, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, h);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    const h = (data) => {
      if (!pred(data)) return;
      clearTimeout(t);
      socket.off(event, h);
      resolve(data);
    };
    socket.on(event, h);
  });

const stroke = (id, extra = {}) => ({ id, tool: 'pen', color: '#1b253d', size: 4, points: [[0.1, 0.1], [0.2, 0.25], [0.3, 0.3]], ...extra });

describe('chat', () => {
  it('broadcasts messages with sender info and persists them', async () => {
    const got = once(sock.host, 'chat:message');
    const r = await emitAck(sock.s1, 'chat:send', { text: '  Is question 3 about limits?  ' });
    expect(r.ok).toBe(true);
    const m = await got;
    expect(m).toMatchObject({ userId: s1.id, name: 'Ira', isHost: false, text: 'Is question 3 about limits?' });
    expect(await ChatMessage.countDocuments({ meeting: meeting.id })).toBe(1);
  });

  it('keeps markup as plain text and rejects empty or oversized messages', async () => {
    const got = once(sock.host, 'chat:message');
    await emitAck(sock.s1, 'chat:send', { text: '<img src=x onerror=alert(1)>' });
    expect((await got).text).toBe('<img src=x onerror=alert(1)>'); // stored verbatim, rendered as text by the client
    expect((await emitAck(sock.s1, 'chat:send', { text: '   ' })).error.code).toBe('empty_message');
    expect((await emitAck(sock.s1, 'chat:send', { text: 'x'.repeat(2001) })).ok).toBe(false);
  });

  it('serves history (e.g. after a reconnect) and lets the host delete a message', async () => {
    const h = await emitAck(sock.s1, 'chat:history');
    expect(h.messages.map((m) => m.text)).toEqual(['Is question 3 about limits?', '<img src=x onerror=alert(1)>']);
    const target = h.messages[1].id;
    expect((await emitAck(sock.s1, 'chat:delete', { id: target })).error.code).toBe('not_host');
    const deleted = once(sock.s1, 'chat:deleted');
    expect((await emitAck(sock.host, 'chat:delete', { id: target })).ok).toBe(true);
    expect(await deleted).toEqual({ id: target });
    expect((await ChatMessage.findById(target)).deletedAt).toBeTruthy();
    expect((await emitAck(sock.s1, 'chat:history')).messages).toHaveLength(1);
  });

  it('host can limit chat to themselves', async () => {
    await emitAck(sock.host, 'host:permissions', { chatMode: 'host' });
    expect((await emitAck(sock.s1, 'chat:send', { text: 'hello?' })).error.code).toBe('chat_disabled');
    expect((await emitAck(sock.host, 'chat:send', { text: 'Quiet please.' })).ok).toBe(true);
    await emitAck(sock.host, 'host:permissions', { chatMode: 'everyone' });
  });

  it('rate-limits floods', async () => {
    const results = [];
    for (let i = 0; i < 14; i += 1) results.push(await emitAck(sock.s1, 'chat:send', { text: `spam ${i}` }));
    expect(results.some((r) => r.error?.code === 'rate_limited')).toBe(true);
  });
});

describe('whiteboard', () => {
  it('only the host opens the board; everyone is told', async () => {
    expect((await emitAck(sock.s1, 'whiteboard:open', { open: true })).error.code).toBe('not_host');
    const opened = once(sock.s1, 'whiteboard:opened');
    await emitAck(sock.host, 'whiteboard:open', { open: true });
    expect(await opened).toEqual({ open: true });
  });

  it('students cannot draw until the host allows it', async () => {
    expect((await emitAck(sock.s1, 'whiteboard:draw', { op: stroke('s1-stroke-1') })).error.code).toBe('drawing_disabled');
    const drawn = once(sock.s1, 'whiteboard:draw');
    expect((await emitAck(sock.host, 'whiteboard:draw', { op: stroke('host-stroke-1') })).ok).toBe(true);
    expect((await drawn).op).toMatchObject({ id: 'host-stroke-1', author: teacher.id });
    await emitAck(sock.host, 'host:permissions', { allowDrawing: true });
    expect((await emitAck(sock.s1, 'whiteboard:draw', { op: stroke('s1-stroke-1', { tool: 'rect', points: [[0.5, 0.5], [0.7, 0.6]] }) })).ok).toBe(true);
  });

  it('validates operations strictly', async () => {
    const bad = [
      stroke('bad-coords', { points: [[1.5, 0.2]] }),
      stroke('bad-color', { color: 'red' }),
      stroke('bad-tool', { tool: 'flamethrower' }),
      stroke('bad-shape', { tool: 'line', points: [[0, 0]] }),
      { ...stroke('bad-extra'), onclick: 'x' },
      stroke('bad-text', { tool: 'text', text: '' }),
    ];
    for (const op of bad) expect((await emitAck(sock.host, 'whiteboard:draw', { op })).ok).toBe(false);
    expect((await emitAck(sock.host, 'whiteboard:draw', { op: stroke('host-stroke-1') })).error.code).toBe('duplicate_op');
  });

  it('relays live strokes without storing them', async () => {
    const live = once(sock.host, 'whiteboard:live');
    await emitAck(sock.s1, 'whiteboard:live', { id: 'live-1234', tool: 'pen', color: '#000000', size: 3, points: [[0.4, 0.4]] });
    expect(await live).toMatchObject({ id: 'live-1234', author: s1.id });
    const state = await emitAck(sock.host, 'whiteboard:state');
    expect(state.ops.some((o) => o.id === 'live-1234')).toBe(false);
  });

  it('erase (undo) is limited to the author or the host', async () => {
    expect((await emitAck(sock.s1, 'whiteboard:erase', { id: 'host-stroke-1' })).error.code).toBe('not_author');
    const erased = once(sock.host, 'whiteboard:erased');
    expect((await emitAck(sock.s1, 'whiteboard:erase', { id: 's1-stroke-1' })).ok).toBe(true);
    expect(await erased).toEqual({ id: 's1-stroke-1' });
    // Redo = re-send the same op.
    expect((await emitAck(sock.s1, 'whiteboard:draw', { op: stroke('s1-stroke-1') })).ok).toBe(true);
  });

  it('persists the board and lets only the host clear it', async () => {
    await sleep(1700);
    const doc = await Whiteboard.findOne({ meeting: meeting.id }).lean();
    expect(doc.ops.map((o) => o.id).sort()).toEqual(['host-stroke-1', 's1-stroke-1']);
    expect(doc.ops.find((o) => o.id === 'host-stroke-1').flat).toEqual([0.1, 0.1, 0.2, 0.25, 0.3, 0.3]);
    expect((await emitAck(sock.s1, 'whiteboard:clear')).error.code).toBe('not_host');
    const cleared = once(sock.s1, 'whiteboard:cleared');
    await emitAck(sock.host, 'whiteboard:clear');
    await cleared;
    expect((await emitAck(sock.s1, 'whiteboard:state')).ops).toEqual([]);
  });
});

describe('screen sharing', () => {
  it('the student needs permission; one person shares at a time; the teacher can take over', async () => {
    expect((await emitAck(sock.s1, 'screen:start')).error.code).toBe('screen_not_allowed');
    await emitAck(sock.host, 'host:permissions', { allowScreenShare: true });
    const state = once(sock.host, 'screen:state');
    expect((await emitAck(sock.s1, 'screen:start')).ok).toBe(true);
    expect(await state).toEqual({ userId: s1.id });

    const forced = once(sock.s1, 'screen:forceStop');
    expect((await emitAck(sock.host, 'screen:start')).ok).toBe(true);
    await forced;
    expect(rooms.get(meeting.id).screenSharer).toBe(teacher.id);
    // The student cannot take the slot back from the teacher.
    expect((await emitAck(sock.s1, 'screen:start')).error.code).toBe('screen_busy');
    await emitAck(sock.host, 'screen:stop');
    expect(rooms.get(meeting.id).screenSharer).toBe(null);
  });

  it('the SFU only accepts a screen producer from the person holding the slot', async () => {
    const hostCaps = await emitAck(sock.host, 'mediasoup:getRouterRtpCapabilities');
    await emitAck(sock.host, 'mediasoup:join', { sessionId: 'sess-host-screen', rtpCapabilities: hostCaps.rtpCapabilities });
    const caps = await emitAck(sock.s1, 'mediasoup:getRouterRtpCapabilities');
    await emitAck(sock.s1, 'mediasoup:join', { sessionId: 'sess-s1-screen', rtpCapabilities: caps.rtpCapabilities });
    const send = (await emitAck(sock.s1, 'mediasoup:createWebRtcTransport', { direction: 'send' })).transport;
    const vp8 = {
      mid: '2',
      codecs: [{ mimeType: 'video/VP8', payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
      headerExtensions: [],
      encodings: [{ ssrc: 5555 }],
      rtcp: { cname: 'scr' },
    };
    const denied = await emitAck(sock.s1, 'mediasoup:produce', { transportId: send.id, kind: 'video', source: 'screen', rtpParameters: vp8 });
    expect(denied.error.code).toBe('screen_not_claimed');
    await emitAck(sock.s1, 'screen:start');
    const announced = once(sock.host, 'mediasoup:newProducer');
    const ok = await emitAck(sock.s1, 'mediasoup:produce', { transportId: send.id, kind: 'video', source: 'screen', rtpParameters: vp8 });
    expect(ok.ok).toBe(true);
    expect((await announced).source).toBe('screen');

    // Revoking permission ends a student's share and closes the producer.
    const forced = once(sock.s1, 'screen:forceStop');
    await emitAck(sock.host, 'host:permissions', { allowScreenShare: false });
    await forced;
    expect(rooms.get(meeting.id).sfu.findProducer(s1.id, 'screen')).toBeUndefined();
  });

  it('a leaving sharer frees the slot', async () => {
    const started = until(sock.s1, 'screen:state', (d) => d.userId === teacher.id);
    await emitAck(sock.host, 'screen:start');
    await started;
    const st = until(sock.s1, 'screen:state', (d) => d.userId === null);
    await emitAck(sock.host, 'meeting:leave');
    expect(await st).toEqual({ userId: null });
    expect(rooms.get(meeting.id).screenSharer).toBe(null);
  });
});
