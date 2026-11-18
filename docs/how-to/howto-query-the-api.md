# How to query the Frontis GraphQL API

This guide shows how to query the Frontis federated gateway using `curl`. The gateway
stitches together the `echo`, `specialties`, `clubs`, `competitions`, `results`, `categories` and
`rankings` subgraphs behind a single endpoint.

This page covers what every query needs: the endpoint, the league header, and the errors they can
raise. The queries themselves are in one guide per subgraph. All examples use the `FRONTIS_GW`
environment variable so the same commands work against production and a local stack: see
[Setup](#setup) to define it.

---

## Queries by subgraph

| Subgraph     | Guide                                                          | Serves                                                       |
| ------------ | -------------------------------------------------------------- | ------------------------------------------------------------ |
| echo         | [Query the echo subgraph](howto-query-echo.md)                 | Liveness check and the Frontis version                       |
| clubs        | [Query the clubs subgraph](howto-query-clubs.md)               | Club directory                                               |
| competitions | [Query the competitions subgraph](howto-query-competitions.md) | Competitions, with their results                             |
| categories   | [Query the categories subgraph](howto-query-categories.md)     | Player categories (series, age groups)                       |
| specialties  | [Query the specialties subgraph](howto-query-specialties.md)   | Basque pelota disciplines                                    |
| results      | [Query the results subgraph](howto-query-results.md)           | Match results: filters, phases, pagination, sets and winner  |
| rankings     | [Query the rankings subgraph](howto-query-rankings.md)         | End-of-championship rankings, players, champions of a season |

Queries that span several subgraphs are in [Cross-subgraph query](#cross-subgraph-query-federation-in-action).

---

## The `X-Pilotariak-League` header

All requests to subgraphs backed by D1 (`specialties`, `clubs`, `competitions`, `results`, `categories`,
`rankings`) require an **`X-Pilotariak-League` header** identifying the target database.
Supported values: `lcapb`, `lidfpb`, `ctpb`, `llpb` (see [Supported leagues](../reference/leagues.md)).
Any other value returns `Unknown league: <value>`.

> **About the IDs in the examples.** IDs are imported from each league's website and are
> not sequential (`club(id: "1")` returns `null`). The IDs used in the guides come from production
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

Started by `bun run dev` (see [howto-dev](howto-dev.md)). Each worker runs on a fixed port, listed
in the [Port reference](../reference/ports.md); the gateway answers on `http://localhost:4000/graphql`.

Every subgraph, including `echo`, checks the `x-internal-token` header against its
`INTERNAL_SERVICE_TOKEN` variable. Locally this comes from a `.dev.vars` file in each
subgraph directory (gitignored). Make sure all eight exist with the same value:

```bash
for s in echo specialties clubs competitions categories results rankings; do
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

The rankings subgraph federates the same way: see
[The champions of a season](howto-query-rankings.md#the-champions-of-a-season).

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

## Querying subgraphs directly

During development you can bypass the gateway and hit subgraphs directly on their
local ports. Each subgraph guide ends with an example; they intentionally use fixed
`localhost` URLs rather than `FRONTIS_GW`, since the point is to skip the gateway.

All subgraphs enforce the **`x-internal-token`** header — the shared secret that
protects them from unauthenticated access. In local development the value is
`dev-secret` (set in each subgraph's `.dev.vars`). The D1-backed subgraphs also
require **`X-Pilotariak-League`** (see [The `X-Pilotariak-League` header](#the-x-pilotariak-league-header)).

| Subgraph     | League header | Internal token | Example                                                                 |
| ------------ | ------------- | -------------- | ----------------------------------------------------------------------- |
| echo         | no            | yes            | [echo](howto-query-echo.md#query-the-subgraph-directly)                 |
| specialties  | yes           | yes            | [specialties](howto-query-specialties.md#query-the-subgraph-directly)   |
| clubs        | yes           | yes            | [clubs](howto-query-clubs.md#query-the-subgraph-directly)               |
| competitions | yes           | yes            | [competitions](howto-query-competitions.md#query-the-subgraph-directly) |
| results      | yes           | yes            | [results](howto-query-results.md#query-the-subgraph-directly)           |
| categories   | yes           | yes            | [categories](howto-query-categories.md#query-the-subgraph-directly)     |
| rankings     | yes           | yes            | [rankings](howto-query-rankings.md#query-the-subgraph-directly)         |

Each subgraph's local URL is in the [Port reference](../reference/ports.md).

> **Note:** Cross-subgraph fields (e.g. `clubA.name` on a `Result`) are only
> resolved when going through the gateway — direct subgraph calls will return
> `null` or an error for those fields.

---

## Troubleshooting

Errors specific to one subgraph are in its guide (for example
[rankings](howto-query-rankings.md#troubleshooting)).

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

The league code is not one of `lcapb`, `lidfpb`, `ctpb`, `llpb`.

### `GRAPHQL_VALIDATION_FAILED` — `Cannot query field "..."`

The field is not in the supergraph the gateway serves. Locally, run `bun run compose`
and restart the gateway. In production, the subgraph schema must be published to Hive
and the subgraph deployed.

### A lookup by ID returns `null`

IDs are not sequential. List the type first and use an ID from the response.
