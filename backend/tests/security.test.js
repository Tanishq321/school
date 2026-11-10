import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.LOGIN_MAX_FAILURES = '3';
  process.env.LOGIN_LOCK_MINUTES = '10';
  process.env.METRICS_TOKEN = 'metrics-token-0123456789abcdef';
  process.env.NATIVE_APP_ORIGINS = 'capacitor://localhost';
});

const request = (await import('supertest')).default;
const User = (await import('../src/models/User.js')).default;
const AuditLog = (await import('../src/models/AuditLog.js')).default;
const totp = await import('../src/services/totp.js');
const { hashPassword } = await import('../src/services/authService.js');
const { connected, createUser, emitAck, sleep, startTestServer } = await import('./helpers.js');

let srv, teacher, student, admin;
const login = (u, password = u.password) => request(srv.app).post('/api/auth/login').send({ email: u.email, password });
const cookieOf = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('vp_rt='))?.split(';')[0];

beforeAll(async () => {
  srv = await startTestServer();
  teacher = await createUser(srv.app, { role: 'teacher', name: 'Vera Teacher' });
  student = await createUser(srv.app, { role: 'student', name: 'Otto Student' });
  await User.create({ name: 'Root Admin', email: 'root@example.test', role: 'admin', emailVerified: true, passwordHash: await hashPassword('AdminPassw0rd!') });
  const res = await request(srv.app).post('/api/auth/login').send({ email: 'root@example.test', password: 'AdminPassw0rd!' }).expect(200);
  admin = { id: res.body.user.id, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
});
afterAll(async () => srv.close());

describe('RFC 6238 codes', () => {
  it('matches the RFC test vector and survives base32 round trips', () => {
    const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
    expect(totp.codeAt(secret, Math.floor(59 / 30))).toBe('287082'); // RFC 6238 Appendix B, T=59s (last 6 digits)
    expect(totp.base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totp.unseal(totp.seal(secret))).toBe(secret);
    expect(totp.verifyCode(secret, '287082', { now: 59_000 })).toBe(1);
    expect(totp.verifyCode(secret, '287082', { now: 59_000, lastStep: 1 })).toBeNull(); // replay
    expect(totp.verifyCode(secret, '000000', { now: 59_000 })).toBeNull();
  });
});

describe('sign-in lockout', () => {
  it('locks after repeated failures, even for the right password, and password reset clears it', async () => {
    const u = await createUser(srv.app, { role: 'student', name: 'Lock Me' });
    for (let i = 0; i < 3; i += 1) await login(u, 'wrong-password').expect(401);
    const locked = await login(u).expect(423);
    expect(locked.body.error.code).toBe('account_locked');
    expect(await AuditLog.countDocuments({ action: 'auth.account_locked', actor: u.id })).toBe(1);
    // an admin can unlock
    await request(srv.app).patch(`/api/admin/users/${u.id}`).set(admin.auth).send({ unlock: true }).expect(200);
    await login(u).expect(200);
    // unknown emails get the same generic answer and never "lock"
    for (let i = 0; i < 5; i += 1) await request(srv.app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'x' }).expect(401);
  });
});

describe('two-step sign-in', () => {
  let secret, recovery, cookie;
  it('enrols with an authenticator code and returns recovery codes once', async () => {
    const setup = await request(srv.app).post('/api/auth/2fa/setup').set(teacher.auth).expect(200);
    secret = setup.body.secret;
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]{32}&issuer=/);
    await request(srv.app).post('/api/auth/2fa/enable').set(teacher.auth).send({ code: '000000' }).expect(400);
    const on = await request(srv.app).post('/api/auth/2fa/enable').set(teacher.auth).send({ code: totp.codeAt(secret, totp.currentStep()) }).expect(200);
    recovery = on.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    const me = await request(srv.app).get('/api/auth/me').set(teacher.auth).expect(200);
    expect(me.body.user.twoFactor.enabled).toBe(true);
    expect(JSON.stringify(me.body)).not.toContain(secret);
    const raw = await User.findById(teacher.id).select('+twoFactor.secret +twoFactor.recoveryHashes').lean();
    expect(raw.twoFactor.secret).toMatch(/^v1\./); // sealed, not plain
    expect(raw.twoFactor.recoveryHashes[0]).toHaveLength(64);
  });

  it('password alone no longer signs in; the code does; a used code cannot be replayed', async () => {
    const first = await login(teacher).expect(200);
    expect(first.body).toMatchObject({ twoFactorRequired: true });
    expect(first.body.accessToken).toBeUndefined();
    expect(cookieOf(first)).toBeUndefined();
    await request(srv.app).post('/api/auth/login/2fa').send({ challenge: first.body.challenge, code: '123456' }).expect(401);
    const code = totp.codeAt(secret, totp.currentStep() + 1); // next step: valid (drift window), unused
    const ok = await request(srv.app).post('/api/auth/login/2fa').send({ challenge: first.body.challenge, code }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    cookie = cookieOf(ok);
    expect(cookie).toBeTruthy();
    const again = await login(teacher).expect(200);
    await request(srv.app).post('/api/auth/login/2fa').send({ challenge: again.body.challenge, code }).expect(401);
    await request(srv.app).post('/api/auth/login/2fa').send({ challenge: 'x'.repeat(40), code }).expect(401);
  });

  it('a recovery code works once', async () => {
    const a = await login(teacher).expect(200);
    const ok = await request(srv.app).post('/api/auth/login/2fa').send({ challenge: a.body.challenge, code: recovery[0].toUpperCase() }).expect(200);
    expect(ok.body.recoveryCodesLeft).toBe(9);
    const b = await login(teacher).expect(200);
    await request(srv.app).post('/api/auth/login/2fa').send({ challenge: b.body.challenge, code: recovery[0] }).expect(401);
    await request(srv.app).patch(`/api/admin/users/${teacher.id}`).set(admin.auth).send({ unlock: true });
  });

  it('turning it off needs the password and a code', async () => {
    await request(srv.app).post('/api/auth/2fa/disable').set(teacher.auth).send({ password: 'nope', code: recovery[1] }).expect(403);
    await request(srv.app).post('/api/auth/2fa/disable').set(teacher.auth).send({ password: teacher.password, code: recovery[1] }).expect(200);
    const plain = await login(teacher).expect(200);
    expect(plain.body.accessToken).toBeTruthy();
  });
});

