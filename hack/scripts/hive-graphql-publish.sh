#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "Usage: $0 <organization> <project> <environment> <domain>" >&2
  echo "  organization  Hive organization slug (e.g. pilotariak)" >&2
  echo "  project       Hive project slug (e.g. frontis)" >&2
  echo "  environment   Hive target environment (e.g. development, staging, production)" >&2
  echo "  domain        Workers domain for subgraph URLs (e.g. xxxxx.workers.dev)" >&2
  exit 1
fi

HIVE_ORG="$1"
HIVE_PROJECT="$2"
HIVE_ENV="$3"
DOMAIN="$4"

if [[ -z "${HIVE_ACCESS_TOKEN:-}" ]]; then
  echo "Error: HIVE_ACCESS_TOKEN environment variable is not set." >&2
  exit 1
fi

SERVICES=(echo specialties clubs competitions results)

for SERVICE in "${SERVICES[@]}"; do
  echo "Publishing schema for: ${SERVICE}"
  make hive-publish \
    SERVICE="${SERVICE}" \
    HIVE_ORG="${HIVE_ORG}" \
    HIVE_PROJECT="${HIVE_PROJECT}" \
    HIVE_ENV="${HIVE_ENV}" \
    HIVE_URL="https://frontis-${SERVICE}.${DOMAIN}/graphql"
done

echo "All subgraph schemas published to ${HIVE_ORG}/${HIVE_PROJECT}/${HIVE_ENV}."
