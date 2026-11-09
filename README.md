# Kaksha: self-hosted live classroom

A video meeting and virtual classroom platform that runs entirely on infrastructure you control: WebRTC + Socket.IO signalling + coturn today, with a mediasoup SFU next. No Zoom, Google Meet, Agora, Twilio, Daily, or hosted Jitsi.

**Status: Phase 1 complete** (1-to-1 classes). See the [roadmap](#roadmap) for what's next.

## What works now (Phase 1)

- Accounts: register as teacher or student, login/logout, email verification, forgot/reset password, rotating refresh tokens, role-based access, profiles
- Dashboard: start an instant class, schedule a class (password, waiting room, duration), join by code or invite link, upcoming and recent classes, per-class attendance report
- Meetings: unguessable codes (`abc-defg-hij`), HMAC invite links (rotatable), meeting passwords, waiting room with admit/deny, join-before-host lobby, host "end for everyone", automatic expiry and idle shutdown
- 1-to-1 video: native WebRTC, peer-to-peer with automatic TURN fallback, camera/mic toggles, device selection (mic, camera, speaker), front/rear camera switch, speaking indicator, muted / camera-off indicators, connection quality (RTT, loss, relayed/direct), ICE restart on network changes, 20-second seat hold across signalling drops, keyboard shortcuts
- Attendance recorded from real join/leave times (reconnects don't split sessions)
- Connection test page: browser support, devices, ICE candidates, TURN allocation and a real relay loopback
- Light/dark mode, responsive down to phones, accessible controls

## Quick start (development)

```bash
# prerequisites: Node 22.12+, MongoDB on 127.0.0.1:27017
cd backend  && npm ci && cp ../.env.example .env   # set NODE_ENV=development + secrets, see docs/setup.md
npm run dev
cd ../frontend && npm ci && npm run dev            # http://localhost:5173
```

Verification emails are printed to the backend log when SMTP isn't configured.

## Repository layout

```
backend/           Express 5 + Socket.IO 4.8 + Mongoose 9 API and signalling
  src/config       env validation (zod), DB connection
  src/controllers  REST handlers
  src/middleware   auth, RBAC, validation, rate limits, errors
  src/models       User, RefreshToken, OneTimeToken, Meeting, Attendance, AuditLog
  src/routes       /api/auth, /api/meetings, /api/diagnostics
  src/services     auth, tokens, meetings, attendance, TURN credentials, mailer, audit, expiry job
  src/sockets      handshake auth, live room registry, meeting & signalling events
  tests/           Vitest suites (35 tests)
frontend/          React 19 + Vite 8 + Tailwind 4
  src/services     api client, LocalMedia (devices), P2PPeer (RTCPeerConnection), MeetingClient
  src/pages        auth pages, dashboard, meeting (lobby/waiting/room), diagnostics, profile
  src/components   UI kit, app shell, video tiles, participants panel, device settings
e2e/               Puppeteer two-browser WebRTC tests (direct + TURN relay)
infrastructure/    coturn configs + TURN test script, Nginx site, PM2, firewall, backups
docs/              architecture, setup, deployment, security, testing
```

## Tests

```bash
cd backend && npm test                        # 35 API + socket tests
cd frontend && npm run build && cd ../e2e && npm ci && node run-e2e.mjs   # 29 E2E steps
E2E_SPLIT=1 node run-e2e.mjs   # same, with Vercel-style split origins
```

See [docs/testing.md](docs/testing.md) for what is covered and what still needs physical devices.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, dashboard, meetings, waiting room, 1-to-1 WebRTC, signalling, coturn | ✅ done |
| 2 | mediasoup SFU, group classes (up to 20), mute/remove/lock, grid & speaker layouts | next |
| 3 | Screen sharing, chat, whiteboard, attendance UI, teacher controls | |
| 4 | Server-side recording, teacher/student dashboards, calendar, history | |
| 5 | Admin dashboard, hardening, monitoring, Capacitor Android/iOS apps | |
| 6 | Production deployment, load tests, multi-server, disaster recovery | |

## Try it online (test deployment)

GitHub → Render (+ optional Vercel) + MongoDB Atlas: see [docs/deploy-render-vercel.md](docs/deploy-render-vercel.md). TURN still needs a small VPS (Render/Vercel have no UDP).

## Docs

[Architecture](docs/architecture.md) · [Setup](docs/setup.md) · [Deployment (VPS)](docs/deployment.md) · [Test deploy (Render/Vercel)](docs/deploy-render-vercel.md) · [Security](docs/security.md) · [Testing](docs/testing.md)
