#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0
#
# Setup all results for a league by firing one /scrape_results call per
# (competition x specialty x category) combo found in the D1 database.
#
# Usage:
#   ./scrape-all-results.sh <league> [--dry-run] [--phase N]
#
# Examples:
#   ./scrape-all-results.sh ctpb --dry-run        # preview, persist nothing
#   ./scrape-all-results.sh ctpb                  # persist to DB
#
# Requires: wrangler, jq, curl. Run from a dir where the D1 binding resolves
# (e.g. database/ or workers/scheduler/), or adjust DB_NAME below.
#
# The worker requires the shared secret in the x-internal-token header:
#   INTERNAL_SERVICE_TOKEN=... ./scrape-all-results.sh ctpb

set -euo pipefail

LEAGUE="${1:?usage: scrape-all-results.sh <league> [--dry-run] [--phase N]}"
shift || true

BASE="${SCHEDULER_BASE:-https://frontis-scheduler.pilotariak.com}"
TOKEN="${INTERNAL_SERVICE_TOKEN:?set INTERNAL_SERVICE_TOKEN (the worker's x-internal-token secret)}"
AUTH=(-H "x-internal-token: ${TOKEN}")
DB_NAME="pilotariak-${LEAGUE}"
PHASE="0"
DRY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="&dry_run=true" ;;
    --phase)   PHASE="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# Pull ids from remote D1. wrangler runs via bunx (not on PATH).
ids() { # ids <table>
  bunx wrangler d1 execute "$DB_NAME" --remote --json \
    --command "SELECT id FROM $1 ORDER BY id" \
    | jq -r '.[0].results[].id'
}

mapfile -t COMPETITIONS < <(ids competitions)
mapfile -t SPECIALTIES  < <(ids specialties)
mapfile -t CATEGORIES   < <(ids categories)

echo "league=$LEAGUE competitions=${#COMPETITIONS[@]} specialties=${#SPECIALTIES[@]} categories=${#CATEGORIES[@]} dry=${DRY:-no}"

for comp in "${COMPETITIONS[@]}"; do
  for spec in "${SPECIALTIES[@]}"; do
    for cat in "${CATEGORIES[@]}"; do
      url="${BASE}/scrape_results?league=${LEAGUE}&competition=${comp}&specialty=${spec}&category=${cat}&phase=${PHASE}&no_color=true${DRY}"
      echo "GET $url"
      curl -fsS "${AUTH[@]}" "$url" || echo "  !! failed comp=$comp spec=$spec cat=$cat"
      sleep 0.3   # be gentle on the upstream site
    done
  done
done
