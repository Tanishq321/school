# Scholé: the private academy, live

*Scholé* (Greek σχολή, "leisure devoted to learning") is the word every European language took "school" from.

A video meeting and virtual classroom platform that runs entirely on infrastructure you control: native WebRTC, Socket.IO signalling, coturn, a mediasoup SFU and an in-process FFmpeg recorder. No Zoom, Google Meet, Agora, Twilio, Daily, or hosted Jitsi.

**Every class is one-to-one: one teacher, one student.** The server enforces it in both media modes.

**Status: Phase 5 complete, Phase 6 in part** (teaching tools for both sides, Docker, backups with a restore drill, a signalling load test; multi-server is designed, not built). Earlier phases: consent-based server-side recording with a private archive and player, email invitations with calendar files, a month calendar, a class ledger with notes, attendance and transcripts, on top of teacher controls, presentation, chat and whiteboard. See the [roadmap](#roadmap).

The brand name lives in one place (`frontend/src/brand.js`, `APP_NAME` on the server); set `VITE_APP_NAME` / `APP_NAME` to rename it.

## Teaching tools: teacher side and student side (latest)

**Teacher**
- **Students register** (`/students`): everyone you teach, next lesson first, with lessons held, hours, attendance rate and homework done. Each student has a page: figures, booked lessons, and every past lesson with whether they came, whether notes were written, and their homework.
- **Weekly series:** schedule 4, 6, 8, 10, 12 or 26 lessons at once. The student gets one invitation with every date in one calendar file. Each lesson can be moved alone; cancelling offers "this lesson only" or "this and following lessons".
- **After the lesson:** a summary and a homework list for the student on the class page (separate from the private notes, which stay private). "Save and send" emails it. The student's ticks appear as they make them.
- **Today:** this week's lessons, hours taught, active students, and the lessons still waiting for notes, each one click from writing them.

**Student**
- **After the lesson:** the teacher's notes on ruled paper and a homework checklist with a progress rule; ticks save at once.
- **Today:** this month's lessons and hours of study, homework to do, weeks in a row with a lesson, the latest notes from teachers, and a "before your lesson" connection check.
- **Series** show as a strip of dated stops on every class page, with the current lesson marked.

**Both:** emails when a lesson is moved (the calendar entry updates in place) or cancelled (it leaves the calendar), a reminder 30 minutes before each class (`REMINDER_MINUTES`), and every email shows times in the reader's own time zone, taken from their device.

**House rules:** administrators must turn on two-step sign-in before the console opens (`ADMIN_REQUIRE_2FA`, on by default in production).

**The instrument** on the landing page now carries engraving drawn in code: the zodiac band with its twelve signs and degree scale, a horizon dial with the cardinal points and the house inscription, a latitude scale on the meridian, gilt constellations on the globe, a guilloché rosette and compass rose inlaid in the plinth, a rayed sun, a moon that shows its phase, and turned finials.

## What works now (Phase 1)

- Accounts: register as teacher or student, login/logout, email verification, forgot/reset password, rotating refresh tokens, role-based access, profiles
- Dashboard: start an instant class, schedule a class (password, waiting room, duration), join by code or invite link, upcoming and recent classes, per-class attendance report
- Meetings: unguessable codes (`abc-defg-hij`), HMAC invite links (rotatable), meeting passwords, waiting room with admit/deny, join-before-host lobby, host "end for everyone", automatic expiry and idle shutdown
- 1-to-1 video: native WebRTC, peer-to-peer with automatic TURN fallback, camera/mic toggles, device selection (mic, camera, speaker), front/rear camera switch, speaking indicator, muted / camera-off indicators, connection quality (RTT, loss, relayed/direct), ICE restart on network changes, 20-second seat hold across signalling drops, keyboard shortcuts
- Attendance recorded from real join/leave times (reconnects don't split sessions)
- Connection test page: browser support, devices, ICE candidates, TURN allocation and a real relay loopback
- Light/dark mode, responsive down to phones, accessible controls

## Design update: light and dark, 3D, scroll

- **Follows the device.** The app is light or dark according to the phone's or computer's setting, and switches live when the device does, with no reload and no flash on first paint.
  - Members can fix Light or Dark under **Account → Appearance**, from the sun/moon button, or from the command palette.
  - Classes and the screening room stay dark in both, like a cinema.
- **A real light theme.** Warm ivory, ink and stone, with brass only as a fine accent. The navigation spine becomes ivory linen and the hero panels morning light on paper. The background shader turns into ivory silk by day (it dissolves between the two).
- **3D instrument.** A brass armillary sphere, the emblem of scholarship, built from geometry in Three.js with physically based metal and studio reflections.
  - It assembles itself on arrival and turns slowly on the sign-in screen.
  - Three.js loads only on those pages (about 140 KB compressed), never inside the app.
  - Devices without a GPU get still frames; devices without WebGL2 see the engraved rosette instead.
- **Scroll story.** The landing page pins the instrument while you scroll through four chapters; the camera travels around it, and every move is damped so it feels weighted without taking over the scroll.
  - A brass reading-progress line runs along the top.
  - Sections, rules and lists rise into place, and ornaments drift slower than the page.
  - These use native CSS scroll-driven animations. Browsers without them, and anyone who asks for reduced motion, get the complete page with nothing hidden and no pinning.
  - On phones the instrument floats above the words.

## Phase 5 additions

- **Account security:**
  - **Two-step sign-in** with any authenticator app (TOTP). Setup shows a QR code drawn on the device, and ten single-use recovery codes.
  - **Lockout:** five wrong passwords or codes in a row lock sign-in for 15 minutes (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`). A password reset or an administrator clears it.
  - **Devices:** members see where they are signed in and can sign any device out. Changing the password signs out every other device at once.
- **Administration** (`npm run create-admin` makes the first administrator):
  - **Overview:** classes in session, people, classes held, recordings and disk, two 14-day charts, system health and failed sign-ins.
  - **People:** search, suspend / restore (takes effect immediately, live connections are dropped), change role, unlock, sign out everywhere.
  - **Classes:** a register of who taught when and for how long; end a live class.
  - **Audit trail:** every sign-in, failure, lockout, security change and administrator action, filterable.
  - **Privacy by design:** administrators never see class titles, codes, chat, notes, boards or recordings.
- **Monitoring:** a token-protected Prometheus endpoint (`/metrics`), with a scrape config and alert rules in [docs/monitoring.md](docs/monitoring.md).
- **Android and iOS:** Capacitor projects in `frontend/android` and `frontend/ios`, camera/microphone permissions, and a token mode for apps. Not yet compiled or run on a device; see [docs/mobile-apps.md](docs/mobile-apps.md).
- **Design:**
  - Guilloché engraving (the interlaced line-work of banknotes and watch dials), generated mathematically, on the navigation spine, hero cards and sign-in screen.
  - A metal **membership card** on the account page that tilts and catches the light.
  - Recovery codes issued on a vellum certificate; brass skeleton loaders; foil lettering.
  - A command palette (Ctrl/⌘ K) to jump anywhere or open a room from the keyboard.

## Phase 4 additions

- **Recording, with consent:**
  - The host records with one button. Everyone sees a red lamp with the running time and hears a chime.
  - Every participant is asked: *Include me* / *Stay, but don't record me* / *Leave*. Nobody is captured until they agree, and anyone can change their mind at any time.
  - How it works: the media server hands raw RTP to the recorder in-process (mediasoup DirectTransport, no extra ports). Each consenting voice and the on-screen picture (presentation > teacher > current speaker) are written without re-encoding while the class runs. When recording stops, FFmpeg composes one 1280×720 H.264/AAC MP4 with a poster frame.
  - Off by default (`RECORDING_ENABLED=false`). Needs the media server (`MEDIASOUP_ENABLED=true`, a VPS) so the server can see the call.
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

- **Media server:** mediasoup SFU (`MEDIASOUP_ENABLED=true`) with simulcast and automatic recovery after reconnects, restarts and worker crashes. In Phase 4 it carries the one-to-one call so the server can record it.
- **Teacher controls, enforced on the server:** mute the student, remove (can't rejoin), lock the room, and control what the student may do (present, draw, chat).
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

Demo data for a look around: `cd backend && DEMO_PASSWORD='choose-one' npm run seed:demo` (a teacher, three students, a weekly series with notes and homework; refuses to run in production).

## Run it with Docker

`docker compose up -d --build` runs the app, MongoDB, coturn and Caddy (automatic HTTPS) on one server. See [infrastructure/docker/README.md](infrastructure/docker/README.md). The image has not yet been built outside this repository's CI-less environment; build it once on your server first.

## Repository layout

```
backend/           Express 5 + Socket.IO 4.8 + Mongoose 9 API and signalling
  src/config       env validation (zod), DB connection
  src/controllers  REST handlers
  src/middleware   auth, RBAC, validation, rate limits, errors
  src/models       User, RefreshToken, OneTimeToken, Meeting, Attendance, AuditLog, ChatMessage, Whiteboard, Recording, JobClaim
  src/routes       /api/auth, /api/meetings, /api/recordings, /api/students, /api/me, /api/admin, /api/diagnostics
  src/services     auth, tokens, meetings, attendance, insights (register, figures), TURN credentials, mailer, calendar, audit, expiry and reminder jobs
  src/scripts      create-admin, seed:demo, backup / restore / backup:drill, load:signalling
  src/sockets      handshake auth, live room registry, meeting & signalling events
  src/recording    RTP → Ogg Opus / VP8 IVF writers, recorder, FFmpeg composer
  tests/           Vitest suites (97 tests)
frontend/          React 19 + Vite 8 + Tailwind 4
  src/services     api client, LocalMedia (devices), P2PPeer (RTCPeerConnection), MeetingClient
  src/pages        landing, auth, Today, Calendar, Classes (+ class page), Recordings (+ player), meeting room, diagnostics, profile
  src/components   UI kit, app shell, video tiles, participants panel, device settings
e2e/               Puppeteer multi-browser tests (WebRTC, seat rule, recording, security, lessons), screenshot and icon tools
infrastructure/    coturn configs + TURN test script, Nginx site, PM2, firewall, backups, docker (Caddyfile, env)
docs/              architecture, setup, deployment, security, testing
```

## Tests

```bash
cd backend && npm test                        # 97 API, socket, SFU, recording, security and lessons tests (needs ffmpeg)
cd frontend && npm run build && cd ../e2e && npm ci && node run-e2e.mjs   # P2P: direct + TURN relay
E2E_SFU=1 node run-e2e.mjs     # through the SFU: direct, relay, one-student seat rule, real recording
E2E_SPLIT=1 node run-e2e.mjs   # same, with Vercel-style split origins
```

See [docs/testing.md](docs/testing.md) for what is covered and what still needs physical devices.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Auth, dashboard, meetings, waiting room, 1-to-1 WebRTC, signalling, coturn | ✅ done |
| 2 | mediasoup SFU, teacher controls (mute/remove/lock), premium redesign | ✅ done (group features later removed: classes are one-to-one) |
| 3 | Screen sharing, chat, whiteboard, attendance export, classroom permissions | ✅ done |
| 4 | Server-side recording (consent), archive & player, invitations, calendar, class history | ✅ done |
| 5 | Admin console, two-step sign-in, lockout, devices, monitoring, Capacitor Android/iOS shells | ✅ done (apps not yet device-tested) |
| 6 | Production deployment, load tests, multi-server, disaster recovery | in part: Docker + compose, backup/restore drill + runbook, signalling load test done; multi-server designed only ([operations](docs/operations.md)) |

## Try it online (test deployment)

GitHub → Render (+ optional Vercel) + MongoDB Atlas: see [docs/deploy-render-vercel.md](docs/deploy-render-vercel.md). TURN and recording need a small VPS (Render/Vercel have no UDP).

## Docs

[Architecture](docs/architecture.md) · [Setup](docs/setup.md) · [Deployment (VPS)](docs/deployment.md) · [Test deploy (Render/Vercel)](docs/deploy-render-vercel.md) · [Security](docs/security.md) · [Operations, backups, capacity](docs/operations.md) · [Monitoring](docs/monitoring.md) · [Mobile apps](docs/mobile-apps.md) · [Testing](docs/testing.md)
