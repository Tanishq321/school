# Running Scholé with Docker

One server, four containers: the app (API, realtime, media server and web app in one image), MongoDB,
coturn (the TURN relay) and Caddy (HTTPS with automatic certificates).

> **Status:** the compose file validates (`docker compose config`). The image could not be built in the
> environment this was written in (no access to Docker Hub), so build and test it once on your server
> before relying on it. The manual guide in [`docs/deployment.md`](../../docs/deployment.md) is tested.

## Requirements

- A Linux server with a public IPv4 address (2 vCPU / 4 GB is a comfortable start), Docker Engine 24+.
- DNS: an `A` record for your domain (e.g. `class.example.com`) pointing at the server.
- Firewall open for: TCP 80 and 443 (Caddy), UDP+TCP 3478 (TURN), UDP 49152–65535 (TURN relay),
  UDP+TCP 40000–40015 (mediasoup, one port per worker). See `infrastructure/deployment/firewall.sh`.

## First start

```bash
git clone <your repository> schole && cd schole
cp infrastructure/docker/.env.example infrastructure/docker/.env
chmod 600 infrastructure/docker/.env
nano infrastructure/docker/.env                 # every CHANGE_ME; secrets from: openssl rand -base64 48
nano infrastructure/docker/turnserver.conf      # public IP, the same TURN_SECRET, your domain
docker compose up -d --build
docker compose logs -f app                      # wait for "API listening" and "mediasoup workers started"
docker compose exec -e ADMIN_EMAIL=you@example.com -e ADMIN_PASSWORD='a long passphrase' app node src/scripts/createAdmin.js
```

Then open `https://<your domain>`, sign in as the administrator and turn on two-step sign-in
(the console stays closed until you do, because `ADMIN_REQUIRE_2FA=true`).

## Updating

```bash
git pull && docker compose up -d --build app   # MongoDB, coturn and Caddy keep running
```

Live classes reconnect on their own: clients hold their seat for `RECONNECT_GRACE_SECONDS` (20 s).
Deploy outside lesson hours anyway.

## Backups

Nightly, from the host's crontab (`crontab -e`):

```cron
15 2 * * *  cd /srv/schole && docker compose exec -T app node src/scripts/backup.js dump --out /data/backups/schole-$(date -u +\%Y\%m\%d).ndjson.gz
45 2 * * 0  cd /srv/schole && docker compose exec -T app node src/scripts/backup.js drill
```

Then copy `/data/backups` off the server (object storage, another machine). A backup on the same
disk is not a backup. Recordings live in the `app-data` volume under `/data/recordings`; copy those
too if you keep them. The full recovery procedure is in [`docs/operations.md`](../../docs/operations.md).
