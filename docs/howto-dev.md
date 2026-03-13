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

This starts the gateway, echo, clubs, and competitions subgraphs concurrently using `concurrently`.

### Individually

```bash
bun run graphql:echo:local         # http://localhost:4003/graphql  (inspector: 9229)
bun run graphql:clubs:local        # http://localhost:4001/graphql  (inspector: 9230)
bun run graphql:competitions:local # http://localhost:4002/graphql  (inspector: 9231)
bun run graphql:gateway:local      # http://localhost:4000/graphql  (inspector: 9232)
```

> Each worker uses a unique inspector port to avoid conflicts when running in parallel.

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

```bash
# Compose supergraph with Workers URLs
WORKERS_SUBDOMAIN=your-account bun run compose:workers

# Deploy all Workers
bun run deploy

# Deploy the scheduler separately
bun run scheduler:deploy
```

---

## Port reference

| Worker       | App port | Inspector port |
| ------------ | -------- | -------------- |
| echo         | 4003     | 9229           |
| clubs        | 4001     | 9230           |
| competitions | 4002     | 9231           |
| gateway      | 4000     | 9232           |
| scheduler    | 8787     | 9233           |

---

## Project structure

```
frontis/
├── gateway/          ← Hive Gateway (federation entry point)
├── subgraphs/
│   ├── echo/         ← liveness, version
│   ├── clubs/        ← Specialty, Club entities (D1)
│   └── competitions/ ← Competition, Result entities (D1)
├── workers/
│   └── scheduler/    ← cron scraper → D1
├── database/         ← D1 migrations for all league databases
├── docs/             ← how-to guides
└── operations/       ← ready-to-use GraphQL operations
```
