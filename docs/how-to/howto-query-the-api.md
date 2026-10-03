# How to query the Frontis GraphQL API

This guide shows how to query the Frontis federated gateway using `curl`. The gateway
stitches together the `echo`, `specialties`, `clubs`, `competitions`, `results`, and `categories`
subgraphs behind a single endpoint.

All examples below use the `FRONTIS_GW` environment variable so the same commands work
against production and a local stack. See [Setup](#setup) to define it.

All requests to subgraphs backed by D1 (`specialties`, `clubs`, `competitions`, `results`, `categories`)
require an **`X-Pilotariak-League` header** identifying the target database.
Supported values: `lcapb`, `lidfpb`, `ctpb`. Any other value returns `Unknown league: <value>`.

> **About the IDs in the examples.** IDs are imported from each league's website and are
> not sequential (`club(id: "1")` returns `null`). The IDs used below come from production
> `lcapb` data as of 2026-10-02. A local seed produces different IDs, so run the list query
> for a type first and pick an ID from the response.

---

## Endpoints

### Production

The gateway is the only public entry point. Subgraphs are not meant to be called
directly in production — the gateway reads the composed supergraph from the
GraphQL Hive CDN and routes to each subgraph internally. No authentication header
is required to call the gateway; the `x-internal-token` secret is only used
between the gateway and its subgraphs.

| Service | Endpoint                                         |
| ------- | ------------------------------------------------ |
| gateway | `https://frontis-gateway.pilotariak.com/graphql` |

### Local development

Started by `bun run dev` (see [howto-dev](howto-dev.md)). Each worker runs on a fixed port:

| Service      | Worker                 | URL                             |
| ------------ | ---------------------- | ------------------------------- |
| gateway      | `frontis-gateway`      | `http://localhost:4000/graphql` |
| echo         | `frontis-echo`         | `http://localhost:4001/graphql` |
| competitions | `frontis-competitions` | `http://localhost:4002/graphql` |
| clubs        | `frontis-clubs`        | `http://localhost:4003/graphql` |
| specialties  | `frontis-specialties`  | `http://localhost:4004/graphql` |
| results      | `frontis-results`      | `http://localhost:4005/graphql` |
| categories   | `frontis-categories`   | `http://localhost:4006/graphql` |

Every subgraph, including `echo`, checks the `x-internal-token` header against its
`INTERNAL_SERVICE_TOKEN` variable. Locally this comes from a `.dev.vars` file in each
subgraph directory (gitignored). Make sure all seven exist with the same value:

```bash
for s in echo specialties clubs competitions categories results; do
  printf 'INTERNAL_SERVICE_TOKEN=dev-secret\n' > subgraphs/$s/.dev.vars
done
```

The gateway's own `gateway/.dev.vars` must contain the same `INTERNAL_SERVICE_TOKEN`
plus the Hive CDN credentials.

---

## Setup

Export `FRONTIS_GW` once in your shell, pointing at the gateway you want to query.

Production:

```bash
export FRONTIS_GW=https://frontis-gateway.pilotariak.com/graphql
```

Local development (stack started with `bun run dev`):

```bash
export FRONTIS_GW=http://localhost:4000/graphql
```

Quick sanity check — should return `{"data":{"__typename":"Query"}}`:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ __typename }"}' | jq
```

---

## Prerequisites

- `FRONTIS_GW` is exported (see [Setup](#setup))
- For local queries, the stack is running (see [README](../README.md) for startup instructions)
- `curl` and `jq` are available in your shell

---

## Keeping the gateway schema up to date

The gateway validates queries against a **supergraph SDL** — a composed snapshot of all subgraph schemas. If you change any `schema.graphql` file in a subgraph, the gateway will reject queries that use the new fields until the supergraph is recomposed.

```bash
bun run compose
```

Then restart the gateway. Run this command **any time a subgraph schema changes** (added field, renamed field, new type, etc.).

> **Example:** after renaming `scoreA`/`scoreB` to `scores` on the `Result` type, the gateway will return `Cannot query field "scores" on type "Result"` until `bun run compose` is run.

In production the gateway reads the supergraph from GraphQL Hive, so a field added to
a subgraph schema is only queryable once that subgraph has been published to Hive
(`make hive-publish SERVICE=<name> ...`) and deployed. For example, `Competition.enabled`
exists in `subgraphs/competitions/schema.graphql` but is not yet in the production
supergraph.

---

## Echo

The echo subgraph is useful for quickly verifying that the gateway is up and routing correctly.
It does not require an `X-Pilotariak-League` header.

### Basic echo

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ echo(message: \"hello\") }"}' | jq
```

