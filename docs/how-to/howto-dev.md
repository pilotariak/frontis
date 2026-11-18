# How to develop and run Frontis

## Prerequisites

- [Bun](https://bun.sh) >= 1.1
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed automatically via `bun install`)

---

## Install dependencies

```bash
bun install
```

---

## Run locally

### All at once

```bash
bun run dev
```

This starts the gateway and every subgraph (echo, specialties, clubs, competitions, categories, results and rankings)
concurrently using `concurrently`.

### Individually

```bash
bun run graphql:echo:local
bun run graphql:specialties:local
bun run graphql:clubs:local
bun run graphql:competitions:local
bun run graphql:categories:local
bun run graphql:results:local
bun run graphql:rankings:local
bun run graphql:gateway:local
```

Each worker has its own app port and inspector port, so they can run in parallel: see the
[Port reference](../reference/ports.md).

### Compose the supergraph SDL

The gateway requires a `supergraph.graphql` file built from the running subgraphs:

```bash
bun run compose
```

Run this after any schema change before starting the gateway.

---

## Run with Docker

```bash
# Compose supergraph with Docker service URLs
bun run compose

docker compose up --build
```

Gateway available at `http://localhost:4000/graphql`.

---

## Run the scheduler

The scheduler Worker scrapes match results from the league websites and saves them to D1.

```bash
# Start scheduler in local dev mode (with --test-scheduled support)
bun run scheduler:local

# Manually trigger a scrape
curl "http://localhost:8787/scrape?league=lcapb&competition=20260501&specialty=2&category=1&phase=0"

# Trigger the scheduled cron handler
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

---

## Database migrations

Migrations are managed from the `database/` package against both D1 databases.

```bash
# Apply migrations locally (D1 local SQLite)
bun run migrate:local

# Apply migrations to remote D1 (production)
bun run migrate:remote

# List applied migrations
bun run migrate:list
```

See [`howto-database.md`](howto-database.md) for full details.

---

## Deploy to Cloudflare Workers

Full deployment order when releasing changes:

### 1. Apply database migrations (if schema changed)

```bash
bun run migrate:remote
```

### 2. Publish changed subgraph schemas to Hive

Run `hive-publish` for each subgraph whose `schema.graphql` changed.
The gateway reads the composed supergraph from the Hive CDN, so Hive must be
updated before deploying the gateway.

```bash
# Example: results subgraph changed
make hive-publish SERVICE=results \
  HIVE_ORG=pilotariak HIVE_PROJECT=frontis HIVE_ENV=production \
  HIVE_URL=<your-workers-subdomain>.workers.dev \
  HIVE_ACCESS_TOKEN=<your-token>
```

See [`howto-hive-registry.md`](howto-hive-registry.md) for publishing all subgraphs at once.

### 3. Deploy all subgraphs and gateway

```bash
WORKERS_SUBDOMAIN=<your-workers-subdomain> bun run deploy
```

This runs `compose:workers` then deploys `echo`, `specialties`, `clubs`,
`competitions`, `categories`, `results`, and `gateway` in order.

### 4. Deploy the workers

```bash
bun run scheduler:deploy
bun run setup-league:deploy
```

These are deployed separately because they are not part of the GraphQL
federation graph.

---

### Deploy a single component

```bash
make cloudflare-deploy SERVICE=subgraphs/results
make cloudflare-deploy SERVICE=workers/scheduler
make cloudflare-deploy SERVICE=workers/setup-league
make cloudflare-deploy SERVICE=gateway
```

---

## Port reference

Every Worker's app port, inspector port and local URL, and the ports of the Docker observability
stack, are listed in the [Port reference](../reference/ports.md).

---

## Project structure

```
frontis/
├── gateway/          ← Hive Gateway (federation entry point)
├── subgraphs/
│   ├── echo/         ← liveness, version
│   ├── specialties/  ← Specialty entities (D1)
│   ├── clubs/        ← Club entities (D1)
│   ├── competitions/ ← Competition entities (D1)
│   └── results/      ← Result, Player entities (D1)
├── workers/
│   └── scheduler/    ← cron scraper → D1
├── database/         ← D1 migrations for all league databases
├── docs/             ← how-to guides
└── operations/       ← ready-to-use GraphQL operations
```
