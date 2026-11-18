# How to query the rankings subgraph

The `rankings` subgraph serves the end-of-championship rankings ("Classement à la fin du
championnat") the league sites publish: one `TeamRanking` per team of a competition, specialty and
category, with its rank, the phase it reached and its players. The scheduler loads them with
`/scrape_rankings` (see [Use the scheduler](howto-scheduler.md)).

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header). Field reference:
[`TeamRanking`](../reference/graphql-schema.md#teamranking).

> **Not in production yet.** Until the `rankings` subgraph is deployed and published to Hive, the
> production gateway answers `Cannot query field "rankings"`. Locally, start the gateway on the
> local supergraph, as described in [Test the rankings locally](howto-rankings-local.md#5-query-through-the-gateway).
>
> **About the IDs below.** They come from a local `lcapb` database: competition `444` is
> "Championnat CCAPB 2025-2026", specialty `98` is "Trinquet / P.G. Pleine Masculin", categories
> `881`, `882` and `883` are the 1ère, 2ème and 3ème Série. Look yours up with the `competitions`,
> `specialties` and `categories` queries.

The long queries below are written to a shell variable and turned into the JSON body by `jq`, which
saves escaping every quote:

```bash
gql() { # gql "<query>" ['<variables json>']
  local vars="${2:-}"
  [ -n "$vars" ] || vars='{}'
  curl -s -X POST "$FRONTIS_GW" \
    -H "Content-Type: application/json" \
    -H "X-Pilotariak-League: lcapb" \
    -d "$(jq -n --arg q "$1" --argjson v "$vars" '{query: $q, variables: $v}')"
}
```

---

## About `rank`, `phase` and `final`

| Field   | Meaning                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rank`  | Final rank, as the site prints it. `rankings` returns the teams ordered by it.                                                                 |
| `phase` | Phase the team reached, as printed: `Champion`, `Finale`, `1/2 finale`, `1/4 de finale`, `1/8ème de finale`, `Barrage …`, `Poules`, `FORFAIT`. |
| `final` | `true` once the ranking has a `Champion` row. While the championship runs, the site already publishes a ranking: its ranks are provisional.    |

The champion is therefore the rank-1 team of a ranking whose `final` is `true`; its `phase` is
`Champion`. A rank-1 team with `final: false` only leads a championship that is still running.

## Read a ranking

```bash
gql '{ rankings(competitionId: 444, specialtyId: 98, categoryId: 883) {
  rank phase final teamNumber club { name } players { licence name } } }' | jq
```

The ranking is empty when the league site publishes none for that combination, or when it has not
been scraped yet.

## Find a player

By exact licence number (leading zeros included):

```bash
gql 'query ($licence: String) { playerRankings(licence: $licence) {
  rank phase final competition { name } specialty { name } category { name } club { name } } }' \
  '{"licence": "<licence>"}' | jq
```

By name: every word must appear in the player's name, regardless of case, accents and word order,
and words of one character are ignored. A word matches anywhere in the name, so a short first name
can match longer ones.

```bash
gql 'query ($name: String) { playerRankings(name: $name) {
  rank phase final competition { name } category { name } club { name } players { name } } }' \
  '{"name": "<first name> <last name>"}' | jq
```

The rankings come most recent season first. `competitionId`, `specialtyId` and `categoryId` narrow
the search, and `limit` (default 100, max 500) and `offset` page through it.

## Fetch one team ranking by ID

```bash
gql '{ teamRanking(id: "1") { rank phase final club { name } players { name } } }' | jq
```

## The champions of a season

There is no `champions` query: read the rankings of the season, one alias per category, and keep
the rank-1 teams of the finished ones.

```bash
gql '{
  premiere:  rankings(competitionId: 444, specialtyId: 98, categoryId: 881) { ...team }
  deuxieme:  rankings(competitionId: 444, specialtyId: 98, categoryId: 882) { ...team }
  troisieme: rankings(competitionId: 444, specialtyId: 98, categoryId: 883) { ...team }
}
fragment team on TeamRanking {
  rank phase final teamNumber
  competition { name } specialty { name } category { name } club { name }
  players { licence name }
}' | jq '[.data[][] | select(.rank == 1 and .final) | {
  competition: .competition.name, category: .category.name,
  champion: "\(.club.name) \(.teamNumber)",
  players: [.players[] | "\(.name // "?") (\(.licence))"]
}]'
```

`select(.phase == "Champion")` gives the same teams. A player listed without a name prints as `?`.

## The leaders of a running championship

Drop `and .final` to keep every rank-1 team. For a championship that is still running, such as
competition `545` ("Championnat CCAPB 2026-2027"), these are the provisional leaders, whose phase is
not `Champion` yet:

```bash
gql '{ rankings(competitionId: 545, specialtyId: 98, categoryId: 881) {
  rank phase final club { name } teamNumber } }' \
  | jq '.data.rankings[] | select(.rank == 1)'
```

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)). Club,
competition, specialty and category come back as IDs only:

```bash
curl -s -X POST http://localhost:4007/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ rankings(competitionId: 444, specialtyId: 98, categoryId: 883) { rank phase final club { id } players { licence name } } }"}' | jq
```

---

## Troubleshooting

For errors common to every subgraph, see
[Troubleshooting](howto-query-the-api.md#troubleshooting).

### `BAD_USER_INPUT` — `Give a licence or a name`

`playerRankings` needs `licence`, `name`, or both.

### `BAD_USER_INPUT` — `name must contain a word of two characters or more`

`playerRankings(name:)` ignores words of one character: give at least one longer word.
