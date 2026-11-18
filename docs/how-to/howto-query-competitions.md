# How to query the competitions subgraph

The `competitions` subgraph serves the competitions of a league. A `Competition` exposes `id`,
`source_id` (the ID on the league website), `name`, `enabled`, and its `results`. There is no `year`
or `level` field: the season is part of the `name` (e.g. `Championnat CCAPB 2025-2026`).

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`Competition`](../reference/graphql-schema.md#competition).

---

## List all competitions

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions { id source_id name } }"}' | jq
```

## List only enabled competitions

A competition is `enabled` once the scheduler has saved results for it. Pass
`enabled: true` to skip the ones that are still empty (or `enabled: false` to see
what has not been scraped yet):

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions(enabled: true) { id source_id name } }"}' | jq
```

The gateway must serve a supergraph that has `Competition.enabled`: see
[Keeping the gateway schema up to date](howto-query-the-api.md#keeping-the-gateway-schema-up-to-date).

## Fetch a single competition with its results

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ competition(id: \"322\") { id name results { id phase scores } } }"
  }' | jq
```

To filter or paginate the results of a competition, use the `results` query instead: see
[Filter results by competition](howto-query-results.md#filter-results-by-competition).

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)):

```bash
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{"query": "{ competitions { id name } }"}' | jq
```
