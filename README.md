# Scholé: the private academy, live

*Scholé* (Greek σχολή, "leisure devoted to learning") is the word every European language took "school" from.

A video meeting and virtual classroom platform that runs entirely on infrastructure you control: native WebRTC, Socket.IO signalling, coturn, a mediasoup SFU and an in-process FFmpeg recorder. No Zoom, Google Meet, Agora, Twilio, Daily, or hosted Jitsi.

**Status: Phase 4 complete**: consent-based server-side recording with a private archive and player, email invitations with calendar files, a month calendar, a class ledger with notes, attendance and transcripts, on top of group classes, host controls, presentation, chat and whiteboard. See the [roadmap](#roadmap).

The brand name lives in one place (`frontend/src/brand.js`, `APP_NAME` on the server); set `VITE_APP_NAME` / `APP_NAME` to rename it.

## What works now (Phase 1)

- Accounts: register as teacher or student, login/logout, email verification, forgot/reset password, rotating refresh tokens, role-based access, profiles
- Dashboard: start an instant class, schedule a class (password, waiting room, duration), join by code or invite link, upcoming and recent classes, per-class attendance report
- Meetings: unguessable codes (`abc-defg-hij`), HMAC invite links (rotatable), meeting passwords, waiting room with admit/deny, join-before-host lobby, host "end for everyone", automatic expiry and idle shutdown
- 1-to-1 video: native WebRTC, peer-to-peer with automatic TURN fallback, camera/mic toggles, device selection (mic, camera, speaker), front/rear camera switch, speaking indicator, muted / camera-off indicators, connection quality (RTT, loss, relayed/direct), ICE restart on network changes, 20-second seat hold across signalling drops, keyboard shortcuts
- Attendance recorded from real join/leave times (reconnects don't split sessions)
- Connection test page: browser support, devices, ICE candidates, TURN allocation and a real relay loopback
- Light/dark mode, responsive down to phones, accessible controls

## Phase 4 additions

- **Recording, with consent:**
  - The host records with one button. Everyone sees a red lamp with the running time and hears a chime.
  - Every participant is asked: *Include me* / *Stay, but don't record me* / *Leave*. Nobody is captured until they agree, and anyone can change their mind at any time.
  - How it works: the media server hands raw RTP to the recorder in-process (mediasoup DirectTransport, no extra ports). Each consenting voice and the on-screen picture (presentation > teacher > current speaker) are written without re-encoding while the class runs. When recording stops, FFmpeg composes one 1280×720 H.264/AAC MP4 with a poster frame.
  - Off by default (`RECORDING_ENABLED=false`). Group mode (SFU) only.
- **Archive and screening room:**
  - Recordings are private to the teacher until shared with the class (attendees and invited guests). Admins have no access.
  - Playback uses short-lived signed links with seeking (HTTP Range), plus download, rename and delete.
  - Each recording carries a consent ledger: who agreed, and who declined and was left out.
  - Recordings are removed automatically after `RECORDING_RETENTION_DAYS` and stop on their own after `RECORDING_MAX_MINUTES`. Recordings interrupted by a restart are recovered or marked as failed. Every action is audited.
- **Invitations and calendar:**
  - Invite guests by email when scheduling. They get a styled invitation and an `.ics` file, see the class on their own Today page and calendar, and skip the waiting room.
  - *Add to calendar* works for any class.
- **Today:** the next class as an engraved card with a live countdown, then quick actions, the rest of the day, the week ahead and recent recordings.
- **Calendar:** a Monday-first month view. Double-click a day to schedule on it; each day has its own agenda.
- **Classes (the ledger):** searchable history with totals. Each class has a page with recordings, attendance (CSV), chat transcript (TXT), guest list and the host's private notes, which autosave.
- **Design:**
  - Dark by default.
  - A lacquered navigation spine on desktop and a tab bar on phones.
  - A new monogram and favicon, and the etymology set in italic at the foot of the spine.

## Phase 3 additions

- **Presentation:** share a screen, window or tab, one presenter at a time. The host can take over or stop it. Students present only when allowed. Works in both media modes.
- **Chat:** live, saved, with history for late joiners, unread badges, safe links, host deletion, and a host-only mode.
- **Whiteboard:** ivory dotted "paper" with pen, highlighter, line, arrow, rectangle, ellipse, text and eraser, six inks and three weights. Others' strokes appear as they're drawn. Undo/redo, saved with the meeting; students draw only when allowed.
- **Attendance:** CSV download from the dashboard.
- **Flagship design:**
  - a public landing page whose centrepiece is a live, procedurally generated "lacquer silk" WebGL surface (adaptive: still frame on GPU-less devices or with reduced motion);
  - the product itself as the hero visual, with self-drawing annotations;
  - an editorial specification sheet;
  - synthesized FM-bell sound cues (one tonal family, quiet, can be switched off);
  - cursor-following sheen on primary actions, page transitions, a monogram loader, a smoked-glass control dock, and redesigned toasts.

## Phase 2 additions

- **Group classes:** mediasoup SFU (`MEDIASOUP_ENABLED=true`), up to 20 people; simulcast with per-tile quality; active-speaker detection; automatic recovery after reconnects, restarts and worker crashes.
- **Host controls, enforced on the server:** mute, mute everyone, "students may unmute themselves", allow a student to speak, lower hands, remove (can't rejoin), lock the room, admit all.
- **Students:** raise/lower hand.
- **Layouts:** one-to-one with picture-in-picture, auto-fitting grid (centred rows), and speaker view with filmstrip and pinning.
- **Design:** "private study after hours". Midnight lacquer and porcelain, brushed-brass accents, film grain, self-hosted Bodoni Moda + Hanken Grotesk, an engraved monogram, and a lamplight glow.

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
  src/models       User, RefreshToken, OneTimeToken, Meeting, Attendance, AuditLog, ChatMessage, Whiteboard, Recording
  src/routes       /api/auth, /api/meetings, /api/recordings, /api/diagnostics
  src/services     auth, tokens, meetings, attendance, TURN credentials, mailer, audit, expiry job
  src/sockets      handshake auth, live room registry, meeting & signalling events
  src/recording    RTP → Ogg Opus / VP8 IVF writers, recorder, FFmpeg composer
  tests/           Vitest suites (65 tests)
frontend/          React 19 + Vite 8 + Tailwind 4
  src/services     api client, LocalMedia (devices), P2PPeer (RTCPeerConnection), MeetingClient
  src/pages        landing, auth, Today, Calendar, Classes (+ class page), Recordings (+ player), meeting room, diagnostics, profile
  src/components   UI kit, app shell, video tiles, participants panel, device settings
e2e/               Puppeteer two-browser WebRTC tests (direct + TURN relay)
infrastructure/    coturn configs + TURN test script, Nginx site, PM2, firewall, backups
docs/              architecture, setup, deployment, security, testing
```

## Tests

```bash
cd backend && npm test                        # 65 API, socket, SFU and recording tests (needs ffmpeg)
cd frontend && npm run build && cd ../e2e && npm ci && node run-e2e.mjs   # P2P: direct + TURN relay
E2E_SFU=1 node run-e2e.mjs     # SFU: direct, relay, 5-person group, real recording
E2E_SPLIT=1 node run-e2e.mjs   # same, with Vercel-style split origins
```

See [docs/testing.md](docs/testing.md) for what is covered and what still needs physical devices.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, dashboard, meetings, waiting room, 1-to-1 WebRTC, signalling, coturn | ✅ done |
| 2 | mediasoup SFU, group classes (up to 20), mute/remove/lock, raise hand, grid & speaker layouts | ✅ done |
| 3 | Screen sharing, chat, whiteboard, attendance export, classroom permissions | ✅ done |
| 4 | Server-side recording (consent), archive & player, invitations, calendar, class history | ✅ done |
| 5 | Admin dashboard, hardening, monitoring, Capacitor Android/iOS apps | next |
| 6 | Production deployment, load tests, multi-server, disaster recovery | |

## Try it online (test deployment)

GitHub → Render (+ optional Vercel) + MongoDB Atlas: see [docs/deploy-render-vercel.md](docs/deploy-render-vercel.md). TURN, group classes and recording need a small VPS (Render/Vercel have no UDP).

## Docs

[Architecture](docs/architecture.md) · [Setup](docs/setup.md) · [Deployment (VPS)](docs/deployment.md) · [Test deploy (Render/Vercel)](docs/deploy-render-vercel.md) · [Security](docs/security.md) · [Testing](docs/testing.md)
