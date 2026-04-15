#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

UPDATE_DEV_VARS=false
for arg in "$@"; do
  case "$arg" in
    --dev-vars) UPDATE_DEV_VARS=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Worker name → directory (relative to repo root)
declare -A WORKER_DIRS=(
  ["frontis-gateway"]="gateway"
  ["frontis-echo"]="subgraphs/echo"
  ["frontis-specialties"]="subgraphs/specialties"
  ["frontis-clubs"]="subgraphs/clubs"
  ["frontis-competitions"]="subgraphs/competitions"
  ["frontis-categories"]="subgraphs/categories"
  ["frontis-results"]="subgraphs/results"
)

SECRET="$(openssl rand -hex 32)"
echo "Generated INTERNAL_SERVICE_TOKEN: ${SECRET}"
echo ""

for WORKER in "${!WORKER_DIRS[@]}"; do
  echo "Setting secret on ${WORKER}..."
  echo "${SECRET}" | bunx wrangler secret put INTERNAL_SERVICE_TOKEN --name "${WORKER}"
done

echo ""
echo "Secret set on all workers."

if [[ "${UPDATE_DEV_VARS}" == "true" ]]; then
  echo ""
  echo "Writing to .dev.vars files..."
  for WORKER in "${!WORKER_DIRS[@]}"; do
    DEV_VARS="${REPO_ROOT}/${WORKER_DIRS[$WORKER]}/.dev.vars"
    if [[ -f "${DEV_VARS}" ]]; then
      # Update existing entry if present, otherwise append
      if grep -q "^INTERNAL_SERVICE_TOKEN=" "${DEV_VARS}"; then
        sed -i.bak "s|^INTERNAL_SERVICE_TOKEN=.*|INTERNAL_SERVICE_TOKEN=${SECRET}|" "${DEV_VARS}"
        rm -f "${DEV_VARS}.bak"
      else
        echo "INTERNAL_SERVICE_TOKEN=${SECRET}" >> "${DEV_VARS}"
      fi
    else
      echo "INTERNAL_SERVICE_TOKEN=${SECRET}" > "${DEV_VARS}"
    fi
    echo "  Updated ${WORKER_DIRS[$WORKER]}/.dev.vars"
  done
  echo ""
  echo "Done. Keep .dev.vars out of git (check .gitignore)."
fi
