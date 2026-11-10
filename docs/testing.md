# Testing

## 1. Backend unit/integration tests (Vitest + Supertest + socket.io-client)

```bash
cd backend && npm test        # needs MongoDB on 127.0.0.1:27017 (or TEST_MONGODB_URI)
```

Each test file uses a throwaway database. Coverage:

- **auth.test.js**: registration validation, login (generic errors), `/me` protection, refresh rotation + reuse detection + family revocation, foreign-origin refresh refused, logout, email verification (single use), password reset (revokes sessions, no account enumeration), security headers.
- **meetings.test.js**: role and verification gates, code format and uniqueness, scheduled-meeting validation, host vs guest views, malformed/unknown codes, password enforcement, invite-token bypass, invite rotation, TURN credential format (secret never leaked), host-only update/end/attendance, closed meetings refuse joins, listing, automatic expiry.
- **sfu.test.js** (real mediasoup worker): SFU mode, class size 2, group-only events gone, a second student refused even by the host, non-member and cross-user id rejection, one transport per direction, source/kind validation, producer announcement → consume → resume, host mute pauses the producer (student may unmute), lock (423 for newcomers, the student can return), remove (peer removed, REST 403), the freed seat can be taken, router closed on end.
- **classroom.test.js** (real mediasoup worker): chat broadcast + persistence, markup kept as text, empty/oversized rejected, history for late joiners, host-only delete (soft, persisted), host-only chat mode, rate limiting; whiteboard open (host only), drawing permission, strict op validation (coordinates, colour, tool, shape points, unknown fields, empty text, duplicates), live strokes relayed but not stored, erase limited to author/host, redo, persistence (flat point storage), host-only clear; screen-share permission, single slot, host take-over, SFU screen producer requires the slot, revoking permission closes it, leaving frees it.
- **recording.test.js** (real mediasoup worker plus FFmpeg feeding synthetic Opus/VP8 RTP into producers):
  - Invitations: emails with `.ics`, case-insensitive dedupe, the invitee's calendar range (an outsider's range doesn't include it, the 62-day cap is enforced), `.ics` export, the summary page (host-only notes, attendance, guests, transcript; an outsider gets 403), and invitees skip the waiting room.
  - Recording: host-only start, consent requested with state broadcast, and a duplicate start refused.
  - **Privacy proof by audio analysis:** the student's 1500 Hz tone is absent from the film before they agreed and present after (> 20 dB band difference), while the host's 440 Hz tone is there throughout.
  - The final file is H.264 1280×720 + AAC with a poster, and raw tracks are cleaned up.
  - Access: private until shared. Range streaming returns 206 / 416. Tampered and cross-recording tokens get 401. Poster-only tokens can't stream. Attendees and invitees can watch only after sharing, and un-sharing revokes outstanding links. Outsiders never get access.
  - Delete removes the files. When nobody consents, nothing is kept. Ending the class stops and finalises. The retention sweep removes old recordings. A path-traversal guard is in place.
- **security.test.js**:
  - TOTP against the RFC 6238 test vector, base32 and sealing round trips, replay refusal.
  - Lockout: locks after repeated failures even for the right password; an administrator unlocks; unknown emails never lock.
  - Two-step sign-in: enrolment needs a valid code; secrets are stored sealed and recovery codes hashed; the password alone yields no session or cookie; wrong, replayed and forged challenges are refused; a recovery code works once; turning it off needs password and code.
  - Devices: listing, revoking one device (its refresh token dies), nobody can revoke someone else's; changing the password kills the old access token and other devices but keeps this one.
  - Native-app mode: refresh token in the body, no cookie, rotation, refused for browsers and foreign origins.
  - Administration: closed to non-admins (401/403); the overview and class register never contain a class title or code; admins get 403 on class content; ending a class; search is regex-safe; suspension drops the live socket and blocks tokens and sign-in at once; self-suspension, self-demotion and unknown roles are refused; forced sign-out kills access and refresh tokens; the audit trail records administrator actions.
  - Metrics: 404 without the token, Prometheus text with it, no personal data.
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

