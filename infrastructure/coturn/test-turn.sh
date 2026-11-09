#!/usr/bin/env bash
# TURN smoke test from any machine *outside* the server's network.
#   ./test-turn.sh turn.example.com <TURN_SECRET> [userid]
# Mints a REST-API credential exactly like the backend does and asks coturn for a relay
# allocation using turnutils_uclient (ships with coturn). Success = "allocate" lines + 0 errors.
set -euo pipefail
HOST=${1:?turn host}
SECRET=${2:?turn secret}
USERID=${3:-turntest}
EXPIRY=$(( $(date +%s) + 600 ))
USERNAME="${EXPIRY}:${USERID}"
PASSWORD=$(printf '%s' "$USERNAME" | openssl dgst -binary -sha1 -hmac "$SECRET" | base64)
echo "Testing UDP relay on $HOST:3478 as $USERNAME"
turnutils_uclient -y -n 5 -c -u "$USERNAME" -w "$PASSWORD" "$HOST"
echo "Testing TCP transport on $HOST:3478"
turnutils_uclient -t -y -n 5 -c -u "$USERNAME" -w "$PASSWORD" "$HOST"
echo "Done. For a browser-level check, open https://<app>/diagnostics while signed in."
