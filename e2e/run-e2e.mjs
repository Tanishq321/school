/**
 * End-to-end test: two separate Chrome instances (separate profiles = separate users/devices)
 * run the real app, real Socket.IO signalling, real WebRTC (ICE/DTLS/SRTP, VP8/Opus encode +
 * decode) and a real coturn relay. Chrome's built-in fake capture devices replace the physical
 * camera/mic only (a synthetic test pattern + beep), since this machine has no camera.
 *
 * Scenarios: (1) direct path, (2) TURN relay forced (iceTransportPolicy=relay).
 * Prereqs: MongoDB-compatible DB on 127.0.0.1:27017, `turnserver` installed, frontend built.
 *
 *   cd e2e && npm install && node run-e2e.mjs
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const PORT = Number(process.env.E2E_PORT || 4100);
// E2E_SPLIT=1 mimics "frontend on Vercel + backend on Render": the page is served by a separate origin
// that proxies /api (like a Vercel rewrite) while Socket.IO connects straight to the backend origin.
const SPLIT = process.env.E2E_SPLIT === '1';
const FRONT_PORT = PORT + 1;
const BASE = SPLIT ? `http://localhost:${FRONT_PORT}` : `http://localhost:${PORT}`;
const ART = path.join(ROOT, 'e2e', 'artifacts', process.env.E2E_SPLIT === '1' ? 'split' : '');
const TURN_SECRET = 'e2e-turn-secret-0123456789abcdef0123456789';
fs.mkdirSync(ART, { recursive: true });

const results = [];
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, detail });
    log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
    return detail;
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t, detail: err.message });
    log(`FAIL ${name} - ${err.message}`);
    throw err;
  }
}

// ---------------------------------------------------------------- processes

let backend;
let backendLogs = '';
const dbName = `vp_e2e_${Date.now()}`;

function startBackend() {
  return new Promise((resolve, reject) => {
    backend = spawn(process.execPath, ['src/server.js'], {
      cwd: path.join(ROOT, 'backend'),
      env: {
        ...process.env,
        ENV_FILE: '/nonexistent',
        NODE_ENV: 'development',
        PORT: String(PORT),
        HOST: '127.0.0.1',
        LOG_LEVEL: 'info',
        APP_URL: BASE,
        MONGODB_URI: `mongodb://127.0.0.1:27017/${dbName}`,
        JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef0123456789',
        MEETING_TOKEN_SECRET: 'e2e-meeting-secret-0123456789abcdef012345678',
        INVITE_SECRET: 'e2e-invite-secret-0123456789abcdef0123456789',
        TURN_SECRET,
        TURN_URLS: 'turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp',
        STUN_URLS: 'stun:127.0.0.1:3478',
        REQUIRE_EMAIL_VERIFICATION: 'true',
        SERVE_FRONTEND_DIST: SPLIT ? '' : path.join(ROOT, 'frontend', 'dist'),
        CORS_ORIGINS: SPLIT ? BASE : '',
        RECONNECT_GRACE_SECONDS: '20',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (d) => {
      backendLogs += d.toString();
      if (backendLogs.includes('API listening')) resolve();
    };
    backend.stdout.on('data', onData);
    backend.stderr.on('data', onData);
    backend.on('exit', (code) => code && reject(new Error(`backend exited ${code}\n${backendLogs.slice(-2000)}`)));
    setTimeout(() => reject(new Error('backend did not start')), 20_000);
  });
}

async function restartBackend() {
  const exited = new Promise((r) => backend.once('exit', r));
  backend.kill('SIGTERM');
  await exited;
  backendLogs += '\n--- restart ---\n';
  const marker = backendLogs.length;
  await sleep(1500);
  await startBackend();
  return marker;
}

/** Minimal stand-in for Vercel: static files + SPA fallback + /api reverse proxy. */
function startFrontProxy() {
  const dist = path.join(ROOT, 'frontend', 'dist-split');
  execSync('npx vite build --outDir dist-split --emptyOutDir', {
    cwd: path.join(ROOT, 'frontend'),
    env: { ...process.env, VITE_SOCKET_URL: `http://localhost:${PORT}` },
    stdio: 'ignore',
  });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const headers = { ...req.headers, host: `127.0.0.1:${PORT}`, 'x-forwarded-for': req.socket.remoteAddress };
      const up = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      up.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(up);
      return;
    }
    let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(FRONT_PORT, '127.0.0.1', () => r(server)));
}

let turn;
function startTurn() {
  turn = spawn('turnserver', ['-c', path.join(ROOT, 'infrastructure/coturn/turnserver.local-test.conf')], { stdio: ['ignore', 'pipe', 'pipe'] });
  turn.logs = '';
  turn.stdout.on('data', (d) => (turn.logs += d));
  turn.stderr.on('data', (d) => (turn.logs += d));
  return sleep(1000);
}

function verificationLink(email) {
  const lines = backendLogs.split('\n').filter((l) => l.includes('[dev-mail]') && l.includes(email));
  const m = lines.at(-1)?.match(/https?:\/\/[^\s"\\]+verify-email\?token=[^\s"\\]+/);
  if (!m) throw new Error(`no verification email for ${email}`);
  return m[0];
}

