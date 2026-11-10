# Deploying to a Linux VPS

Target: one Ubuntu 24.04 VPS running Nginx, Node (PM2), MongoDB and coturn. Recommended starting size for Phase 1: 2 vCPU / 4 GB RAM. TURN relaying is bandwidth-bound: each relayed 1-to-1 call costs about 2 × 1.5–2.5 Mbps.

Two DNS names pointing at the server's **public IP**:
- `class.example.com`: web app + API
- `turn.example.com`: coturn (a separate name lets you move TURN to its own box later)

> **Media does not go through Nginx.** A normal HTTP reverse proxy is not enough for WebRTC. Browsers must reach coturn directly on UDP/TCP 3478, TCP 5349 and the UDP relay range. In Phase 2 they must also reach mediasoup's RTP ports. Those are opened in the firewall, not proxied.

## 1. Base system

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install nginx certbot python3-certbot-nginx coturn ufw build-essential git
sudo adduser --system --group --home /var/www/video-platform deploy
sudo mkdir -p /var/log/video-platform && sudo chown deploy: /var/log/video-platform
```

## 2. Node.js 22 LTS + PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo npm i -g pm2@latest
node -v   # >= 22.12
```

## 3. MongoDB

Install MongoDB Community 8.0 from the official repository (https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/), then:

```bash
sudo systemctl enable --now mongod
mongosh <<'EOF'
use admin
db.createUser({ user: "root", pwd: passwordPrompt(), roles: ["root"] })
use videoplatform
db.createUser({ user: "videoapp", pwd: passwordPrompt(), roles: [{ role: "readWrite", db: "videoplatform" }] })
EOF
```

In `/etc/mongod.conf` keep `net.bindIp: 127.0.0.1` and add `security.authorization: enabled`, then `sudo systemctl restart mongod`.

## 4. Application

```bash
sudo -u deploy git clone <your-repo> /var/www/video-platform
cd /var/www/video-platform
sudo -u deploy bash -c 'cd backend && npm ci --omit=dev'
sudo -u deploy bash -c 'cd frontend && npm ci && npm run build'
sudo -u deploy cp .env.example backend/.env && sudo -u deploy chmod 600 backend/.env
sudo -u deploy nano backend/.env   # fill every CHANGE_ME (see below)
```

Required production values: `APP_URL=https://class.example.com`, `TRUST_PROXY=1`, `MONGODB_URI` with the `videoapp` user, three different random secrets (`JWT_ACCESS_SECRET`, `MEETING_TOKEN_SECRET`, `INVITE_SECRET`), SMTP settings, `TURN_URLS`, `STUN_URLS`, and `TURN_SECRET`. The backend refuses to start in production if SMTP, TURN or https are missing.

```bash
sudo -u deploy pm2 start infrastructure/deployment/ecosystem.config.cjs
sudo -u deploy pm2 save
sudo env PATH=$PATH pm2 startup systemd -u deploy --hp /var/www/video-platform
curl -s http://127.0.0.1:4000/api/health   # {"status":"ok","db":"up",...}
sudo -u deploy bash -c 'cd backend && ADMIN_EMAIL=you@example.com ADMIN_PASSWORD="<12+ chars>" npm run create-admin'
```

Run **one** backend instance (fork mode). Live room state is in-process until Phase 6 adds Redis.

## 5. TLS certificates

```bash
sudo certbot certonly --nginx -d class.example.com
sudo certbot certonly --standalone -d turn.example.com --pre-hook "systemctl stop nginx" --post-hook "systemctl start nginx"
# coturn runs as 'turnserver' and must be able to read the TURN cert:
sudo setfacl -R -m u:turnserver:rX /etc/letsencrypt/live /etc/letsencrypt/archive
echo 'systemctl restart coturn' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/coturn.sh && sudo chmod +x $_
```

## 6. Nginx

```bash
sudo cp infrastructure/nginx/video-platform.conf /etc/nginx/sites-available/
sudo sed -i 's/class.example.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/video-platform.conf
sudo ln -s /etc/nginx/sites-available/video-platform.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 7. coturn

```bash
sudo cp infrastructure/coturn/turnserver.conf /etc/turnserver.conf
sudo nano /etc/turnserver.conf     # external-ip, static-auth-secret (= TURN_SECRET), realm, cert paths
sudo sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo mkdir -p /var/log/turnserver && sudo chown turnserver: /var/log/turnserver
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

