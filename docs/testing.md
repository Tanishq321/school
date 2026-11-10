# Testing

## 1. Backend unit/integration tests (Vitest + Supertest + socket.io-client)

```bash
cd backend && npm test        # needs MongoDB on 127.0.0.1:27017 (or TEST_MONGODB_URI)
```

Each test file uses a throwaway database. Coverage:

- **auth.test.js**: registration validation, login (generic errors), `/me` protection, refresh rotation + reuse detection + family revocation, foreign-origin refresh refused, logout, email verification (single use), password reset (revokes sessions, no account enumeration), security headers.
- **meetings.test.js**: role and verification gates, code format and uniqueness, scheduled-meeting validation, host vs guest views, malformed/unknown codes, password enforcement, invite-token bypass, invite rotation, TURN credential format (secret never leaked), host-only update/end/attendance, closed meetings refuse joins, listing, automatic expiry.
- **sfu.test.js** (real mediasoup worker): SFU mode and capacity, admit all, non-member and cross-user id rejection, one transport per direction, source/kind validation, producer announcement → consume → resume, late-joiner producer list, host mute pauses the producer, mute all, self-unmute off blocks resume and forces paused mic, raise hand, grant speak, lock (423 for newcomers, returning members allowed), remove (consumers closed, peer removed, REST 403), router closed on end.
- **sockets.test.js**: handshake auth (invalid token, unverified user), waiting room + host notifications, waiting users can't signal, non-hosts can't admit, admission events, signalling relayed only between members and tagged with sender, payload validation, media-state broadcast, ICE refresh, 1-to-1 capacity enforcement, join tokens bound to their user, reconnect grace period (attendance not split), seat freed after grace, host-only end, attendance closure and totals, joining before host + auto-admit, idle meeting auto-end.

## 2. End-to-end WebRTC tests (Puppeteer + Chrome + coturn)

```bash
cd frontend && npm run build
cd ../e2e && npm ci && node run-e2e.mjs
```

The script starts coturn (loopback test config) and the backend serving the built frontend. It then drives **two separate Chrome instances** (separate profiles, like two devices) through the UI:

register → verify email via the logged link → teacher starts a meeting → student joins and waits → teacher admits → **video and audio verified flowing in both directions** (decoded-frame counts rising, speaking indicator triggered by remote audio) → path verified via the connection badge → mute and camera on/off propagate → **backend restart mid-call** (media keeps flowing peer-to-peer, signalling reconnects, seats reclaimed) → teacher ends the class for everyone → attendance shows real time in class.

It runs twice: **direct** and **TURN relay forced** (`iceTransportPolicy: relay`, confirmed by the badge and coturn's log). Screenshots, `results.json`, and backend/coturn logs go to `e2e/artifacts/`.

What this proves and what it doesn't: the WebRTC stack is real (ICE, DTLS, SRTP, VP8/Opus encode and decode, TURN allocation and relaying). The camera and microphone are Chrome's built-in fake capture devices (test pattern + beep), because the CI machine has no camera. Both browsers run on one host. It does **not** replace testing on physical devices across real networks (below).

## 3. Results of the last run (Phase 2)

| Suite | Result |
|---|---|
| Backend (Vitest): auth, meetings, sockets, **SFU + host controls on a real mediasoup worker** | 44 / 44 passed |
| E2E peer-to-peer mode (`node run-e2e.mjs`): direct + TURN relay, restart mid-call | 29 / 29 |
| E2E SFU mode (`E2E_SFU=1 node run-e2e.mjs`): 1-to-1 direct + TURN relay into the SFU + restart recovery | 29 / 29 |
| E2E SFU **group class**: 1 teacher + 4 students in 5 separate browsers | 18 / 18 |
| E2E split origins (Vercel-style), Phase 1 build | 29 / 29 (3 runs) |
| TURN script against local coturn | UDP + TCP allocations, 0 % loss; wrong secret rejected |

The group scenario verifies through the real UI:
- all five see four live videos;
- remote audio reaches the teacher;
- grid ↔ speaker view;
- "admit all";
- host mute (checked on the SFU);
- self-unmute off → student can't unmute → raises hand → host allows → audible again;
- remove (can't rejoin);
- lock (newcomer refused);
- the remaining students still receive everyone;
- end for all.

On this 2-vCPU test box, five Chrome instances each encoding 3 simulcast layers sometimes push the badge to "Fair". That reflects the box running both the clients and the server, not network conditions.

Environment: Ubuntu 24.04, Node 22.23, mediasoup 3.32.2, mediasoup-client 3.26.0, Chrome for Testing 153, coturn 4.6.1, FerretDB 1.24 as a MongoDB stand-in (run the suites against real MongoDB before release).

## 4. Manual test matrix (still to do on real devices)

These need physical hardware and separate networks. They have **not** been run yet.

| Platform | Join | Camera/mic | Switch camera | Device change | Reconnect (airplane 5 s) | Relay forced |
|---|---|---|---|---|---|---|
| Chrome desktop (Win/macOS) | ☐ | ☐ | n/a | ☐ | ☐ | ☐ |
| Edge desktop | ☐ | ☐ | n/a | ☐ | ☐ | ☐ |
| Firefox desktop | ☐ | ☐ | n/a | ☐ | ☐ | ☐ |
| Safari macOS | ☐ | ☐ | n/a | ☐ | ☐ | ☐ |
| Chrome Android | ☐ | ☐ | ☐ | — | ☐ | ☐ |
| Safari iOS 17+ | ☐ | ☐ | ☐ | — | ☐ | ☐ |
| Capacitor Android / iOS | Phase 5 | | | | | |
| Group class, 6+ real devices | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Networks to cover: home Wi-Fi ↔ mobile data; corporate/school network that blocks UDP (should fall back to TURN over TCP 3478 or TURNS 5349); symmetric NAT (mobile carrier CGNAT).
