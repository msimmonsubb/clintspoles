#!/usr/bin/env bash
# Starts the pole site server and a free Cloudflare quick tunnel (Linux / macOS).
# Run from this folder:   ./start-tunnel.sh
#
# Needs: node and cloudflared (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
# The https://....trycloudflare.com address changes every time this script starts.
# It is printed here and written to tunnel-url.txt so you can copy it.

set -u
cd "$(dirname "$0")"
PORT="${PORT:-8080}"

for tool in node cloudflared; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing '$tool'. Install it first."; exit 1; }
done

PORT="$PORT" node server.js &
SERVER=$!
sleep 1
kill -0 "$SERVER" 2>/dev/null || { echo "server.js failed to start"; exit 1; }

: > tunnel.log
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate 2> tunnel.log &
TUNNEL=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null' EXIT INT TERM

echo "Waiting for Cloudflare to hand out a URL..."
URL=""
for i in $(seq 1 60); do
  sleep 1
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' tunnel.log | head -1)
  [ -n "$URL" ] && break
done
if [ -n "$URL" ]; then
  echo "$URL" > tunnel-url.txt
  echo
  echo "  Pole site is live at:  $URL"
  echo "  (also saved to tunnel-url.txt)"
  echo
  echo "  Leave this running. Ctrl+C stops the server and the tunnel."
else
  echo "cloudflared did not report a URL in 60 s. See tunnel.log"
fi
wait "$TUNNEL"