## 3. Results of the last run (Phase 5)

| Suite | Result |
|---|---|
| Backend (Vitest): auth, meetings, sockets (incl. one-student rule, two early arrivals), SFU + host controls, chat / whiteboard / screen share, recording, invitations, calendar, class pages, **lockout, two-step sign-in, devices, administration, metrics** | 79 / 79 |
| E2E peer-to-peer (`node run-e2e.mjs`): direct + TURN relay + **seat rule** (3 browsers: the second student can't be admitted until the first leaves) + **security and administration** | 47 / 47 |
| E2E split origins (`E2E_SPLIT=1`, Vercel-style proxy + direct sockets), same scenarios | 47 / 47 |
| E2E SFU (`E2E_SFU=1`): direct, relay, seat rule, **real recording** | 49 / 49 |

New Phase 5 E2E scenario (`security`, three real Chrome instances: teacher, student, administrator):
1. The teacher turns on two-step sign-in in the UI. The test reads the setup key and computes real TOTP codes, as an authenticator app would. Ten recovery codes are shown.
2. Signing in again stops at the code screen; a wrong code is refused, the right one signs in.
3. Ctrl+K opens the command palette; typing and Enter navigates. A teacher who types `/admin` is sent home.
4. Five wrong passwords lock the student's account.
5. The administrator sees the teacher's live class on the overview, and the test asserts the page contains neither the class code nor its title.
6. The administrator unlocks the student, suspends them (the student's open session is thrown out to the sign-in page) and restores them.
7. The administrator ends the live class; the audit trail lists the administrator's actions, the lockout and the two-step change.

**Not tested:** the Android and iOS projects (no SDK or device here; see mobile-apps.md), and Prometheus/alerting against a real Prometheus server (the endpoint's output format is tested).

Phase 4 E2E scenario (`recording`, two real Chrome instances through the SFU, with simulcast):
1. The teacher clicks *Record this class* → *Begin recording*.
2. The red lamp appears for both people, and the student gets the consent dialog. The student chooses *Include me*: the dialog closes, their lamp reads *Included*, and the teacher's lamp shows "2 included".
3. About 10 s of class pass, with a presentation in the middle. The teacher stops; the lamp disappears for the student.
4. The server composes the MP4. ffprobe confirms H.264 1280×720 + AAC, at least 8 s, and `volumedetect` confirms real sound (Chrome's fake mic beep, peak −2.5 dB).
5. The archive shows the poster. The player loads the film, plays it and seeks near the end (HTTP Range) at 1280×720.
6. The student's archive is empty until the teacher toggles *Share with the class*, and then it lists the film.
7. The Today, Calendar, Classes, Recordings, player and consent screens are captured for review.

New Phase 3 E2E steps, run in all four 1-to-1 modes (P2P direct, P2P relay, SFU direct, SFU relay):
- **Chat:** the student writes, the teacher gets an unread badge, the link is rendered with `noopener`, and the teacher deletes the message for everyone.
- **Presentation:** the teacher shares a screen (Chrome's synthetic capture) and the student's screen stage shows moving frames; students have no present button without permission.
- **Whiteboard:** the teacher draws a freehand stroke and the student sees it (operation count syncs). The student has no tools until the teacher enables drawing; then the student draws a rectangle the teacher receives, and the student's undo removes it for the teacher.

Phase 3 E2E steps (chat, presentation, whiteboard) still run in all four 1-to-1 modes. Environment and caveats are as before: FerretDB stands in for MongoDB here (it needed the whiteboard's points stored as a flat list; real MongoDB is unaffected), and physical-device testing is still outstanding.

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
| Capacitor Android / iOS (see mobile-apps.md §5) | ☐ | ☐ | ☐ | — | ☐ | ☐ |

Networks to cover: home Wi-Fi ↔ mobile data; corporate/school network that blocks UDP (should fall back to TURN over TCP 3478 or TURNS 5349); symmetric NAT (mobile carrier CGNAT).
