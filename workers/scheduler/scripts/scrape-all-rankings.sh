#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0
#
# Load the end-of-championship rankings of a league by firing one
# /scrape_rankings call per (competition x specialty) combo found in the D1
# database, every category at once (category=0). A specialty the competition
# does not offer costs one upstream GET and saves nothing.
#
# Usage:
#   ./scrape-all-rankings.sh <league> [--dry-run]
#
# Examples:
#   ./scrape-all-rankings.sh lcapb --dry-run      # preview, persist nothing
#   ./scrape-all-rankings.sh lcapb                # persist to DB
#
# Requires: wrangler, jq, curl. Runs from any directory: it moves to database/,
# where wrangler finds the D1 bindings.
#
# The deployed scheduler (the default SCHEDULER_BASE) is behind Cloudflare
# Access. Set CF_ACCESS_TOKEN (cloudflared access token -app=<url>), or
# CF_CLIENT_ID and CF_CLIENT_SECRET for a service token, to call it.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../database"

LEAGUE="${1:?usage: scrape-all-rankings.sh <league> [--dry-run]}"
shift || true

BASE="${SCHEDULER_BASE:-https://frontis-scheduler.pilotariak.com}"
DB_NAME="pilotariak-${LEAGUE}"
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="&dry_run=true" ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# ── Scheduler calls ───────────────────────────────────────────────────────────
if [ -n "${CF_CLIENT_ID:-}${CF_CLIENT_SECRET:-}" ] && { [ -z "${CF_CLIENT_ID:-}" ] || [ -z "${CF_CLIENT_SECRET:-}" ]; }; then
  echo "set both CF_CLIENT_ID and CF_CLIENT_SECRET, or neither." >&2
  exit 2
fi

access_headers() {
  if [ -n "${CF_ACCESS_TOKEN:-}" ]; then
    printf 'cf-access-token: %s\n' "$CF_ACCESS_TOKEN"
  else
    printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' "$CF_CLIENT_ID" "$CF_CLIENT_SECRET"
  fi
}

# api <url> [curl args...] -> curl the scheduler, with the Cloudflare Access
# headers when credentials are set. Headers are read from a file descriptor so
# the secrets stay out of the process list.
api() {
  if [ -n "${CF_ACCESS_TOKEN:-}${CF_CLIENT_ID:-}" ]; then
    curl -fsS -H @<(access_headers) "$@"
  else
    curl -fsS "$@"
  fi
}

# Without valid credentials Cloudflare Access answers with a redirect to its
# login page, which curl -f treats as success: every call would then silently
# do nothing. Fail before the first request instead.
version="$(api "${BASE}/version" 2>/dev/null || true)"
if [[ "$version" != *'"version"'* ]]; then
  echo "no scheduler answers at ${BASE}." >&2
  echo "  local worker:    start it with 'bun run scheduler:remote' (this script reads production ids)." >&2
  echo "  deployed worker: set CF_ACCESS_TOKEN, or CF_CLIENT_ID and CF_CLIENT_SECRET (Cloudflare Access)." >&2
  exit 1
fi

# ids() runs inside process substitutions, where a wrangler failure (expired
# login, unknown database) would be lost and read as an empty table, so the
# loop would silently do nothing. Check that D1 answers first.
if ! d1_check="$(bunx wrangler d1 execute "$DB_NAME" --remote --json --command "SELECT 1" 2>&1)"; then
  echo "cannot query ${DB_NAME} with wrangler:" >&2
  printf '%s\n' "$d1_check" | grep -m1 -E 'ERROR|"text"' >&2 || true
  echo "  if your wrangler login expired, run 'bunx wrangler login' (or set CLOUDFLARE_API_TOKEN)." >&2
  exit 1
fi

# Pull ids from remote D1. wrangler runs via bunx (not on PATH).
ids() { # ids <table>
  bunx wrangler d1 execute "$DB_NAME" --remote --json \
    --command "SELECT id FROM $1 ORDER BY id" \
    | jq -r '.[0].results[].id'
}

mapfile -t COMPETITIONS < <(ids competitions)
mapfile -t SPECIALTIES  < <(ids specialties)

echo "league=$LEAGUE competitions=${#COMPETITIONS[@]} specialties=${#SPECIALTIES[@]} dry=${DRY:-no}"

for comp in "${COMPETITIONS[@]}"; do
  for spec in "${SPECIALTIES[@]}"; do
    url="${BASE}/scrape_rankings?league=${LEAGUE}&competition=${comp}&specialty=${spec}&category=0&format=json${DRY}"
    echo "GET $url"
    api "$url" || echo "  !! failed comp=$comp spec=$spec"
    echo
    sleep 0.3   # be gentle on the upstream site
  done
done
