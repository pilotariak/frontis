# How to query the specialties subgraph

The `specialties` subgraph serves the Basque pelota disciplines of a league (e.g. Place Libre,
Trinquet, Mur à Gauche).

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`Specialty`](../reference/graphql-schema.md#specialty).

---

## List all specialties

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialties { id name } }"}' | jq
```

## Fetch a single specialty by ID

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialty(id: \"81\") { id name } }"}' | jq
```

## List the results of a specialty

`Specialty.results` is added by the results subgraph: see
[All results of a club](howto-query-results.md#all-results-of-a-club), which works the same way.

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)):

```bash
curl -s -X POST http://localhost:4004/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialties { id name } }"}' | jq
```
