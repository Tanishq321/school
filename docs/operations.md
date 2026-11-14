# Operations: backups, recovery and capacity

## What to protect

| Data | Where | How it is backed up |
| --- | --- | --- |
| Accounts, classes, lesson notes, homework, attendance, chat, audit log | MongoDB | `npm run backup` (below), or `mongodump` |
| Recordings (video files) | `RECORDINGS_DIR` on disk | file copy (rsync / object storage) |
| Secrets (`.env`) | the server | your password manager. **Losing `TWO_FACTOR_ENC_KEY` disables every authenticator** |

## Backups

`backend/src/scripts/backup.js` writes a compressed logical backup with the MongoDB driver the app
already uses, so it runs anywhere the app runs (Atlas, a VPS, Docker) without extra tools. The file is
gzip of canonical Extended JSON: ObjectIds, dates and binary values round-trip exactly, and every
index is recorded. Files are created readable by their owner only: they contain personal data.

```bash
cd backend
npm run backup -- --out /var/backups/schole/schole-$(date -u +%Y%m%dT%H%MZ).ndjson.gz
```

`mongodump` (see `infrastructure/deployment/backup-mongo.sh`) is an equally good choice where the
MongoDB database tools are installed. Whichever you use, copy the files off the server.

**Retention suggestion:** 14 daily, 8 weekly, 12 monthly. Recordings follow `RECORDING_RETENTION_DAYS`.

## The restore drill (run it weekly)

A backup you have never restored is a hope, not a backup. The drill takes a fresh backup, restores
it into a scratch database on the same server, compares every collection (document count, a SHA-256
over all documents in `_id` order, and the index set), prints a table, drops the scratch database and
exits non-zero on any difference, so cron or your monitoring can alert on it.

```bash
npm run backup:drill            # add -- --keep to leave the scratch database for inspection
```

Tested results (development server, FerretDB):

| Database | Collections | Documents | Compressed | Time | Result |
| --- | --- | --- | --- | --- | --- |
| demo (`npm run seed:demo`) | 10 | 43 | 4.4 KiB | 0.2 s | identical |
| after the load test | 10 | 4,517 | 213 KiB | 2.8 s | identical |

Writes made while the drill runs show up as differences. Run it at a quiet hour, or point
`MONGODB_URI` at a secondary/replica.

## Recovery runbook

Targets: **RPO 24 h** (nightly backups; use Atlas continuous backup or a replica set for less) and
**RTO about 1 h** for a single server.

1. **Decide what failed.** App only (bad deploy) → roll back the code: `git checkout <previous tag>`
   and restart. Do not touch the database. Database lost or corrupted → continue.
2. **Stop writes.** Stop the app (`pm2 stop all` or `docker compose stop app`) so nothing writes
   to a half-restored database.
3. **Fetch the newest good backup** from off-server storage. Check it: `gunzip -t file.ndjson.gz`.
4. **Restore into a new database first**, never over the damaged one:
   ```bash
   npm run restore -- --in schole-YYYYMMDD.ndjson.gz --to-db schole_restored
   ```
   Spot-check it with `mongosh`: users count, the latest classes.
5. **Switch over.** Point `MONGODB_URI` at `schole_restored` (or rename databases) and start the app.
   Keep the damaged database until you are sure nothing else is needed from it.
6. **Sign everyone in again.** Refresh tokens in the backup may be up to a day old; they still work
   and expire normally. If the incident was a breach, rotate `JWT_ACCESS_SECRET` and revoke every
   session from the admin console instead.
7. **Recordings:** restore `RECORDINGS_DIR` from its copy. A recording whose file is missing shows as
   unavailable; the rest of the class page is unaffected.
8. **Write it down:** what failed, how long recovery took, what to change. Then run the drill.

Restoring over an existing database requires `--drop` and replaces those collections: use it only on
a scratch or already-abandoned database.

## Capacity: signalling load test

`npm run load:signalling -- --url <api> --pairs <n> --seconds <s> --rate <signals per second> --pid <server pid>`
creates real accounts, so run it against a disposable server started with
`REQUIRE_EMAIL_VERIFICATION=false` and a high `RATE_LIMIT_MULTIPLIER`.

Measured on a 2-vCPU development VM (the load generator, the API and the database on the same
machine), Node 22, P2P mode, 10 signalling messages a second per class (far above a real class, which
sends a few dozen during connection set-up and is then almost silent):

| Classes | Sockets | Relayed messages | Delivered | Relay latency p50 / p95 / p99 | API CPU | API memory |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 100 | 9,931 in 20 s | 100 % | 0.4 / 0.8 / 2.1 ms | – | – |
| 150 | 300 | 42,663 in 30 s | 100 % | 0.4 / 0.8 / 1.8 ms | 28 % of one core | 169 MB |

**Joins:** in these runs every class joined in the same instant (150 at once). Joining writes to the
database, and the development database here is FerretDB on SQLite, which allows one writer at a time.
Joins queued for up to ~55 s and 7 of 150 failed with "database is locked". That measures the test
database, not MongoDB. Measure joins again against your real MongoDB before quoting a number. Real
classes start spread over minutes, not in one instant.

Media never passes through signalling: P2P media flows browser to browser (or through coturn), and
SFU media through mediasoup, whose capacity is set by CPU and bandwidth (see `docs/deployment.md`).

## Running more than one app server (not built yet: the design)

Today one Node process holds every live room in memory. That carries hundreds of simultaneous
one-to-one classes on a small server (above). To go beyond one server, or to survive a server loss
without dropping live classes:

1. **Sticky sessions per class.** Route each class to one app server (e.g. Nginx `hash $arg_code` on
   the join, or a lookup table), so both people in a class share a process. This keeps the in-memory
   room model unchanged, and it is the cheapest step.
2. **Socket.IO Redis adapter** (`@socket.io/redis-adapter`) so events reach sockets on any server,
   plus room state (members, waiting room, recording state) moved to Redis.
3. **mediasoup across servers:** each class's router lives on one media server. The app records
   which server and hands clients that server's address. Recording runs on the same server.
4. **Background jobs:** the reminder job already claims work with a unique key, so it is safe to run
   on every server. The meeting-expiry and recording-retention sweeps are idempotent.
5. **MongoDB as a replica set** (Atlas, or three nodes) for failover and point-in-time backups.