Expected response:

```json
{
  "data": {
    "echo": "hello"
  }
}
```

### Get the Frontis version

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ version }"}' | jq
```

Expected response (the value tracks the `echo` subgraph's `package.json` version):

```json
{
  "data": {
    "version": "0.6.0"
  }
}
```

---

## Clubs

### List all clubs

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```

### Fetch a single club by ID

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ club(id: \"3328\") { id name } }"}' | jq
```

Expected response:

```json
{
  "data": {
    "club": {
      "id": "3328",
      "name": "AKITANIA PELOTE BASQUE"
    }
  }
}
```

## Competitions

A `Competition` exposes `id`, `source_id` (the ID on the league website), `name`, and
its `results`. There is no `year` or `level` field: the season is part of the `name`
(e.g. `Championnat CCAPB 2025-2026`).

### List all competitions

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions { id source_id name } }"}' | jq
```

### List only enabled competitions

A competition is `enabled` once the scheduler has saved results for it. Pass
`enabled: true` to skip the ones that are still empty (or `enabled: false` to see
what has not been scraped yet):

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions(enabled: true) { id source_id name } }"}' | jq
```

### Fetch a single competition with its results

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ competition(id: \"322\") { id name results { id phase scores } } }"
  }' | jq
```

---

## Categories

### List all categories

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```

### Fetch a single category by ID

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ category(id: \"1435\") { id name } }"}' | jq
```

---

## Specialties (disciplines)

### List all specialties

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialties { id name } }"}' | jq
```

### Fetch a single specialty by ID

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialty(id: \"81\") { id name } }"}' | jq
```

---

## Results

`results` accepts five optional filters: `competitionId`, `specialtyId`, `categoryId`,
`clubId` (matches either side of the match) and `phase`. Results are ordered by `id` and
paginated with `limit` (default 100, max 500) and `offset` (default 0).

### About `phase` values

`phase` is the raw code from the league website, a letter followed by a number. In
`lcapb` data you will see pool matches (`P 1` … `P 60`), round of 16 (`H 1` … `H 8`),
quarter-finals (`Q 1` … `Q 4`), semi-finals (`D 1`, `D 2`), the final (`F 1`), and
play-off/barrage rounds (`B 1`, `B1T 1`, …). There is no `Finale` value. To see what a
competition uses, list its results and look at the distinct `phase` values:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"322\") { phase } }"}' \
  | jq -r '.data.results[].phase' | sort -u
```

### List all results

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id phase scores } }"}' | jq
```

### Filter results by competition

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"322\") { id phase scores } }"}' | jq
```

### Filter results by specialty and category

Use the IDs returned by the `specialties` and `categories` queries.

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"81\", categoryId: \"1435\") { id phase scores clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }' | jq
```

### Filter results by specialty, category, and phase

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"81\", categoryId: \"1435\", phase: \"P 8\") { id scores clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }' | jq
```

### Paginate results

Page through a large competition 50 results at a time:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"322\", limit: 50, offset: 50) { id phase scores } }"}' | jq
```

### Parsed sets and winner

`scores` is the raw string from the league site. `sets` parses it into per-set
integers, and `winner` is the club that took the most sets (`null` on a tie or when
no score is recorded):

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(competitionId: \"322\", phase: \"F 1\") { scores sets { a b } winner { name } clubA { name } clubB { name } } }"
  }' | jq
```

### All results of a club

Either filter with `clubId`, or start from the club and walk the reverse edge. Both
return the matches where the club played as `clubA` or `clubB`:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ club(id: \"417\") { name results(limit: 20) { dateMatch phase scores winner { name } } } }"}' | jq
```

`Specialty.results` and `Category.results` work the same way.

---

## Cross-subgraph query (federation in action)

This query spans multiple subgraphs: `results` come from the `results` subgraph,
`clubA`/`clubB` are resolved from the `clubs` subgraph, and `category` from the
`categories` subgraph — all stitched at query time by the gateway. The
`X-Pilotariak-League` header is forwarded to every subgraph automatically.

