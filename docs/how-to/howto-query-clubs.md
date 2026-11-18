# How to query the clubs subgraph

The `clubs` subgraph serves the club directory of a league: one `Club` per club, with its `id` and
`name`.

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`Club`](../reference/graphql-schema.md#club).

---

## List all clubs

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```

## Fetch a single club by ID

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

## List the results of a club

`Club.results` is added by the results subgraph: see
[All results of a club](howto-query-results.md#all-results-of-a-club).

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)):

```bash
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```