// ---------------------------------------------------------------- browser helpers

async function launch(label) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,800',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  page.label = label;
  page.on('pageerror', (e) => log(`[${label}] pageerror`, e.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon|401|Failed to load resource/.test(m.text()) && log(`[${label}] console.error`, m.text()));
  return { browser, page };
}

const clickText = async (page, selector, text) => {
  await page.waitForFunction(
    (sel, t) => [...document.querySelectorAll(sel)].some((e) => e.textContent.includes(t) && !e.disabled),
    { timeout: 15_000 },
    selector,
    text,
  );
  await page.evaluate(
    (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && !e.disabled).click(),
    selector,
    text,
  );
};

async function registerAndVerify(page, { name, email, role }) {
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0' });
  await clickText(page, 'label', role === 'teacher' ? 'I’m a teacher' : 'I’m a student');
  await page.type('input[autocomplete="name"]', name);
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', 'Classroom123');
  await clickText(page, 'button[type="submit"]', 'Create account');
  await page.waitForFunction(() => document.body.innerText.includes('Verify your email'), { timeout: 15_000 });
  await page.goto(verificationLink(email), { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.body.innerText.includes('Your email is verified'), { timeout: 10_000 });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
}

/** Video is "flowing" if the remote <video> has dimensions and decoded frame count keeps rising. */
async function remoteVideoFlowing(page, timeout = 20_000) {
  const read = () =>
    page.evaluate(() => {
      const v = document.querySelector('[data-testid="tile-remote"] video');
      if (!v || !v.videoWidth) return null;
      return { w: v.videoWidth, h: v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames };
    });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const a = await read();
    if (a) {
      await sleep(1500);
      const b = await read();
      if (b && b.frames > a.frames) return `${b.w}x${b.h}, +${b.frames - a.frames} frames in 1.5s`;
    }
    await sleep(500);
  }
  throw new Error(`[${page.label}] remote video not flowing`);
}

const waitSel = (page, sel, timeout = 15_000) => page.waitForSelector(sel, { timeout });

async function remoteAudioFlowing(page) {
  // The tile gets data-speaking when the analyser hears the remote audio track (fake device beeps).
  try {
    await waitSel(page, '[data-testid="tile-remote"][data-speaking]', 15_000);
  } catch (err) {
    const dbg = await page.evaluate(() => {
      const a = document.querySelector('audio[data-remote-audio]');
      const t = a?.srcObject?.getAudioTracks?.()[0];
      const tile = document.querySelector('[data-testid="tile-remote"]');
      return {
        audioEl: Boolean(a),
        paused: a?.paused,
        track: t ? { readyState: t.readyState, muted: t.muted, enabled: t.enabled } : null,
        tileMutedIcon: Boolean(tile?.querySelector('[aria-label="Muted"]')),
      };
    });
    throw new Error(`${err.message} | debug ${JSON.stringify(dbg)}`);
  }
  return 'speaking indicator triggered by remote audio';
}

const badgeText = (page) => page.$eval('[data-testid="connection-badge"]', (e) => e.textContent).catch(() => '');

// ---------------------------------------------------------------- scenario

