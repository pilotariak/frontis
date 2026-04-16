#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
LEAGUE="lcapb"
SLEEP_SECONDS="${SLEEP_SECONDS:-2}"
OPEN_BROWSER="${OPEN_BROWSER:-false}"

# Optional Cloudflare Access service-token headers.
# Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment
# when targeting a Cloudflare-protected deployment.
CF_ACCESS_CLIENT_ID="${CF_ACCESS_CLIENT_ID:-}"
CF_ACCESS_CLIENT_SECRET="${CF_ACCESS_CLIENT_SECRET:-}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Build a curl args array, appending CF Access headers only when both vars are set.
curl_args() {
  local args=(--fail --silent --show-error --location)
  if [[ -n "${CF_ACCESS_CLIENT_ID}" && -n "${CF_ACCESS_CLIENT_SECRET}" ]]; then
    args+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}")
    args+=(-H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
  fi
  printf '%s\0' "${args[@]}"
}

scrape() {
  local competition="$1"
  local specialty="$2"
  local category="$3"
  local phase="${4:-0}"

  read -r -p "Scrape league=${LEAGUE} competition=${competition} specialty=${specialty} category=${category} phase=${phase}? [y/N] " confirm
  if [[ ! "${confirm}" =~ ^[Yy]$ ]]; then
    log "Skipped."
    return
  fi

  local url="${BASE_URL}/scrape_results?league=${LEAGUE}&competition=${competition}&specialty=${specialty}&category=${category}&phase=${phase}&no_color=true"

  if [[ "${OPEN_BROWSER}" == "true" ]]; then
    log "Opening in browser: ${url}"
    open "${url}"
    return
  fi

  log "Scraping..."
  local response http_status
  local -a args
  mapfile -d '' args < <(curl_args)
  response=$(curl "${args[@]}" --write-out '\n%{http_code}' "${url}")
  http_status="${response##*$'\n'}"
  response="${response%$'\n'*}"
  log "HTTP status: ${http_status}"
  log "Response: ${response}"
  sleep "${SLEEP_SECONDS}"
}

if [[ -n "${CF_ACCESS_CLIENT_ID}" && -n "${CF_ACCESS_CLIENT_SECRET}" ]]; then
  log "Cloudflare Access headers enabled (CF_ACCESS_CLIENT_ID=${CF_ACCESS_CLIENT_ID})"
fi

log "Starting setup for league=${LEAGUE} against ${BASE_URL}"

scrape 2 10 1
scrape 2 10 2
scrape 2 10 3
scrape 2 9  1
scrape 2 5  1
scrape 2 5  2
scrape 2 5  3

log "Done."
