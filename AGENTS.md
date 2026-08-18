# AGENTS.md — Frontis

**Frontis** is the GraphQL federation gateway for the Pilotariak platform (Basque pelota competition management).
Built with TypeScript, Bun, and Cloudflare Workers. Uses GraphQL Hive as the schema registry.

## Architecture

Frontis is a **Bun workspace monorepo**. The federation gateway routes to six subgraph workers:

```
frontis/
├── gateway/          # Apollo-compatible federation gateway (Cloudflare Worker)
├── database/         # Cloudflare D1 migrations and seed scripts
├── subgraphs/
│   ├── categories/   # Player categories per league
│   ├── clubs/        # Club directory per league
│   ├── competitions/ # Competition listings
│   ├── results/      # Match results
│   ├── specialties/  # Basque pelota disciplines (trinquet, chistera…)
│   └── echo/         # Health-check subgraph
└── workers/          # Auxiliary Cloudflare Workers (scheduler, setup-league)
```

Each subgraph is an independent Cloudflare Worker with its own `wrangler.toml` and `package.json`.

## Dev Setup

Requirements: [Bun](https://bun.sh) ≥ 1.1, [Wrangler](https://developers.cloudflare.com/workers/wrangler/) ≥ 4

```bash
bun install          # install all workspace deps
bun run dev          # start gateway + all subgraphs concurrently (7 processes)
```

`bun run dev` uses `concurrently` to start every worker in one terminal. Individual workers:

```bash
bun run graphql:gateway:local       # gateway only
bun run graphql:categories:local    # categories subgraph
bun run graphql:clubs:local
bun run graphql:competitions:local
bun run graphql:results:local
bun run graphql:specialties:local
```

## Database (Cloudflare D1)

```bash
bun run migrate:local               # apply migrations locally
bun run db:lcapb:local              # seed LCAPB league data
bun run db:lidfpb:local             # seed LIDFPB league data
bun run db:ctpb:local               # seed CTPB league data
```

Remote (production D1):

```bash
bun run migrate:remote
```

## Local Observability Stack

```bash
docker compose up -d otel           # starts Grafana LGTM (Grafana on :3000, OTLP on :4317/4318)
```

Subgraphs push traces to `http://otel:4318` via OTLP HTTP.

## GraphQL Schema

- Supergraph is composed from all subgraph SDL files: `bun run compose`
- Schema lives at `subgraphs/*/schema.graphql`
- To add a subgraph, follow `docs/how-to/howto-add-subgraph.md`
- Published to GraphQL Hive: `make hive-publish SERVICE=<name> HIVE_ORG=... HIVE_PROJECT=... HIVE_ENV=...`

Gateway config reads the supergraph from Hive CDN. Credentials in `gateway/.dev.vars`:
```
HIVE_CDN_ENDPOINT=...
HIVE_CDN_TOKEN=...
```

## Cloudflare Deployment

```bash
bun run deploy                              # deploy all workers
make cloudflare-deploy SERVICE=gateway      # deploy a single worker
```

## Key Conventions

- All workers use **TypeScript** with `@cloudflare/workers-types`
- League codes: `lcapb`, `lidfpb`, `ccapb`, `ctpb` (passed as query variables)
- GraphQL endpoint in production: `https://frontis-gateway.pilotariak.com/graphql`
- Formatting: `dprint` (config in `.dprint.json`)
- License headers required on all source files (checked by `licenserc.toml`)

## Useful Commands

```bash
make bun            # list all bun scripts
make hive-check SERVICE=results HIVE_ORG=... HIVE_PROJECT=... HIVE_ENV=staging
make hive-supergraph
```