It lists the finals (`phase: "F 1"`) of competition `322`:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "query GetFinales($competitionId: ID!) { results(competitionId: $competitionId, phase: \"F 1\") { id scores category { name } clubA { name } clubB { name } clubALineup { player1 { name number } player2 { name number } } clubBLineup { player1 { name number } player2 { name number } } } }",
    "variables": { "competitionId": "322" }
  }' | jq
```

---

## Using variables

For complex queries, pass variables separately in the request body. This example
switches league to `lidfpb`, whose competitions use small sequential IDs:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{
    "query": "query GetCompetition($id: ID!) { competition(id: $id) { id name } }",
    "variables": { "id": "1" }
  }' | jq
```

Expected response:

```json
{
  "data": {
    "competition": {
      "id": "1",
      "name": "Compétition 2025-2026"
    }
  }
}
```

---

## Troubleshooting

### `DOWNSTREAM_SERVICE_ERROR` with status `403 Forbidden`

```json
{
  "errors": [
    {
      "message": "Unexpected response: \"Forbidden\"",
      "extensions": {
        "code": "DOWNSTREAM_SERVICE_ERROR",
        "serviceName": "echo",
        "response": { "status": 403, "body": "Forbidden" }
      }
    }
  ]
}
```

The gateway reached the subgraph named in `serviceName`, but the subgraph rejected
the gateway's `x-internal-token`. This is a deployment issue, not a client issue:
the `INTERNAL_SERVICE_TOKEN` on that subgraph does not match the gateway's.

- **Production:** re-run `wrangler secret put INTERNAL_SERVICE_TOKEN` in the subgraph
  directory with the same value as the gateway. Secret values cannot be read back from
  Cloudflare, so if the value is lost, rotate it on the gateway and all subgraphs.
- **Local:** the subgraph is missing its `.dev.vars` file, or the value differs from the
  gateway's. See [Local development](#local-development), then restart `bun run dev`
  (wrangler does not reload `.dev.vars` while running).

### `BAD_REQUEST` — `Missing X-Pilotariak-League header`

The query targets a D1-backed subgraph. Add `-H "X-Pilotariak-League: <league>"`.

### `BAD_USER_INPUT` — `Unknown league: <value>`

The league code is not one of `lcapb`, `lidfpb`, `ctpb`.

### `GRAPHQL_VALIDATION_FAILED` — `Cannot query field "..."`

The field is not in the supergraph the gateway serves. Locally, run `bun run compose`
and restart the gateway. In production, the subgraph schema must be published to Hive
and the subgraph deployed.

### A lookup by ID returns `null`

IDs are not sequential. List the type first and use an ID from the response.

---

## Querying subgraphs directly

During development you can bypass the gateway and hit subgraphs directly on their
local ports. These examples intentionally use fixed `localhost` URLs rather than
`FRONTIS_GW`, since the point is to skip the gateway.

All subgraphs enforce the **`x-internal-token`** header — the shared secret that
protects them from unauthenticated access. In local development the value is
`dev-secret` (set in each subgraph's `.dev.vars`). The D1-backed subgraphs also
require **`X-Pilotariak-League`** (`lcapb`, `lidfpb`, or `ctpb`).

| Subgraph     | URL                             | League header | Internal token |
| ------------ | ------------------------------- | ------------- | -------------- |
| echo         | `http://localhost:4001/graphql` | no            | yes            |
| specialties  | `http://localhost:4004/graphql` | yes           | yes            |
| clubs        | `http://localhost:4003/graphql` | yes           | yes            |
| competitions | `http://localhost:4002/graphql` | yes           | yes            |
| results      | `http://localhost:4005/graphql` | yes           | yes            |
| categories   | `http://localhost:4006/graphql` | yes           | yes            |

```bash
# echo subgraph directly (token only, no league header)
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -d '{"query": "{ echo(message: \"ping\") }"}' | jq

# clubs subgraph directly
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq

# competitions subgraph directly
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{"query": "{ competitions { id name } }"}' | jq

# results subgraph directly
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id phase scores } }"}' | jq

# categories subgraph directly
curl -s -X POST http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```

> **Note:** Cross-subgraph fields (e.g. `clubA.name` on a `Result`) are only
> resolved when going through the gateway — direct subgraph calls will return
> `null` or an error for those fields.
