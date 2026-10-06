# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0

BANNER = f r o n t i s

SHELL = /bin/bash -o pipefail

DIR = $(shell pwd)

# Colors for terminal output
NO_COLOR=\033[0m
OK_COLOR=\033[32;01m
ERROR_COLOR=\033[31;01m
WARN_COLOR=\033[33;01m
INFO_COLOR=\033[36m
WHITE_COLOR=\033[1m
MAKE_COLOR=\033[33;01m%-20s\033[0m

.DEFAULT_GOAL := help

OK=[🟢]
KO=[🔴]
WARN=[🟠]
INFO=[🔵]


.PHONY: help
help:
	@echo -e "$(OK_COLOR)      $(BANNER)$(NO_COLOR)"
	@echo "------------------------------------------------------------------"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make ${INFO_COLOR}<target>${NO_COLOR}\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  ${INFO_COLOR}%-25s${NO_COLOR} %s\n", $$1, $$2 } /^##@/ { printf "\n${WHITE_COLOR}%s${NO_COLOR}\n", substr($$0, 5) } ' $(MAKEFILE_LIST)
	@echo ""

guard-%:
	@if [ "${${*}}" = "" ]; then \
		echo -e "$(ERROR_COLOR)Environment variable $* not set$(NO_COLOR)"; \
		exit 1; \
	fi

check-%:
	@if $$(hash $* 2> /dev/null); then \
		echo -e "$(OK_COLOR)$(OK)$(NO_COLOR) $*"; \
	else \
		echo -e "$(ERROR_COLOR)$(KO)$(NO_COLOR) $*"; \
	fi

##@ Dev

.PHONY: clean
clean: ## Clean project
	@echo -e "$(INFO)$(INFO_COLOR)[Clean] Processing $(NO_COLOR)"

.PHONY: bun
bun: ## Bun executions
	@bun run

.PHONY: test
test: ## Run unit tests (bun test) [FILTER=path/or/name]
	@echo -e "$(INFO)$(INFO_COLOR)[Test] Running bun test $(FILTER)$(NO_COLOR)"
	@bun test $(FILTER)

.PHONY: typecheck
typecheck: ## Type-check every workspace with tsc
	@echo -e "$(INFO)$(INFO_COLOR)[Typecheck] Running tsc --noEmit$(NO_COLOR)"
	@bunx tsc --noEmit -p tsconfig.json

##@ Design System

.PHONY: tokens
tokens: ## Generate the gateway/index.html :root tokens from DESIGN.md (single source of truth)
	@echo -e "$(INFO)$(INFO_COLOR)[Tokens] Generating gateway/index.html tokens from DESIGN.md$(NO_COLOR)"
	python3 hack/gen-design-tokens.py

.PHONY: tokens-check
tokens-check: ## Verify gateway/index.html tokens match DESIGN.md (no drift)
	@echo -e "$(INFO)$(INFO_COLOR)[Tokens] Checking gateway/index.html is in sync with DESIGN.md$(NO_COLOR)"
	python3 hack/gen-design-tokens.py --check

.PHONY: tokens-lint
tokens-lint: ## Lint DESIGN.md against the design.md standard
	@echo -e "$(INFO)$(INFO_COLOR)[Tokens] Linting DESIGN.md$(NO_COLOR)"
	bunx @google/design.md@0.4.0 lint DESIGN.md

.PHONY: tokens-export
tokens-export: ## Export DESIGN.md tokens to tokens.json (W3C DTCG interchange)
	@echo -e "$(INFO)$(INFO_COLOR)[Tokens] Exporting DTCG tokens to tokens.json$(NO_COLOR)"
	bunx @google/design.md@0.4.0 export --format dtcg DESIGN.md > tokens.json
	@echo -e "$(OK)$(OK_COLOR) wrote tokens.json$(NO_COLOR)"

##@ Cloudflare

.PHONY: cloudflare-deploy
cloudflare-deploy: guard-SERVICE ## Deploy service to Cloudflare workers (SERVICE=xxx [ENV=production])
	@echo -e "$(INFO)$(INFO_COLOR)[Cloudflare] Deploy $(SERVICE)$(NO_COLOR)"
	@pushd $(SERVICE) && bunx wrangler deploy && popd

##@ Hive

.PHONY: hive-check
hive-check: guard-SERVICE guard-HIVE_ORG guard-HIVE_PROJECT guard-HIVE_ENV ## Check the GraphQL schema (SERVICE=xxx HIVE_ENV=xxx)
	@echo -e "$(INFO)$(INFO_COLOR)[Hive] Check the GraphQL schema for $(SERVICE)$(NO_COLOR)"
	@bunx @graphql-hive/cli schema:check \
		--registry.accessToken "$(HIVE_ACCESS_TOKEN)" \
		--target "$(HIVE_ORG)/$(HIVE_PROJECT)/$(HIVE_ENV)" \
		--service "$(SERVICE)" \
		subgraphs/$(SERVICE)/schema.graphql

.PHONY: hive-publish
hive-publish: guard-SERVICE guard-HIVE_ORG guard-HIVE_PROJECT guard-HIVE_ENV guard-HIVE_URL ## Publish the GraphQL schema (SERVICE=xxx HIVE_ENV=xxx)
	@echo -e "$(INFO)$(INFO_COLOR)[Hive] Publish the GraphQL schema: $(SERVICE)$(NO_COLOR)"
	@bunx @graphql-hive/cli schema:publish \
		--registry.accessToken "$(HIVE_ACCESS_TOKEN)" \
		--target "$(HIVE_ORG)/$(HIVE_PROJECT)/$(HIVE_ENV)" \
		--service "$(SERVICE)" \
		--url http://frontis-$(SERVICE).$(HIVE_URL)/graphql \
		--author "Pilotariak" \
		subgraphs/$(SERVICE)/schema.graphql

.PHONY: hive-supergraph
hive-supergraph: ## Curl the supergraph (reads HIVE_CDN_ENDPOINT and HIVE_CDN_TOKEN from gateway/.dev.vars)
	@CDN_ENDPOINT=$$(grep '^HIVE_CDN_ENDPOINT=' gateway/.dev.vars | cut -d= -f2-); \
	CDN_TOKEN=$$(grep '^HIVE_CDN_TOKEN=' gateway/.dev.vars | cut -d= -f2-); \
	curl -H "X-Hive-CDN-Key: $$CDN_TOKEN" $$CDN_ENDPOINT/supergraph
