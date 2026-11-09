# Test deployment: GitHub → Render (+ optional Vercel)

Good for **testing Phase 1** with real people on real devices. It isn't the production plan:

| Piece | Where | Why |
|---|---|---|
| Code | GitHub | Render and Vercel auto-deploy on every push |
| Database | MongoDB Atlas (free cluster) | Render doesn't host MongoDB |
| Backend (API + Socket.IO) | Render web service | supports WebSockets |
| Frontend | Render (same service) **or** Vercel | your choice, see Option A / B |
| TURN (coturn) | a small VPS | Render and Vercel accept only HTTP(S) on 80/443, with no UDP, so coturn can't run there |
| mediasoup SFU (Phase 2) | a VPS | same reason (needs a UDP port range). Plan to move off Render for Phase 2 |

## 0. Push to GitHub

Create an **empty private** repository on github.com (no README), e.g. `video-platform`, then from the unzipped project folder:

```bash
git remote add origin https://github.com/<your-username>/video-platform.git
git branch -M main
git push -u origin main
```

`.env` files are git-ignored. Never commit secrets.

## 1. MongoDB Atlas

1. Create a free cluster at https://cloud.mongodb.com.
2. **Database Access** → add a user with a strong password (role: read/write to any database).
3. **Network Access** → add `0.0.0.0/0`. Render's free instances don't have fixed outbound IPs, so you must allow all addresses. This makes the strong password essential.
4. **Connect → Drivers** → copy the URI and add a database name:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/videoplatform?retryWrites=true&w=majority`

## 2a. Option A (recommended for testing): everything on Render

One service serves the API, the WebSocket and the website from the same address. Login cookies and sockets need no extra setup.

1. Render dashboard → **New → Blueprint** → connect GitHub → pick the repo. Render reads `render.yaml`.
2. It asks for the `sync: false` values:
   - `MONGODB_URI`: from step 1 (required)
   - `TURN_URLS`, `TURN_SECRET`, `STUN_URLS`: see section 3 (leave empty to start)
   - `SMTP_*`, `MAIL_FROM`: optional (see "Email" below)
3. Deploy. Open `https://kaksha-58u1.onrender.com`. `APP_URL` defaults to Render's own URL automatically.
4. Check `https://kaksha-58u1.onrender.com/api/health` → `{"status":"ok","db":"up",...}`.

## 2b. Option B: frontend on Vercel, backend on Render

1. Deploy the backend on Render as in Option A, then in its **Environment** settings change:
   - `SERVE_FRONTEND_DIST` → delete it (Vercel serves the site)
   - `APP_URL` = `https://<your-app>.vercel.app`
   - `CORS_ORIGINS` = `https://<your-app>.vercel.app`
   - `RATE_LIMIT_MULTIPLIER` = `5` (API calls arrive via Vercel's proxy, so many users may appear to share a few IPs)
   - optionally change the build command to just `cd backend && npm ci --omit=dev`
2. In `frontend/vercel.json`, replace all three `kaksha-58u1` with your Render service name. Commit and push.
3. Vercel → **Add New → Project** → import the repo:
   - **Root Directory:** `frontend`
   - **Environment Variable:** `VITE_SOCKET_URL` = `https://kaksha-58u1.onrender.com`
4. Deploy and open `https://<your-app>.vercel.app`.

How it fits together: `/api/*` is forwarded by Vercel to Render, so the browser sees one origin and the secure login cookie keeps working. Socket.IO connects **directly** to Render; it authenticates with the access token, so no cookie is needed. The automated test suite runs exactly this layout (`E2E_SPLIT=1 node run-e2e.mjs`).

Limitation: Vercel **preview** deployments get different URLs that aren't in `CORS_ORIGINS`. Test on the production Vercel URL, or add the preview URL too.

## 3. TURN: required for calls across many real networks

Without TURN, about 10–20% of connections fail, typically mobile data (carrier NAT), school/office networks and strict firewalls. Options:

1. **Own coturn on a small VPS** (matches the project rules). Any 1 vCPU VPS works; Oracle Cloud's Always Free tier is an option. Follow [deployment.md §7–9](deployment.md) for coturn, firewall and test only. You don't need Node or MongoDB on it. Then set on Render:
   ```
   STUN_URLS=stun:turn.yourdomain.com:3478
   TURN_URLS=turn:turn.yourdomain.com:3478?transport=udp,turn:turn.yourdomain.com:3478?transport=tcp
   TURN_SECRET=<same as static-auth-secret in turnserver.conf>
   ```
2. **No TURN, STUN only (quick smoke test).** Leave `TURN_*` empty. Calls on the same Wi-Fi, or between typical home networks, often work. Mobile data often won't. STUN also needs UDP, so it can't run on Render either. A public STUN server would be a third-party dependency (it only tells browsers their public address and never carries media). Use one only temporarily, if at all.

After setting TURN, open **Connection test** in the app. "TURN relay allocation" and "Media through relay" should be green.

## 4. Email

With `REQUIRE_EMAIL_VERIFICATION=false` (the blueprint default), people can use the app without verifying. Password-reset emails still need SMTP. Any SMTP provider works (Brevo, Mailgun, or Gmail with an app password: `smtp.gmail.com`, port 587). After setting `SMTP_HOST/USER/PASS/MAIL_FROM`, you can set `REQUIRE_EMAIL_VERIFICATION=true`. Without SMTP, reset links appear in Render's **Logs** tab as `[dev-mail]`.

## 5. Free-tier behaviour to expect

- The Render service **sleeps after 15 minutes** without HTTP or WebSocket traffic. The first visit afterwards takes about a minute. An ongoing call keeps it awake (Socket.IO pings every 10 s).
- Render may restart free instances at any time, and every deploy restarts the backend. Ongoing 1-to-1 calls keep their audio/video (it's peer-to-peer), and both sides reconnect signalling automatically. This is covered by the E2E restart test.
- One instance only: don't scale the Render service beyond 1 (live room state is in memory until Phase 6).

## 6. What to test on real devices

Use two real devices on **different networks** (e.g. laptop on Wi-Fi + phone on mobile data):
1. Teacher account creates a class → copy invite → student opens the link on the phone → admit.
2. Video/audio both ways; check the top-right badge (`Good` = direct, `· relayed` = TURN).
3. Mute, camera off/on, switch to the rear camera on the phone.
4. Toggle airplane mode on the phone for ~5 s → the call should recover by itself.
5. Teacher → Leave → **End class for everyone** → Dashboard → Recent → **Attendance**.
6. Repeat with **Check devices → Always use relay server** on both (needs TURN).
