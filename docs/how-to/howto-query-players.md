# How to query player statistics

A `Player` is identified by licence number. The `results` subgraph computes the player's statistics
from the match results of the league (`stats`, `partners`, `opponents`, `results`), and the `rankings`
subgraph adds the team rankings the player appears in (`rankings`). The gateway joins the two on the
licence, so one query returns both.

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)). Every query
below needs the [`X-Pilotariak-League` header](howto-query-the-api.md#the-x-pilotariak-league-header):
statistics are per league, since each league has its own database. Field reference:
[`Player`](../reference/graphql-schema.md#player).

The queries below use the `gql` helper from
[How to query the rankings subgraph](howto-query-rankings.md).

---

## Find a player

By licence, leading zeros included:

```bash
gql 'query ($licence: String!) { player(licence: $licence) { licence name } }' '{"licence": "059063"}' | jq
```

`player` returns `null` when the licence appears in no result and no ranking of the league.

By name, with the matching of `playerRankings(name:)`: every word must appear in the name, ignoring
case, accents and order.

```bash
gql '{ players(name: "nicol guil") { licence name } }' | jq
```

From a match, every lineup player links to its `Player`:

```bash
gql '{ results(limit: 1) { clubALineup { player1 { name number player { licence } } } } }' | jq
```

---

## Statistics

```bash
gql 'query ($licence: String!) {
  player(licence: $licence) {
    name
    stats {
      played won lost setsWon setsLost pointsFor pointsAgainst
      breakdown { competition { name } specialty { name } category { name } played won lost }
    }
    rankings { rank phase competition { name } specialty { name } }
  }
}' '{"licence": "059063"}' | jq
```

| Field                        | Meaning                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `played`                     | Matches the player is listed in                                                    |
| `won`, `lost`                | Matches whose winning side (most sets won) is, or is not, the player's             |
| `setsWon`, `setsLost`        | Sets, from the player's side                                                       |
| `pointsFor`, `pointsAgainst` | Points of every set, from the player's side                                        |
| `breakdown`                  | The same figures per competition, specialty and category, most recent season first |

A match with no score, or with as many sets won by each side, is played but neither won nor lost, so
`won + lost` can be less than `played`.

`stats`, `partners`, `opponents` and `results` take the same optional `competitionId`, `specialtyId`
and `categoryId` filters:

```bash
gql '{ player(licence: "059063") { stats(competitionId: "502", specialtyId: "138") { played won lost } } }' | jq
```

---

## Partners and opponents

```bash
gql '{
  player(licence: "059063") {
    partners { player { licence name } played won lost }
    opponents { player { name } played won lost }
  }
}' | jq
```

Most matches first. `won` and `lost` are those of the player queried: with a partner, the matches won
together; against an opponent, the matches won against them.

---

## Matches

```bash
gql '{ player(licence: "059063") { results(limit: 10) { dateMatch scores clubA { name } clubB { name } } } }' | jq
```

Most recent first, by `dateMatch`. `limit` is clamped to 1..500.

---

## How players are matched

The league sites print a lineup player as a licence and a name: `059063` or
`059063 - 01-330-018` (licence, then licence club), and `NICOL Guillaume` or `PRADERE Bastien (S)`
(name, then a marker). Frontis keeps the licence before the first dash and strips the marker, so the
same player is found whatever the club suffix or marker of each match. A lineup player printed without
a number has no licence and is left out of every statistic.
