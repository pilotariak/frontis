# Architecture of Frontis

This document explains _why_ Frontis is built the way it is. It covers the architectural decisions behind GraphQL federation, the choice of Cloudflare Workers, the data routing strategy, and the tradeoffs involved.

Read this when you want to understand the system — not when you need to perform a specific task.

---

## Why GraphQL federation?

Pilotariak manages data across distinct bounded contexts: clubs, competitions, match results, and pelota disciplines (specialties). These domains have different owners, different change rates, and different scaling requirements.

Federation lets each domain be an independent service with its own schema, its own deployment lifecycle, and its own database. The gateway stitches them into a single schema for clients. Clients see one API; the backend scales as independent units.

The alternative — a monolithic GraphQL server — would couple all domains together. A schema change in `competitions` would require coordinating with `results`, `clubs`, and all other owners.

---

## Why Federation v2.5?

Apollo Federation v2 introduced `@key` as a first-class entity resolution mechanism. A subgraph declares which type it _owns_ and which fields constitute its key. Other subgraphs can _reference_ that type using only its key — the gateway resolves the full object from the owning subgraph at query time.

In Frontis, the `results` subgraph owns `Result`. It references `Club`, `Competition`, `Category`, and `Specialty` using entity stubs:

```graphql
# In results/schema.graphql
type Club @key(fields: "id") {
  id: ID!  # stub — only the key, no other fields
}
```

When a client asks for `result.clubA.name`, the gateway:

1. Fetches the `Result` (with `clubA { id }`) from the results subgraph.
2. Sends a `_entities` query to the clubs subgraph with the `id`.
3. Merges `{ name }` back into the response.

This pattern keeps each subgraph focused on its own domain without creating cross-service imports.

---

## Why Hive Gateway instead of Apollo Router?

[GraphQL Hive](https://the-guild.dev/graphql/hive) provides both a schema registry (tracking published subgraph schemas and detecting breaking changes) and a Gateway runtime. Using the same vendor for both reduces integration surface.

Hive Gateway is also designed to run on Cloudflare Workers via its edge-compatible build — making it a natural fit for the deployment target.

---

## Why Cloudflare Workers?

Workers provide:

- **Edge execution**: requests are served from the datacenter nearest to the client with no cold starts.
- **Service bindings**: Workers can call other Workers directly, bypassing the public internet. In production, the gateway calls subgraphs via service bindings (`ECHO`, `CLUBS`, `COMPETITIONS`, `CATEGORIES`, `RESULTS`, `SPECIALTIES`), not HTTP.
- **D1 (SQLite at the edge)**: each subgraph backed by data gets its own D1 database binding. Queries are executed locally to the Worker with low latency.
- **KV**: used to cache the supergraph SDL from the Hive CDN, avoiding a remote fetch on every cold Worker startup.

The service binding architecture means there is no public endpoint for subgraphs in production — they are unreachable except through the gateway. This reduces the attack surface significantly.

---

## The `X-Pilotariak-League` header

Each D1-backed subgraph (`clubs`, `competitions`, `results`, `specialties`, `categories`) manages data for multiple leagues (LCAPB, LIDFPB, CTPB). Rather than deploying a separate Worker per league, each Worker holds multiple D1 bindings (`DB_LEAGUE_LCAPB`, `DB_LEAGUE_LIDFPB`, `DB_LEAGUE_CTPB`) and selects the right database at request time based on the `X-Pilotariak-League` header.

This keeps the number of deployed Workers small while supporting multiple leagues. The gateway forwards the header to all subgraphs transparently.

Tradeoff: a missing or invalid league header results in an error for all D1-backed queries. The `echo` subgraph does not require the header since it has no database.

---

## The scheduler worker

The `bildu` scheduler is a separate Cloudflare Worker with a cron trigger (runs at 03:00 UTC). It scrapes match results from league websites and writes them to D1. It is not part of the query path and does not share any bindings with the gateway.

Separating the scraper from the read path means a scraping failure does not affect API availability.

---

## The setup-league worker

The `frontis-setup-league` Worker is a utility Worker used to seed or reconfigure league databases. It holds D1 bindings for all leagues (`DB_LEAGUE_LCAPB`, `DB_LEAGUE_LIDFPB`, `DB_LEAGUE_CTPB`) but is not on the query path and has no service binding from the gateway.

It exists to bootstrap league data independently of the scheduler and subgraph Workers.

---

## Data flow diagram

```
Client (browser / mobile app)
  │
  │  HTTP POST /graphql
  │  X-Pilotariak-League: lcapb
  ▼
Gateway Worker (Hive Gateway)
  │  resolves supergraph SDL from KV (SUPERGRAPH_CACHE or Hive CDN)
  │  checks rate limits via KV (RATE_LIMIT_CACHE)
  │  applies query depth / token / cost limits
  │
  ├─── Service binding: ECHO          → echo Worker
  │                                      (no D1)
  │
  ├─── Service binding: CLUBS         → clubs Worker
  │                                      DB_LEAGUE_LCAPB (D1)
  │
  ├─── Service binding: COMPETITIONS  → competitions Worker
  │                                      DB_LEAGUE_LCAPB (D1)
  │
  ├─── Service binding: CATEGORIES    → categories Worker
  │                                      DB_LEAGUE_LCAPB (D1)
  │
  ├─── Service binding: RESULTS       → results Worker
  │                                      DB_LEAGUE_LCAPB (D1)
  │
  └─── Service binding: SPECIALTIES   → specialties Worker
                                         DB_LEAGUE_LCAPB (D1)

Nightly (cron, 03:00 UTC):
  scheduler Worker
    └─── scrapes league websites → writes to D1
```

---

## Query safety limits

The gateway enforces limits on all incoming queries to prevent abuse:

| Limit                    | Default | Description                                      |
| ------------------------ | ------- | ------------------------------------------------ |
| `GRAPHQL_MAX_DEPTH`      | 7       | Maximum query nesting depth                      |
| `GRAPHQL_MAX_TOKENS`     | 1000    | Maximum tokens in a query document               |
| `GRAPHQL_MAX_DIRECTIVES` | 10      | Maximum directives per query                     |
| `GRAPHQL_MAX_COST`       | 1000    | Maximum demand-control cost (0 = disabled)       |

These are configured via environment variables in `gateway/wrangler.toml` and can be adjusted per environment.

---

## Rate limiting

The gateway applies per-client-IP rate limiting using the `RATE_LIMIT_CACHE` KV namespace as a shared sliding-window store:

| Variable                | Default | Description                                    |
| ----------------------- | ------- | ---------------------------------------------- |
| `RATE_LIMIT_WINDOW_MS`  | 60000   | Window duration in milliseconds (60 s)         |
| `RATE_LIMIT_MAX_LIST`   | 60      | Max requests for list queries per window       |
| `RATE_LIMIT_MAX_ITEM`   | 120     | Max requests for single-item queries per window|

KV is used for the rate limit store because it provides shared state across all Worker instances serving the same origin.

---

## Further reading

- [GraphQL Federation v2 specification](https://www.apollographql.com/docs/federation/v2/)
- [Hive Gateway documentation](https://the-guild.dev/graphql/hive/docs/gateway)
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
