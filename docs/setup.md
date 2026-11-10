# Local development setup

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22.12+ (tested 22.23) | backend uses `process.loadEnvFile`, ESM |
| MongoDB | 7.x or 8.x | any MongoDB-compatible server works for dev; production should be real MongoDB |
| coturn | 4.6+ | optional locally; needed to test relay mode |
| Chrome / Edge / Firefox | current | camera & mic require `https://` or `http://localhost` |

Pinned dependency versions live in each `package.json` (no `^` ranges) and in the lockfiles:
express 5.3, socket.io 4.8.4 (server + client), mongoose 9.12, jsonwebtoken 9.0.3, bcrypt 6.0,
helmet 8.3, express-rate-limit 8.7, zod 4.6, react 19.3, react-router 7.18, vite 8.3, tailwindcss 4.3.
`socket.io` and `socket.io-client` must stay on the same minor version.

## 1. Database

```bash
# Option A: real MongoDB (recommended), e.g. Docker
docker run -d --name vp-mongo -p 127.0.0.1:27017:27017 mongo:8
```

## 2. Backend

```bash
cd backend
npm ci
cp ../.env.example .env
```

Edit `.env` for development:

```ini
NODE_ENV=development
APP_URL=http://localhost:5173
MONGODB_URI=mongodb://127.0.0.1:27017/videoplatform
JWT_ACCESS_SECRET=<random 48+ chars>
MEETING_TOKEN_SECRET=<random 48+ chars>
INVITE_SECRET=<random 48+ chars>
SMTP_HOST=            # empty in dev: emails are printed to the backend log
TURN_URLS=            # empty = STUN-less local calls; see "TURN locally" below
```

```bash
npm run dev           # http://127.0.0.1:4000, restarts on change
npm run create-admin  # ADMIN_EMAIL=... ADMIN_PASSWORD=... (admin accounts can't self-register)
```

To try **recording** locally: install `ffmpeg` (with libx264), then set `MEDIASOUP_ENABLED=true`, `MEDIASOUP_LISTEN_IP=127.0.0.1` and `RECORDING_ENABLED=true`. Recordings land in `./data/recordings`. Invitation emails (with the `.ics`) are also printed to the log when SMTP is empty.

Without SMTP, the verification and reset links appear in the backend log as `[dev-mail]`. Open the link to verify. To skip verification entirely while developing, set `REQUIRE_EMAIL_VERIFICATION=false`.

## 3. Frontend

```bash
cd frontend
npm ci
npm run dev           # http://localhost:5173 (proxies /api and /socket.io to :4000)
```

To test with two "devices" on one machine, use two different browsers or a normal + private window (separate cookies), signed in as two different users.

## 4. TURN locally (optional)

```bash
turnserver -c infrastructure/coturn/turnserver.local-test.conf
```

Then in `backend/.env`:

```ini
TURN_URLS=turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp
STUN_URLS=stun:127.0.0.1:3478
TURN_SECRET=e2e-turn-secret-0123456789abcdef0123456789
```

In the meeting lobby, open **Check devices → Always use relay server** to force media through TURN. The top bar then shows "· relayed". The **Connection test** page (`/diagnostics`) runs a relay loopback test in the browser.

## 5. Testing from a phone on your LAN

Browsers only allow the camera on `https://` (or localhost), so a phone can't use `http://192.168.x.x:5173`. Use one of:
- a tunnel with TLS (e.g. `cloudflared tunnel --url http://localhost:5173`), and add that origin to `CORS_ORIGINS` and `APP_URL`;
- a local CA (`mkcert`) and Vite `server.https`.

## 6. Tests

See [testing.md](testing.md).
