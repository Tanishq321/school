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
   Media (Phase 2, groups):  client ◄──── DTLS-SRTP ────► mediasoup SFU (optionally via coturn)
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
| 1 | P2P WebRTC (perfect negotiation) + TURN fallback | 2 people per meeting (enforced on server, `P2P_MAX_PARTICIPANTS`) | 1-to-1 classes need no SFU; avoids routing media through our servers when unnecessary |
| 2 | mediasoup SFU for every meeting with more than 2 people (and optionally all meetings) | `maxParticipants` per meeting, 20 by design; workers capped to CPU cores | Mesh doesn't scale beyond 3–4 people; SFU sends each uplink once |

Phase 2 plan for mediasoup: one `Worker` per CPU core (capped by `MEDIASOUP_NUM_WORKERS`), rooms are assigned to the least-loaded worker, one `Router` per room, one send and one receive `WebRtcTransport` per participant, simulcast (3 layers) for camera, and `consumer.setPreferredLayers` driven by tile size. All mediasoup socket events are validated against socket → user → room membership. For multiple app instances, room → instance affinity is stored in Redis and the Socket.IO Redis adapter is used (Phase 6).

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
| meetings | code (unique, random), host, title, type, status, scheduledStart/End, startedAt/endedAt, lastActiveAt, settings {waitingRoom, passwordHash, maxParticipants}, inviteNonce |
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
| 2 | mediasoup SFU, group meetings, mute/remove/lock, grid & speaker layouts | Not started |
| 3 | Screen share, chat, whiteboard, attendance UI, teacher controls | Attendance *recording* exists from Phase 1; the rest is not started |
| 4 | Server-side recording (mediasoup → PlainTransport → FFmpeg/GStreamer), dashboards, calendar | Not started |
| 5 | Admin dashboard, hardening, monitoring, Capacitor apps | Not started |
| 6 | Production deployment, load tests, multi-server, DR | Docs started (deployment.md) |
