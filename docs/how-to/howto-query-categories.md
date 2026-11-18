# How to query the categories subgraph

The `categories` subgraph serves the player categories of a league (series or age groups, e.g.
Seniors, Juniors, 1ère Série).

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`Category`](../reference/graphql-schema.md#category).

---

## List all categories

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```

## Fetch a single category by ID

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ category(id: \"1435\") { id name } }"}' | jq
```

## List the results of a category

`Category.results` is added by the results subgraph: see
[All results of a club](howto-query-results.md#all-results-of-a-club), which works the same way.

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)):

```bash
curl -s -X POST http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```
