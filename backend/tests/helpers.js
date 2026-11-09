import http from 'node:http';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { connectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/sockets/index.js';
import { devOutbox } from '../src/services/mailer.js';
import { rooms } from '../src/sockets/realtime.js';

export async function startTestServer() {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  return {
    app,
    url,
    io,
    connect(token, opts = {}) {
      const s = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
      sockets.push(s);
      return s;
    },
    async close() {
      sockets.forEach((s) => s.close());
      rooms.clear();
      io.close();
      await new Promise((r) => server.close(r));
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

let counter = 0;
export const uniqueEmail = (p = 'user') => `${p}.${Date.now()}.${counter++}@example.test`;

export function lastLinkToken(email, kind) {
  const mail = [...devOutbox].reverse().find((m) => m.to === email && m.text.includes(kind));
  if (!mail) throw new Error(`No ${kind} email for ${email}`);
  return new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
}

export async function createUser(app, { role = 'student', verified = true, name } = {}) {
  const email = uniqueEmail(role);
  const password = 'Passw0rd!x';
  const res = await request(app).post('/api/auth/register').send({ name: name || `${role} ${counter}`, email, password, role });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (verified) {
    const token = lastLinkToken(email, 'verify-email');
    await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
  }
  return { ...res.body, email, password, id: res.body.user.id, auth: { Authorization: `Bearer ${res.body.accessToken}` } };
}

export const emitAck = (socket, event, payload) =>
  new Promise((resolve) => (payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve)));

export const once = (socket, event, ms = 5000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (data) => {
      clearTimeout(t);
      resolve(data);
    });
  });

export const connected = (socket) =>
  new Promise((resolve, reject) => {
    if (socket.connected) return resolve();
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
