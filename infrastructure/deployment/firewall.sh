#!/usr/bin/env bash
# UFW rules for a single-box deployment (web + API + coturn [+ mediasoup in Phase 2]).
# Review before running. Run as root.
set -euo pipefail

ufw default deny incoming
ufw default allow outgoing

ufw allow OpenSSH
ufw allow 80/tcp          # ACME challenges + redirect to https
ufw allow 443/tcp         # HTTPS + Socket.IO (WSS)

# coturn
ufw allow 3478/udp        # STUN/TURN over UDP
ufw allow 3478/tcp        # TURN over TCP
ufw allow 5349/tcp        # TURN over TLS (turns:)
ufw allow 49152:65535/udp # TURN relay ports (min-port..max-port in turnserver.conf)

# Phase 2 (mediasoup) — uncomment when the SFU is deployed; must match MEDIASOUP_MIN/MAX_PORT
# ufw allow 40000:49999/udp
# ufw allow 40000:49999/tcp

# MongoDB (27017), Node (4000) and coturn metrics (9641) stay bound to 127.0.0.1: never open them.
ufw --force enable
ufw status verbose