describe('devices and password', () => {
  it('lists signed-in devices, signs one out, and changing the password signs out the rest', async () => {
    const a = await login(student).expect(200);
    const b = await request(srv.app).post('/api/auth/login').set('User-Agent', 'Phone/1.0').send({ email: student.email, password: student.password }).expect(200);
    const auth = { Authorization: `Bearer ${a.body.accessToken}` };
    const list = await request(srv.app).post('/api/auth/sessions/list').set(auth).set('Cookie', cookieOf(a)).expect(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(3); // registration + two sign-ins
    expect(list.body.sessions.filter((s) => s.current)).toHaveLength(1);
    const phone = list.body.sessions.find((s) => s.userAgent === 'Phone/1.0');
    await request(srv.app).delete(`/api/auth/sessions/${phone.id}`).set(auth).expect(204);
    await request(srv.app).post('/api/auth/refresh').set('Cookie', cookieOf(b)).expect(401);
    // someone else cannot revoke my device
    const mine = list.body.sessions.find((s) => s.current);
    await request(srv.app).delete(`/api/auth/sessions/${mine.id}`).set(teacher.auth).expect(404);

    await request(srv.app).post('/api/auth/change-password').set(auth).set('Cookie', cookieOf(a)).send({ currentPassword: 'wrong', newPassword: 'N3wPassword!' }).expect(403);
    await sleep(1100); // tokens are dated to the second
    const changed = await request(srv.app).post('/api/auth/change-password').set(auth).set('Cookie', cookieOf(a)).send({ currentPassword: student.password, newPassword: 'N3wPassword!' }).expect(200);
    expect(changed.body.signedOut).toBeGreaterThanOrEqual(1);
    await request(srv.app).get('/api/auth/me').set(student.auth).expect(401); // old access token is dead
    await request(srv.app).get('/api/auth/me').set({ Authorization: `Bearer ${changed.body.accessToken}` }).expect(200);
    await request(srv.app).post('/api/auth/refresh').set('Cookie', cookieOf(a)).expect(200); // this device stays in
    student.password = 'N3wPassword!';
    student.auth = { Authorization: `Bearer ${changed.body.accessToken}` };
    student.accessToken = changed.body.accessToken;
  });

  it('native apps receive the refresh token in the body instead of a cookie', async () => {
    const native = { 'X-Client-Platform': 'native', Origin: 'capacitor://localhost' };
    const res = await request(srv.app).post('/api/auth/login').set(native).send({ email: student.email, password: student.password }).expect(200);
    expect(res.body.refreshToken).toBeTruthy();
    expect(cookieOf(res)).toBeUndefined();
    expect(res.headers['access-control-allow-origin']).toBe('capacitor://localhost');
    const r = await request(srv.app).post('/api/auth/refresh').set(native).send({ refreshToken: res.body.refreshToken }).expect(200);
    expect(r.body.refreshToken).not.toBe(res.body.refreshToken);
    await request(srv.app).post('/api/auth/refresh').set(native).send({ refreshToken: res.body.refreshToken }).expect(401); // rotated
    // a browser cannot use the body route
    await request(srv.app).post('/api/auth/refresh').send({ refreshToken: r.body.refreshToken }).expect(401);
    await request(srv.app).post('/api/auth/refresh').set({ Origin: 'https://evil.example' }).expect(403);
  });
});

describe('administration', () => {
  it('is closed to everyone but administrators', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/users', '/api/admin/classes', '/api/admin/audit']) {
      await request(srv.app).get(path).expect(401);
      await request(srv.app).get(path).set(teacher.auth).expect(403);
    }
  });

  it('overview reports people, classes and system health without class content', async () => {
    const m = await request(srv.app).post('/api/meetings').set(teacher.auth).send({ type: 'instant', title: 'Confidential tutorial' }).expect(201);
    const tok = await request(srv.app).post(`/api/meetings/${m.body.meeting.code}/join`).set(teacher.auth).send({});
    const s = srv.connect(teacher.accessToken);
    await connected(s);
    await emitAck(s, 'meeting:join', { joinToken: tok.body.joinToken });
    const o = await request(srv.app).get('/api/admin/overview').set(admin.auth).expect(200);
    expect(o.body.people).toMatchObject({ admins: 1 });
    expect(o.body.people.teachers).toBeGreaterThanOrEqual(1);
    expect(o.body.classes.live).toBe(1);
    expect(o.body.live[0]).toMatchObject({ teacher: 'Vera Teacher', people: 1 });
    expect(o.body.system).toMatchObject({ db: 'up', mediaMode: 'p2p' });
    expect(o.body.series.signups).toHaveLength(14);
    expect(JSON.stringify(o.body)).not.toContain('Confidential tutorial');
    expect(JSON.stringify(o.body)).not.toContain(m.body.meeting.code);

    const classes = await request(srv.app).get('/api/admin/classes?status=live').set(admin.auth).expect(200);
    expect(classes.body.classes[0]).toMatchObject({ status: 'live', inRoom: 1, teacher: { name: 'Vera Teacher' } });
    expect(JSON.stringify(classes.body)).not.toContain('Confidential tutorial');
    // admins have no route into class content
    await request(srv.app).get(`/api/meetings/${m.body.meeting.code}/summary`).set(admin.auth).expect(403);

    const ended = new Promise((r) => s.once('meeting:ended', r));
    await request(srv.app).post(`/api/admin/classes/${classes.body.classes[0].id}/end`).set(admin.auth).expect(204);
    expect(await ended).toMatchObject({ reason: 'admin' });
  });

  it('finds, suspends and restores accounts; suspension takes effect at once', async () => {
    const found = await request(srv.app).get('/api/admin/users').query({ q: 'otto', role: 'student' }).set(admin.auth).expect(200);
    expect(found.body.users).toHaveLength(1);
    expect(found.body.users[0]).toMatchObject({ name: 'Otto Student', status: 'active' });
    expect(found.body.users[0].passwordHash).toBeUndefined();
    await request(srv.app).get('/api/admin/users').query({ q: '(.*' }).set(admin.auth).expect(200); // regex-safe

    const live = srv.connect(student.accessToken);
    await connected(live);
    const dropped = new Promise((r) => live.once('disconnect', r));
    await request(srv.app).patch(`/api/admin/users/${student.id}`).set(admin.auth).send({ status: 'suspended' }).expect(200);
    await dropped;
    await request(srv.app).get('/api/auth/me').set(student.auth).expect(403);
    await login(student).expect(403);
    await request(srv.app).patch(`/api/admin/users/${student.id}`).set(admin.auth).send({ status: 'active' }).expect(200);
    await login(student).expect(200);

    await request(srv.app).patch(`/api/admin/users/${admin.id}`).set(admin.auth).send({ status: 'suspended' }).expect(400);
    await request(srv.app).patch(`/api/admin/users/${admin.id}`).set(admin.auth).send({ role: 'teacher' }).expect(400);
    await request(srv.app).patch(`/api/admin/users/${student.id}`).set(admin.auth).send({ role: 'owner' }).expect(400);
  });

  it('force sign-out kills tokens; the audit trail records administrator actions', async () => {
    const fresh = await login(teacher).expect(200);
    await sleep(1100);
    await request(srv.app).post(`/api/admin/users/${teacher.id}/sign-out`).set(admin.auth).expect(204);
    await request(srv.app).get('/api/auth/me').set({ Authorization: `Bearer ${fresh.body.accessToken}` }).expect(401);
    await request(srv.app).post('/api/auth/refresh').set('Cookie', cookieOf(fresh)).expect(401);
    await sleep(150);
    const logs = await request(srv.app).get('/api/admin/audit').query({ action: 'admin.' }).set(admin.auth).expect(200);
    const actions = logs.body.logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.user_update', 'admin.user_sign_out', 'admin.class_end']));
    expect(logs.body.logs[0].actor).toMatchObject({ name: 'Root Admin', role: 'admin' });
    const failed = await request(srv.app).get('/api/admin/audit').query({ action: 'auth.login_failed' }).set(admin.auth).expect(200);
    expect(failed.body.total).toBeGreaterThanOrEqual(3);
  });
});

describe('monitoring', () => {
  it('serves Prometheus metrics only with the token', async () => {
    await request(srv.app).get('/metrics').expect(404);
    await request(srv.app).get('/metrics').set('Authorization', 'Bearer wrong').expect(404);
    const res = await request(srv.app).get('/metrics').set('Authorization', 'Bearer metrics-token-0123456789abcdef').expect(200);
    expect(res.text).toMatch(/schole_up 1/);
    expect(res.text).toMatch(/schole_db_up 1/);
    expect(res.text).toMatch(/schole_http_request_duration_seconds_count\{method="POST",route="auth",status="2xx"\} \d+/);
    expect(res.text).not.toMatch(/@example\.test/);
  });
});
