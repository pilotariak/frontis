# How to query the results subgraph

The `results` subgraph serves the match results of a league: the two clubs, their lineups, the
scores and the phase of each match. It also adds a `results` field to `Club`, `Specialty` and
`Category`.

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`Result`](../reference/graphql-schema.md#result).

`results` accepts five optional filters: `competitionId`, `specialtyId`, `categoryId`,
`clubId` (matches either side of the match) and `phase`. Results are ordered by `id` and
paginated with `limit` (default 100, max 500) and `offset` (default 0).

---

## About `phase` values

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

## List all results

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id phase scores } }"}' | jq
```

## Filter results by competition

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"322\") { id phase scores } }"}' | jq
```

## Filter results by specialty and category

Use the IDs returned by the `specialties` and `categories` queries (see
[Query the specialties subgraph](howto-query-specialties.md) and
[Query the categories subgraph](howto-query-categories.md)).

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"81\", categoryId: \"1435\") { id phase scores clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }' | jq
```

## Filter results by specialty, category, and phase

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"81\", categoryId: \"1435\", phase: \"P 8\") { id scores clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }' | jq
```

## Paginate results

Page through a large competition 50 results at a time:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"322\", limit: 50, offset: 50) { id phase scores } }"}' | jq
```

## Parsed sets and winner

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

## All results of a club

Either filter with `clubId`, or start from the club and walk the reverse edge. Both
return the matches where the club played as `clubA` or `clubB`:

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ club(id: \"417\") { name results(limit: 20) { dateMatch phase scores winner { name } } } }"}' | jq
```

`Specialty.results` and `Category.results` work the same way.

For the finals of a competition with club names, categories and lineups resolved from the other
subgraphs, see [Cross-subgraph query](howto-query-the-api.md#cross-subgraph-query-federation-in-action).

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)). Fields owned by
other subgraphs, such as `clubA { name }`, are not resolved this way:

```bash
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id phase scores } }"}' | jq
```
