#!/usr/bin/env bash
# scripts/dev.sh — formalizes the local-dev harness already documented in
# CLAUDE.md's Working Conventions (scratch SQLite DB, throwaway SECRET_KEY,
# backend on 8850 / frontend on 8851, API_BASE/WS_ORIGIN pointed at the local
# backend instead of production) as one runnable command instead of hand-
# editing next.config.js / lib/api.ts before every local session and
# reverting after.
#
# Usage: scripts/dev.sh [feature-name]
#   feature-name — used only to name the scratch DB (smash_test_<name>.db);
#                  defaults to "dev". Matches the per-feature scratch-DB
#                  convention in CLAUDE.md.
#
# What this does NOT cover: web/public/*'s legacy pages read API_BASE/
# WS_ORIGIN from their own hardcoded js/auth.js + js/api.js (no build step,
# no env vars, by design -- see CLAUDE.md's Frontend conventions). Regular
# API calls from those pages still reach this local backend, since they go
# through next.config.js's /api/* rewrite (now env-driven below) -- only
# their WebSocket connections keep hitting production. If a change needs a
# legacy page's *websocket* traffic against this local backend, temporarily
# edit WS_ORIGIN in those two files by hand and revert before wrapping up,
# per the standing convention -- that one case doesn't have a scripted path.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FEATURE="${1:-dev}"
DB_FILE="smash_test_${FEATURE}.db"
BACKEND_PORT=8850
FRONTEND_PORT=8851

echo "Backend:  http://127.0.0.1:${BACKEND_PORT}  (DB: ${DB_FILE}, scratch SECRET_KEY)"
echo "Frontend: http://127.0.0.1:${FRONTEND_PORT}  (API_BASE/WS_ORIGIN -> local backend)"

SECRET_KEY="scratch-dev-secret" \
DATABASE_URL="sqlite:///./${DB_FILE}" \
  uvicorn api:app --reload --port "${BACKEND_PORT}" &
BACKEND_PID=$!

(
  export API_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}"
  export NEXT_PUBLIC_API_BASE="/api"
  export NEXT_PUBLIC_WS_ORIGIN="http://127.0.0.1:${BACKEND_PORT}"
  cd web && npm run dev -- -p "${FRONTEND_PORT}"
) &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "Stopping backend (pid ${BACKEND_PID}) and frontend (pid ${FRONTEND_PID})…"
  kill "${BACKEND_PID}" "${FRONTEND_PID}" 2>/dev/null || true
  wait "${BACKEND_PID}" "${FRONTEND_PID}" 2>/dev/null || true
  echo "Scratch DB left at ${DB_FILE} for inspection -- delete manually when done."
}
trap cleanup EXIT INT TERM

wait