async function scenario(mode) {
  const relay = mode === 'relay';
  const tag = `${mode}${Date.now() % 100000}`;
  const T = await launch(`teacher-${mode}`);
  const S = await launch(`student-${mode}`);
  const teacher = { name: 'Asha Teacher', email: `teacher.${tag}@example.test`, role: 'teacher' };
  const student = { name: 'Ravi Student', email: `student.${tag}@example.test`, role: 'student' };
  let code;
  try {
    await step(`[${mode}] teacher registers + verifies email`, () => registerAndVerify(T.page, teacher));
    await step(`[${mode}] student registers + verifies email`, () => registerAndVerify(S.page, student));

    await step(`[${mode}] teacher creates instant meeting and starts it`, async () => {
      await clickText(T.page, 'button', 'New meeting');
      await T.page.waitForFunction(() => /\/m\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(location.pathname), { timeout: 15_000 });
      code = T.page.url().split('/m/')[1];
      if (relay) await T.page.evaluate(() => localStorage.setItem('vp.forceRelay', '1'));
      await clickText(T.page, 'button', 'Start class');
      await waitSel(T.page, '[data-testid="meeting-room"]');
      return `code ${code}`;
    });

    await step(`[${mode}] student joins by link and lands in waiting room`, async () => {
      await S.page.goto(`${BASE}/m/${code}`, { waitUntil: 'networkidle0' });
      if (relay) await S.page.evaluate(() => localStorage.setItem('vp.forceRelay', '1'));
      await clickText(S.page, 'button', 'Join class');
      await S.page.waitForFunction(() => document.body.innerText.includes('Asking to join'), { timeout: 15_000 });
    });

    await step(`[${mode}] teacher admits student from the waiting room`, async () => {
      await waitSel(T.page, `button[aria-label="Admit ${student.name}"]`);
      await T.page.click(`button[aria-label="Admit ${student.name}"]`);
      await waitSel(S.page, '[data-testid="meeting-room"]');
    });

    await step(`[${mode}] teacher receives student video`, () => remoteVideoFlowing(T.page));
    await step(`[${mode}] student receives teacher video`, () => remoteVideoFlowing(S.page));
    await step(`[${mode}] teacher hears student audio`, () => remoteAudioFlowing(T.page));
    await step(`[${mode}] student hears teacher audio`, () => remoteAudioFlowing(S.page));

    await step(`[${mode}] media path is ${relay ? 'TURN relay' : 'direct'}`, async () => {
      let text = '';
      for (let i = 0; i < 20 && !text; i += 1) {
        text = await badgeText(T.page);
        if (!text) await sleep(500);
      }
      const relayed = text.includes('relayed');
      if (relay !== relayed) throw new Error(`badge says "${text}"`);
      if (relay && !/allocation|session/i.test(turn.logs)) throw new Error('coturn logged no allocation');
      return `badge "${text.trim()}"`;
    });

    await T.page.screenshot({ path: path.join(ART, `${mode}-teacher.png`) });
    await S.page.screenshot({ path: path.join(ART, `${mode}-student.png`) });

    await step(`[${mode}] student mutes mic → teacher sees muted indicator`, async () => {
      await S.page.click('button[aria-label^="Mute"]');
      await waitSel(T.page, '[data-testid="tile-remote"] [aria-label="Muted"]', 8000);
      await S.page.click('button[aria-label^="Unmute"]');
      await T.page.waitForFunction(() => !document.querySelector('[data-testid="tile-remote"] [aria-label="Muted"]'), { timeout: 8000 });
    });

    await step(`[${mode}] student turns camera off/on → teacher sees avatar, then video again`, async () => {
      await S.page.click('button[aria-label^="Turn off camera"]');
      await T.page.waitForFunction(() => !document.querySelector('[data-testid="tile-remote"] video'), { timeout: 8000 });
      await S.page.click('button[aria-label^="Turn on camera"]');
      return remoteVideoFlowing(T.page);
    });

    if (!relay) {
      await step(`[${mode}] backend restart mid-call: media keeps flowing, both sides rejoin`, async () => {
        await restartBackend();
        // P2P media doesn't depend on the app server, so video should keep flowing during the outage.
        const during = await remoteVideoFlowing(S.page, 8000);
        await T.page.waitForFunction(() => document.querySelector('[data-testid="meeting-room"]') && !document.body.innerText.includes('Reconnecting…'), { timeout: 30_000 });
        await S.page.waitForFunction(() => document.querySelector('[data-testid="meeting-room"]') && !document.body.innerText.includes('Reconnecting…'), { timeout: 30_000 });
        await sleep(3000);
        await remoteVideoFlowing(T.page);
        await remoteVideoFlowing(S.page);
        // Signalling works again: a mute still propagates.
        await S.page.click('button[aria-label^="Mute"]');
        await waitSel(T.page, '[data-testid="tile-remote"] [aria-label="Muted"]', 8000);
        await S.page.click('button[aria-label^="Unmute"]');
        return `during outage: ${during}`;
      });
    }

    await step(`[${mode}] teacher ends class for everyone`, async () => {
      await T.page.click('button[aria-label="Leave class"]');
      await clickText(T.page, '[role="menuitem"]', 'End class for everyone');
      await S.page.waitForFunction(() => document.body.innerText.includes('The class has ended'), { timeout: 10_000 });
    });

    await step(`[${mode}] attendance shows the student with real time in class`, async () => {
      await T.page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
      await clickText(T.page, 'button', 'Attendance');
      await T.page.waitForFunction((n) => document.querySelector('[role="dialog"] table')?.innerText.includes(n), { timeout: 10_000 }, student.name);
      return T.page.$eval('[role="dialog"] table', (t) => t.innerText.split('\n').find((l) => l.includes('Ravi')).replace(/\t/g, ' | '));
    });
  } finally {
    await T.browser.close();
    await S.browser.close();
  }
}

// ---------------------------------------------------------------- main

let failed = false;
let frontProxy;
try {
  await startTurn();
  await startBackend();
  if (SPLIT) frontProxy = await startFrontProxy();
  log(`app on ${BASE}${SPLIT ? ` (split: API proxied, sockets direct to :${PORT})` : ''}, db ${dbName}`);
  for (const mode of ['direct', 'relay']) {
    try {
      await scenario(mode);
    } catch {
      failed = true;
    }
  }
} catch (err) {
  failed = true;
  log('setup failed', err.message);
} finally {
  backend?.kill('SIGTERM');
  turn?.kill('SIGTERM');
  frontProxy?.close();
  fs.writeFileSync(path.join(ART, 'results.json'), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(ART, 'backend.log'), backendLogs);
  fs.writeFileSync(path.join(ART, 'coturn.log'), turn?.logs || '');
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} steps passed`);
  process.exit(failed ? 1 : 0);
}
