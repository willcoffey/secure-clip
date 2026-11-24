#!/bin/sh
set -e
if [ -f .env ]; then set -a; . ./.env; set +a; fi

if [ -z "$SECLIP_SALT" ]; then
  echo "error: SECLIP_SALT not set. Generate one with:" >&2
  echo '  echo "SECLIP_SALT=$(head -c 20 /dev/urandom | base32 | tr A-Z a-z)" >> .env' >&2
  exit 1
fi

vite build frontend

wrangler deploy --config backend/wrangler.toml \
  --name "$SECLIP_SALT" --var "SECLIP_SALT:$SECLIP_SALT"

