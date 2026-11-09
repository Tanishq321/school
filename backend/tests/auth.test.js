import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { startTestServer, uniqueEmail, lastLinkToken } from './helpers.js';

let srv;
beforeAll(async () => {
  srv = await startTestServer();
});
afterAll(async () => srv.close());

const cookieFrom = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('vp_rt='))?.split(';')[0];

describe('registration & login', () => {
  const email = uniqueEmail('teacher');
  const password = 'Teach1ngRocks';

  it('registers a teacher, returns an access token and an httpOnly refresh cookie', async () => {
    const res = await request(srv.app).post('/api/auth/register').send({ name: 'Ada', email, password, role: 'teacher' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email, role: 'teacher', emailVerified: false });
    expect(res.body.user.passwordHash).toBeUndefined();
    const raw = res.headers['set-cookie'].find((c) => c.startsWith('vp_rt='));
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Strict/);
    expect(raw).toMatch(/Path=\/api\/auth/);
  });

  it('rejects duplicate emails, weak passwords, admin self-registration and bad emails', async () => {
    await request(srv.app).post('/api/auth/register').send({ name: 'X', email, password, role: 'teacher' }).expect(409);
    await request(srv.app).post('/api/auth/register').send({ name: 'X', email: uniqueEmail(), password: 'short', role: 'student' }).expect(400);
    await request(srv.app).post('/api/auth/register').send({ name: 'X', email: uniqueEmail(), password: 'onlyletters', role: 'student' }).expect(400);
    await request(srv.app).post('/api/auth/register').send({ name: 'X', email: uniqueEmail(), password, role: 'admin' }).expect(400);
    await request(srv.app).post('/api/auth/register').send({ name: 'X', email: 'nope', password, role: 'student' }).expect(400);
  });

  it('logs in with correct credentials only (generic error otherwise)', async () => {
    const bad = await request(srv.app).post('/api/auth/login').send({ email, password: 'Wrong1234' });
    expect(bad.status).toBe(401);
    const missing = await request(srv.app).post('/api/auth/login').send({ email: uniqueEmail(), password: 'Wrong1234' });
    expect(missing.status).toBe(401);
    expect(missing.body.error.message).toBe(bad.body.error.message);
    const ok = await request(srv.app).post('/api/auth/login').send({ email: email.toUpperCase(), password });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe(email);
  });

  it('protects /me', async () => {
    await request(srv.app).get('/api/auth/me').expect(401);
    await request(srv.app).get('/api/auth/me').set('Authorization', 'Bearer garbage').expect(401);
    const login = await request(srv.app).post('/api/auth/login').send({ email, password });
    const me = await request(srv.app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.teacherProfile).toBeDefined();
  });
});

describe('refresh token rotation', () => {
  it('rotates, detects reuse and revokes the whole family', async () => {
    const email = uniqueEmail();
    const reg = await request(srv.app).post('/api/auth/register').send({ name: 'R', email, password: 'Refresh123', role: 'student' });
    const c1 = cookieFrom(reg);

    const r1 = await request(srv.app).post('/api/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const c2 = cookieFrom(r1);
    expect(c2).not.toBe(c1);

    const reuse = await request(srv.app).post('/api/auth/refresh').set('Cookie', c1);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('refresh_token_reused');

    const afterTheft = await request(srv.app).post('/api/auth/refresh').set('Cookie', c2);
    expect(afterTheft.status).toBe(401);
  });

  it('refuses refresh from a foreign origin and handles logout', async () => {
    const reg = await request(srv.app).post('/api/auth/register').send({ name: 'L', email: uniqueEmail(), password: 'Logout123', role: 'student' });
    const c = cookieFrom(reg);
    await request(srv.app).post('/api/auth/refresh').set('Cookie', c).set('Origin', 'https://evil.example').expect(403);
    await request(srv.app).post('/api/auth/logout').set('Cookie', c).expect(204);
    await request(srv.app).post('/api/auth/refresh').set('Cookie', c).expect(401);
    await request(srv.app).post('/api/auth/refresh').expect(401);
  });
});

describe('email verification & password reset', () => {
  it('verifies email with a one-time token', async () => {
    const email = uniqueEmail();
    await request(srv.app).post('/api/auth/register').send({ name: 'V', email, password: 'Verify1234', role: 'student' });
    const token = lastLinkToken(email, 'verify-email');
    const res = await request(srv.app).post('/api/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.user.emailVerified).toBe(true);
    await request(srv.app).post('/api/auth/verify-email').send({ token }).expect(400); // single use
  });

  it('resets a password, revokes sessions, and does not reveal unknown emails', async () => {
    const email = uniqueEmail();
    const reg = await request(srv.app).post('/api/auth/register').send({ name: 'P', email, password: 'OldPass123', role: 'teacher' });
    const oldCookie = cookieFrom(reg);

    const unknown = await request(srv.app).post('/api/auth/forgot-password').send({ email: uniqueEmail() });
    const known = await request(srv.app).post('/api/auth/forgot-password').send({ email });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);

    const token = lastLinkToken(email, 'reset-password');
    await request(srv.app).post('/api/auth/reset-password').send({ token, password: 'weak' }).expect(400);
    await request(srv.app).post('/api/auth/reset-password').send({ token, password: 'NewPass456' }).expect(200);
    await request(srv.app).post('/api/auth/reset-password').send({ token, password: 'NewPass789' }).expect(400);

    await request(srv.app).post('/api/auth/refresh').set('Cookie', oldCookie).expect(401);
    await request(srv.app).post('/api/auth/login').send({ email, password: 'OldPass123' }).expect(401);
    await request(srv.app).post('/api/auth/login').send({ email, password: 'NewPass456' }).expect(200);
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(srv.app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeTruthy();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['permissions-policy']).toMatch(/camera=\(self\)/);
  });
});
