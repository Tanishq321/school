# Security

## Implemented in Phase 1

| Area | Implementation |
|---|---|
| Passwords | bcrypt (cost 12), 8–72 bytes with letters + digits, constant-time compare with a dummy hash for unknown emails |
| Sessions | 15-min HS256 access JWT held in memory only; 30-day opaque refresh token in an `httpOnly; SameSite=Strict; Secure; Path=/api/auth` cookie, stored as SHA-256 in MongoDB, **rotated on every use**; reuse of a rotated token revokes the whole family |
| CSRF | SameSite=Strict + Origin allow-list check on cookie-authenticated endpoints (`/refresh`, `/logout`) |
| Email verification / reset | 32-byte single-use tokens, stored hashed, 24 h / 1 h expiry; reset revokes all sessions; forgot-password replies identically for unknown emails |
| RBAC | `teacher` / `student` self-register; `admin` only via the `create-admin` script; meeting creation needs teacher/admin + verified email |
| Meeting codes | 10 random letters (≈47 bits) from `crypto.randomInt`; lookups and joins rate limited per user (40 / 10 min) |
| Meeting passwords | bcrypt-hashed, never returned; invite links carry an HMAC token instead (rotatable without changing the code) |
| Room isolation | REST join issues a 2-minute **join token** bound to user + meeting; the socket must belong to the same user; every socket action re-checks membership and host status server-side; signalling is only relayed between two admitted members of the same room |
| Host controls | mute / mute-all pause the mic producer on the SFU; with self-unmute off the server refuses `resumeProducer` and forces new mic producers paused; removed users are stored on the meeting (REST 403, socket refused); lock returns 423 for newcomers. All checked against the live room, never the client's claim |
| SFU isolation | `mediasoup:*` events resolve the room from the socket; transport/producer/consumer ids are looked up only in the caller's own peer; one transport per direction, one producer per source |
| Socket hardening | handshake auth (JWT), zod-validated payloads with size caps, per-socket token-bucket rate limits, 128 KB max message |
| TURN | coturn REST-API credentials (HMAC-SHA1, default 3 h TTL, refreshed on ICE restart); secret never leaves the server; relaying into private ranges denied; per-user and total quotas |
| HTTP | Helmet (CSP without inline scripts, nosniff, frame-ancestors none, HSTS via Nginx), Permissions-Policy for camera/mic/display-capture, CORS allow-list, 100 KB JSON limit, `x-powered-by` off |
| Rate limiting | global 300/min/IP; auth 20/15 min/IP; email sends 5/h/IP; meeting lookups 40/10 min/user |
| Input validation | zod on every REST body/query/param and socket payload; strict objects reject unknown fields |
| Audit logs | `auditlogs`: register, login, failed login, refresh-token reuse, password reset, meeting create/update/start/end, admit/deny, bad meeting password |
| Secrets | only in backend `.env` (validated at boot, min 32 chars); the frontend bundle contains no secrets; production boot fails without SMTP/TURN/https |

## Media encryption: what is and isn't protected

- **All WebRTC media is encrypted in transit** with DTLS-SRTP. Browsers won't send unencrypted media.
- **Phase 1 (1-to-1, peer-to-peer):** DTLS keys are negotiated directly between the two browsers. When the call is relayed, coturn only forwards already-encrypted packets and cannot decrypt them. The signalling server, however, relays the SDP containing the DTLS fingerprints. A compromised signalling server could in theory perform a man-in-the-middle attack by swapping fingerprints. We don't verify fingerprints out of band, so this is **not** end-to-end encryption in the strict sense.
- **Phase 2+ (SFU):** mediasoup terminates DTLS-SRTP. Media is decrypted on our server to be forwarded. Group calls are encrypted in transit but **not end-to-end encrypted**.
- We make no E2EE claims in the UI. The lobby says "encrypted in transit". True E2EE for SFU calls would need Insertable Streams / SFrame with client-side key management. It isn't planned yet.
- Signalling and the API are protected by TLS (HTTPS/WSS) via Nginx.

## Operational guidance

- Rotate `TURN_SECRET` by setting the new value in both coturn and the backend, then restart both. Existing calls keep their allocations until expiry.
- Rotating `JWT_ACCESS_SECRET` logs everyone out within 15 minutes. Refresh tokens are unaffected.
- Keep MongoDB, Node (4000) and coturn metrics (9641) bound to localhost.
- Review `auditlogs` for `auth.refresh_reuse_detected` and bursts of `auth.login_failed` / `meeting.join_bad_password`.

## Not yet implemented (planned)

- Account lockout / CAPTCHA after repeated failures (rate limits only today) → Phase 5
- Admin management of users, reports and logs UI → Phase 5
- Secure file uploads → arrive with features that need uploads (Phase 3+)
- 2FA for teachers/admins → Phase 5
- Redis-backed rate limits for multi-instance deployments → Phase 6
