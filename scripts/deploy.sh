#!/bin/sh
set -e
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -z "$SECLIP_SERVER_ID" ] || [ -z "$SECLIP_SERVER_PATH" ]; then
  echo "error: SECLIP_SERVER_ID and SECLIP_SERVER_PATH must be set. Generate each with:" >&2
  echo '  head -c 20 /dev/urandom | base32 | tr A-Z a-z' >&2
  exit 1
fi

vite build frontend

wrangler deploy --config backend/wrangler.toml \
  --name "$SECLIP_SERVER_ID" --var "SECLIP_SERVER_PATH:$SECLIP_SERVER_PATH"

