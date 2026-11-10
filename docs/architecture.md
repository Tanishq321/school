# Architecture

This document describes the target architecture for the whole platform and records what each phase delivers. Anything not marked as done in the phase table is design only.

## 1. Component overview

```
                ┌──────────────────────────── HTTPS / WSS (443) ───────────────────────────┐
 Browser /      │                                                                          │
 Capacitor app ─┤  Nginx (TLS termination, static frontend, reverse proxy /api + /socket.io)│
                └──────────────┬───────────────────────────────────────────────────────────┘
                               │ HTTP + WebSocket (127.0.0.1:4000)
                     ┌─────────▼──────────┐        ┌──────────────┐
                     │ Node.js backend     │◄──────►│  MongoDB     │
                     │ Express REST API    │        └──────────────┘
                     │ Socket.IO signalling│
                     │ Room registry       │
                     │ (Phase 2: mediasoup │
                     │  workers in-process)│
                     └─────────┬──────────┘
                               │ (Phase 2) RTP over UDP/TCP 40000-49999 direct to clients
   Media (Phase 1, 1-to-1):  peer ◄──── DTLS-SRTP ────► peer          (direct, host/srflx)
                             peer ◄──► coturn (3478 / 5349, relay 49152-65535) ◄──► peer
   Media (via media server): client ◄──── DTLS-SRTP ────► mediasoup SFU (optionally via coturn)
```

* **Nginx** never carries media. It only proxies HTTPS and the Socket.IO WebSocket. Media goes either peer-to-peer, through coturn, or (Phase 2) to mediasoup's own UDP/TCP ports, which must be opened in the firewall separately.
* **Backend** is a single Node.js process per host. REST handles accounts and meeting records; Socket.IO handles live room state and signalling.
* **coturn** runs with the TURN REST API (`use-auth-secret`). The backend mints short-lived HMAC credentials per user; the shared secret never leaves the server.
* **MongoDB** stores users, refresh-token families, one-time tokens, meetings, attendance sessions and audit logs.

## 2. Meeting join flow

1. The client authenticates (access JWT in memory, rotating refresh token in an httpOnly cookie scoped to `/api/auth`).
2. `POST /api/meetings/:code/join` with optional password or invite token. The server checks status, password, rate limits, and returns:
   * a **join token**: a JWT valid for 2 minutes, bound to user + meeting, audience `meeting-join`;
   * ICE servers with **TURN credentials valid for `TURN_CREDENTIAL_TTL_SECONDS`**.
3. The client connects Socket.IO with its access token and emits `meeting:join { joinToken }`.
4. The server re-checks the meeting live, applies capacity, the waiting room, and host presence, then either admits the participant (`status: admitted`) or holds them in the waiting room (`status: waiting`). Hosts receive `waiting:updated` and can `waiting:admit` / `waiting:deny`. Every host action is authorised on the server against the room registry.
5. Once admitted, peers exchange SDP/ICE via `p2p:signal`, addressed by **user id**. The server only relays between two admitted members of the same room.

Participants never receive another user's credentials, socket ids, or internal room keys.

## 3. Media topology by phase

| Phase | Topology | Limit | Why |
|---|---|---|---|
| Server mode | Topology | Limit | When |
|---|---|---|---|
| `MEDIASOUP_ENABLED=false` | P2P WebRTC (deterministic initiator) + TURN fallback | teacher + 1 student | Hosts without UDP ports (e.g. Render); no recording |
| `MEDIASOUP_ENABLED=true` | mediasoup SFU relays the one-to-one call | teacher + 1 student | VPS deployments; enables server-side recording |

The mode is decided per server, not per meeting: one code path per deployment is easier to operate and server-side recording (Phase 4) needs media on the SFU anyway.

### mediasoup design (implemented)

- **Workers:** a fixed pool, one per CPU core by default (`MEDIASOUP_NUM_WORKERS`). Never unbounded. Each worker owns one **WebRtcServer**, so all of its transports share a single UDP+TCP port: the firewall needs only `MEDIASOUP_PORT_BASE … +N-1`.
- **Rooms:** one `Router` per meeting, created lazily on the least-loaded worker (max `MEDIASOUP_MAX_ROOMS_PER_WORKER`). Closed when the meeting ends.
- **Peers:** at most one send and one recv `WebRtcTransport`, one producer per source (`mic`, `camera`; `screen` reserved for Phase 3). Consumers start paused and are resumed by the client once wired, so the first keyframe isn't lost.
- **Simulcast:** camera publishes 3 layers (¼, ½, full; 150 k / 500 k / 1.2 Mbps). Each receiver asks for the layer its tile needs: spotlight = high, grid ≤ 4 = mid, larger grids and filmstrip = low.
- **Active speaker:** `ActiveSpeakerObserver` drives speaker view.
- **Security:** every `mediasoup:*` event resolves the room from the authenticated socket and checks membership. Transport, producer and consumer ids are only looked up inside the caller's own peer, so ids can't be used across users.
- **Resilience:** on a signalling blip, transports stay open during the grace period and the client re-syncs (`mediasoup:join` with the same session id). After a server restart or a crashed worker (replaced automatically, `mediasoup:reset`), clients rebuild transports and re-publish.
- **Bandwidth:** `maxIncomingBitrate` per send transport; the server's own congestion control and simulcast adapt the rest.

