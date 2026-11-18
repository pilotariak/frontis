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
- **Service bindings**: Workers can call other Workers directly, bypassing the public internet. In production, the gateway calls subgraphs via service bindings (`ECHO`, `CLUBS`, `COMPETITIONS`, `CATEGORIES`, `RESULTS`, `RANKINGS`, `SPECIALTIES`), not HTTP.
- **D1 (SQLite at the edge)**: each subgraph backed by data gets its own D1 database binding. Queries are executed locally to the Worker with low latency.
- **Rate Limiting bindings**: per-location request counters for the gateway, with no storage to manage. Refer to [Rate limiting](#rate-limiting).

The service binding architecture means there is no public endpoint for subgraphs in production — they are unreachable except through the gateway. This reduces the attack surface significantly.

---

## The `X-Pilotariak-League` header

Each D1-backed subgraph (`clubs`, `competitions`, `results`, `rankings`, `specialties`, `categories`) manages data for multiple leagues (LCAPB, LIDFPB, CTPB, LLPB). Rather than deploying a separate Worker per league, each Worker holds multiple D1 bindings (`DB_LEAGUE_LCAPB`, `DB_LEAGUE_LIDFPB`, `DB_LEAGUE_CTPB`, `DB_LEAGUE_LLPB`) and selects the right database at request time based on the `X-Pilotariak-League` header.

This keeps the number of deployed Workers small while supporting multiple leagues. The gateway forwards the header to all subgraphs transparently.

Tradeoff: a missing or invalid league header results in an error for all D1-backed queries. The `echo` subgraph does not require the header since it has no database.

---

## The scheduler worker

The `bildu` scheduler is a separate Cloudflare Worker with a cron trigger (runs at 03:00 UTC). It scrapes match results from league websites and writes them to D1. It is not part of the query path and does not share any bindings with the gateway.

Separating the scraper from the read path means a scraping failure does not affect API availability.

---

## The setup-league worker

The `frontis-setup-league` Worker is a utility Worker used to seed or reconfigure league databases. It holds D1 bindings for all leagues (`DB_LEAGUE_LCAPB`, `DB_LEAGUE_LIDFPB`, `DB_LEAGUE_CTPB`, `DB_LEAGUE_LLPB`) but is not on the query path and has no service binding from the gateway.

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
  │  resolves supergraph SDL (isolate memory, else Hive CDN)
  │  checks rate limits (RATE_LIMIT_LIST / RATE_LIMIT_ITEM bindings)
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
  ├─── Service binding: RANKINGS      → rankings Worker
  │                                      DB_LEAGUE_LCAPB (D1)
  │
  └─── Service binding: SPECIALTIES   → specialties Worker
                                         DB_LEAGUE_LCAPB (D1)

Nightly (cron, 03:00 UTC):
  scheduler Worker
    └─── scrapes league websites (results, rankings) → writes to D1
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

The gateway limits how often each client can call the root `Query` fields, with two
[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) bindings:

| Binding           | Fields                                                                                        | Limit              |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------ |
| `RATE_LIMIT_LIST` | `categories`, `clubs`, `competitions`, `results`, `rankings`, `playerRankings`, `specialties` | 60 calls per 60 s  |
| `RATE_LIMIT_ITEM` | `category`, `club`, `competition`, `result`, `teamRanking`, `specialty`                       | 120 calls per 60 s |

List fields return broad result sets and fan out to more subgraph calls, so they get the lower limit.

Every call to a rate-limited field counts once, aliases included, against the key `<client IP>:<field>`. The client IP
is `CF-Connecting-IP`, which Cloudflare sets and a client cannot forge. `X-Forwarded-For` is left out of the key:
Cloudflare appends to a value the client sends instead of replacing it, so a client could change it to get a fresh
counter on every request.

When a field goes over its limit, only that field fails. It resolves to `null` with the error
`Rate limit of "Query.<field>" exceeded for "<client IP>"`, and the response carries `Retry-After: 60`. The other
fields of the operation still resolve, and the HTTP status stays 200, so clients read the error from the GraphQL
response like any other field error.

### Why the Rate Limiting binding and not KV

The gateway used to keep its counters in a Workers KV namespace. That cost one KV read and one KV write per
rate-limited field on every request, against a free plan that allows 1,000 KV writes a day. KV also accepts only one
write per second to the same key and takes up to 60 seconds to propagate, so a counter kept in KV is inaccurate by
design. KV suits data that is read often and written rarely, which counters are not.

The Rate Limiting binding keeps its counters inside Cloudflare's rate limiting infrastructure, with no storage and no
KV quota. The tradeoffs:

- **Counts are approximate and kept per Cloudflare location.** A burst, or a client reaching several locations, can
  go past the limit. The limit protects the subgraphs and D1 from abuse; it is not a quota to bill against. The depth,
  token, directive and cost limits still apply to every query.
- **Limits are configuration, not code.** They live in `gateway/wrangler.toml`, and changing one needs a deploy. The
  period can only be 10 or 60 seconds.
- **The limiter fails open.** If a call to the binding throws, the gateway logs the error and resolves the field. An
  outage of the limiter must not take the API down with it.

Clients that run on Cloudflare Workers need care. A Worker in another Cloudflare zone, such as one served from
`workers.dev`, reaches the gateway with `CF-Connecting-IP` set to the address shared by all Workers,
`2a06:98c0:3600::103`. All such Workers share one counter per field. A Worker in the same zone as the gateway passes on
the IP of its own client instead.

---

## Supergraph caching

The gateway builds a new Hive Gateway runtime for every request. A runtime reused across requests keeps request-scoped
I/O objects, and Workers rejects them with "Cannot perform I/O on behalf of a different request". A new runtime starts
without a schema, so every request has to load the supergraph SDL.

To avoid a Hive CDN fetch on every request, the gateway hands the runtime a cache kept in module memory. The runtime
stores the SDL there for 60 seconds. Module memory lasts as long as the Worker isolate, so requests served by a warm
isolate reuse the SDL, and a schema published to Hive reaches every isolate within 60 seconds. Without a Hive CDN
token, the gateway uses the bundled `gateway/supergraph.graphql` instead.

This cache used to be a KV namespace. Because the runtime is created per request, it cost one KV read on every request
and one KV write each time the 60-second entry had expired. Memory gives the same result without KV operations; the
cost is one Hive CDN fetch for each new isolate.

---

## Further reading

- [GraphQL Federation v2 specification](https://www.apollographql.com/docs/federation/v2/)
- [Hive Gateway documentation](https://the-guild.dev/graphql/hive/docs/gateway)
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Cloudflare HTTP headers: `CF-Connecting-IP` in Worker subrequests](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip-in-worker-subrequests)
