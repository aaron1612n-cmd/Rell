#!/usr/bin/env bash
# Build and upload the game as one Worker module via the Cloudflare API.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
set -euo pipefail
npm run build
node scripts/make-worker.mjs
curl -sS -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/${WORKER_NAME:-rell}" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"dist-worker.mjs","compatibility_date":"2026-11-01"};type=application/json' \
  -F 'dist-worker.mjs=@dist-worker.mjs;type=application/javascript+module'