### Host controls (enforced on the server)

Mute the student (pauses their mic producer on the SFU; they may unmute again), remove (stored in `bannedUsers`, REST join then returns 403), lock (newcomers get 423), and per-class permissions for presenting, drawing and chat. **One student per class:** besides the host, only one member may be in the room; a second admission is refused with `meeting_full`, including when two students arrive before the host. Group-only controls (admit all, mute all, raise hand, "allow to speak") were removed.

## 3b. Classroom features (Phase 3)

- **Screen sharing:** one slot per room (`screen:start` claims it; the host may take over). The SFU accepts a `screen` producer only from the slot holder. In P2P mode a third transceiver carries the screen. Revoking student sharing, leaving, or the host's "Stop presentation" ends it and closes the producer.
- **Chat:** `chat:send` is validated (length, rate limit 8 burst / 1 per s, permission), stored in `chatmessages` when `saveChat` is on, and broadcast. `chat:history` serves late joiners and hydrates from MongoDB after a restart. The host can delete (soft delete, audited). Clients render messages as text; only http(s) links become clickable, with `noopener noreferrer nofollow`.
- **Whiteboard:** an ordered list of operations in normalised 0..1 coordinates (pen, highlighter, line, arrow, rectangle, ellipse, text, eraser), validated strictly. Finished operations are stored (≤ 5 000 per board) and persisted, debounced, to `whiteboards`. In-progress strokes are relayed as volatile `whiteboard:live` events and never stored. Undo/redo works on your own operations (`whiteboard:erase` is limited to the author or the host). Only the host opens or clears the board; students draw only when allowed.
- **Permissions:** `allowSelfUnmute`, `allowScreenShare`, `allowDrawing`, `chatMode` (`everyone`/`host`) live on the meeting and are changed with one `host:permissions` event (partial updates).

## 3c. Recording (Phase 4)

```
browser ─SRTP─▶ mediasoup Router ──DirectTransport consumers (in-process, no ports)──▶ Recorder (Node)
                                                         │  raw RTP, never re-encoded live
                                     ┌───────────────────┴────────────────────┐
                           per consenting mic: Ogg Opus            featured picture: VP8 IVF
                           (silence filled → aligned to t=0)       (key-frame gated, RTP-clock timestamps)
                                     └─────────────── manifest.json + timeline ┘
                                                         │ on stop (queued, one at a time)
                                    FFmpeg: normalise each picture track → overlay by timeline on a
                                    1280×720 canvas, amix voices → H.264/AAC MP4 (+faststart), poster JPEG
```

* **Why DirectTransport instead of PlainTransport→FFmpeg:** tests showed that FFmpeg's SDP/RTP input stalls `amix` when one input pauses (a muted mic) and exits after ~10 s without packets. Writing the RTP ourselves avoids both problems, needs no UDP ports, and costs almost no CPU while the class runs.
* **Consent:** `room.recording.consent` maps each user to `pending` / `accepted` / `declined`. The recorder only *consumes* streams of `accepted` users, so a decliner's media never reaches the recorder at all. The host's consent is implied by starting. Latecomers start as `pending`. Decisions are persisted on the Recording document (the consent ledger).
* **Picture choice:** presentation > host camera > active speaker (held at least 4 s) > anyone. Only the featured source's consumer is resumed. On a switch, the previous picture stays until the new source's first key frame arrives, so the film never flashes an empty frame.
* **Lifecycle:** the status goes `recording` → `processing` → `ready`, or `failed` (nothing captured, or an FFmpeg error) → `deleted`. Recording stops automatically when the class ends, when a media worker dies, or after `RECORDING_MAX_MINUTES`. On boot, `processing` jobs resume from their manifest and interrupted `recording` jobs are marked failed. An hourly sweep deletes files older than `RECORDING_RETENTION_DAYS`.
* **Access:**
  - Files live in `RECORDINGS_DIR`, never under the web root.
  - The host can always watch. Attendees and invitees can watch only when the host shares, and un-sharing takes effect on their next request. Admins get no implicit access.
  - `<video>` cannot send an Authorization header, so `POST /api/recordings/:id/playback` mints JWT links bound to the user and the recording, with HTTP Range streaming. Library posters use poster-only tokens that cannot stream the film.