`external-ip` must be the public IP. On clouds with 1:1 NAT (AWS, GCP, Azure) use `external-ip=PUBLIC/PRIVATE`. A wrong value is the #1 cause of "connects on Wi-Fi, fails on mobile data".

## 8. Firewall

Also open the same ports in your provider's cloud firewall or security group.

```bash
sudo bash infrastructure/deployment/firewall.sh
```

| Port | Proto | Purpose |
|---|---|---|
| 22 | TCP | SSH |
| 80, 443 | TCP | HTTPS, WSS signalling |
| 3478 | UDP + TCP | STUN / TURN |
| 5349 | TCP | TURN over TLS (networks that only allow TLS) |
| 49152–65535 | UDP | TURN relay range (`min-port`/`max-port`) |
| 40000–40015 | UDP + TCP | mediasoup SFU: one port per worker (`MEDIASOUP_PORT_BASE` + worker index) |

## 8b. mediasoup (group classes)

In `backend/.env` set:

```ini
MEDIASOUP_ENABLED=true
MEDIASOUP_ANNOUNCED_ADDRESS=<server public IP>
MEDIASOUP_PORT_BASE=40000
```

mediasoup ships a prebuilt worker for Linux x64; if your platform needs a build, install `python3 make g++` first. On startup the log shows `mediasoup workers started` with the port range, and `/api/health` reports `"mediaMode":"sfu"`. If coturn runs on the same host, add `allowed-peer-ip=<server private IP>` to `turnserver.conf` so relayed clients can reach the SFU. Size: about 1 vCPU per ~40–60 concurrent forwarded video streams; a 20-person class with simulcast is comfortable on 2 vCPU.

## 9. TURN test procedure

1. From a machine **outside** the server's network (e.g. your laptop on mobile hotspot):
   ```bash
   sudo apt install coturn-utils   # or coturn; provides turnutils_uclient
   ./infrastructure/coturn/test-turn.sh turn.example.com '<TURN_SECRET>'
   ```
   Expect `Total lost packets 0` for both UDP and TCP. `Cannot complete Allocation` means the secret or realm is wrong; a timeout means the firewall or `external-ip` is wrong.
2. Sign in to the app and open **Connection test** (`/diagnostics`). Every row should be green, including **TURN relay allocation** and **Media through relay**. The last row connects two peers in your browser that may only talk via TURN.
3. Optional: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/. Add `turn:turn.example.com:3478` with a credential from step 1 and confirm `relay` candidates appear.

## 10. Real-world call check (required before go-live)

On two **physical devices on different networks** (e.g. laptop on home Wi-Fi + phone on mobile data):
1. Teacher creates a meeting; student opens the invite link and is admitted.
2. Both see and hear each other; the top bar shows the path (`Good` = direct, `· relayed` = TURN).
3. Repeat with **Check devices → Always use relay server** on both sides.
4. Toggle airplane mode on the phone for ~5 s: the call should recover without rejoining.

## 11. Logging & monitoring

- App logs: `pm2 logs video-platform-api` (JSON, pino). Install log rotation with `pm2 install pm2-logrotate`.
- coturn: `/var/log/turnserver/turnserver.log`; Prometheus metrics on `127.0.0.1:9641`.
- Health: `GET /api/health` (returns 503 if MongoDB is down). Point an uptime checker at `https://class.example.com/api/health`.
- Audit trail: `auditlogs` collection (logins, failed logins, meeting create/start/end, admits/denies).

## 12. Backups

```bash
sudo install -m 600 -o deploy /dev/null /etc/video-platform/backup.env   # MONGODB_URI=...
crontab -u deploy -e
# 15 2 * * * set -a; . /etc/video-platform/backup.env; /var/www/video-platform/infrastructure/deployment/backup-mongo.sh >> /var/log/video-platform/backup.log 2>&1
```

Copy archives off the server. Test a restore every month.

## 13. Updates and restarts

```bash
cd /var/www/video-platform && sudo -u deploy git pull
sudo -u deploy bash -c 'cd backend && npm ci --omit=dev' && sudo -u deploy bash -c 'cd frontend && npm ci && npm run build'
sudo -u deploy pm2 reload video-platform-api
```

During a restart, ongoing 1-to-1 calls keep their media (it's peer-to-peer). Clients reconnect signalling automatically and reclaim their seats; this is covered by the E2E suite. Restart order after a reboot is handled by systemd: `mongod` → `coturn` → `pm2-deploy` → `nginx`.