## 3d. Invitations, calendar, class pages (Phase 4)

* `meetings.invitees` (lower-cased emails, ≤ 100). New invitees get an email with the invite link (it skips the password) and an RFC 5545 `.ics` (`METHOD:REQUEST`, 10-minute alarm). Invitees see the class in their lists and calendar, and skip the waiting room. The room lock still applies.
* `GET /api/meetings?scope=range&from&to` (≤ 62 days) feeds the month view. `GET /api/meetings/:code/calendar.ics` serves *Add to calendar*.
* `GET /api/meetings/:code/summary` returns the class page. Everyone who may see the class gets the meeting and its viewable recordings. Only the host also gets private notes (`PUT /:code/notes`), attendance, guests and the chat transcript.

## 4. Reliability behaviour (Phase 1)

* **ICE failure**: on `failed`, or `disconnected` for more than 4 s, the offering side fetches fresh ICE servers (`ice:refresh`) and runs an ICE restart.
* **Signalling drop**: Socket.IO reconnects automatically. The server keeps a dropped participant for `RECONNECT_GRACE_SECONDS` (default 20). Peers show "reconnecting" and keep the existing media session; if the client rejoins in time, the session continues and the attendance session is not split.
* **Same user, second device**: the newest connection replaces the old one, which receives `meeting:replaced`.
* **Server restart**: in-memory rooms are lost; clients reconnect, re-request a join token, and re-establish the call. Meetings left live with no activity are ended by the expiry job.

## 5. Data model (MongoDB)

| Collection | Key fields |
|---|---|
| users | name, email (unique), passwordHash (bcrypt 12), role (teacher/student/admin), emailVerified, status, teacherProfile, studentProfile |
| refreshtokens | user, tokenHash (sha256), family, expiresAt, revokedAt, replacedBy |
| onetimetokens | user, purpose (email_verify / password_reset), tokenHash, expiresAt, usedAt |
| meetings | code (unique, random), host, title, type, status, scheduledStart/End, startedAt/endedAt, lastActiveAt, settings {waitingRoom, passwordHash, maxParticipants, permissions…}, locked, bannedUsers, invitees, notes (host-only), inviteNonce |
| recordings | meeting, host, startedBy, title, status, startedAt/endedAt, durationSec, sizeBytes, file/thumbnail (relative, never serialised), shareWithParticipants, consent [{user, name, decision, at}], error |
| chatmessages / whiteboards | per-meeting chat log (soft delete) and board operations |
| attendances | meeting, user, role, joinedAt, leftAt, durationSec (one document per continuous session) |
| auditlogs | actor, action, targetType, targetId, ip, meta |

## 6. Security model (summary; see security.md)

* Meeting codes are 10 random letters (26¹⁰ ≈ 1.4 × 10¹⁴) from `crypto.randomInt`; lookups are rate limited per user and IP.
* Invite links carry an HMAC token derived from the meeting id and a rotatable nonce, so they can be revoked without touching the code.
* All host actions are checked on the server. Frontend hiding is cosmetic only.
* WebRTC media is always DTLS-SRTP encrypted in transit. In Phase 1 P2P calls, keys are negotiated between the two browsers. TURN only relays already-encrypted packets. In Phase 2, mediasoup **terminates** DTLS-SRTP, so media is encrypted in transit but **not end-to-end encrypted**. We do not claim E2EE.

## 7. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Project init, auth, dashboard, meeting create/join, waiting room, 1-to-1 WebRTC, Socket.IO signalling, coturn config, diagnostics | Implemented and tested here (see testing.md) |
| 2 | mediasoup SFU, host controls (mute/remove/lock/permissions), premium redesign (group features since removed: one-to-one only) | Implemented and tested here (see testing.md) |
| 3 | Screen share (SFU + P2P), chat (persisted, moderated), whiteboard (live strokes, undo/redo, persisted), attendance CSV, classroom permissions, landing page, sound cues | Implemented and tested here (see testing.md) |
| 4 | Consent-based recording (mediasoup → DirectTransport → per-track files → FFmpeg MP4), archive & signed playback, invitations + .ics, calendar, class pages (notes, attendance, transcript), dark-first shell | Implemented and tested here (see testing.md) |
| 5 | Admin dashboard, hardening, monitoring, Capacitor apps | Not started |
| 6 | Production deployment, load tests, multi-server, DR | Docs started (deployment.md) |
