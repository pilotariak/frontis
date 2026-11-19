# GraphQL Schema Reference

This reference documents all types, queries, and fields available in the Frontis unified GraphQL API. All queries are available through the gateway at `/graphql`.

Subgraphs that access D1 databases require the `X-Pilotariak-League` header on every request. Supported values: `lcapb`, `lidfpb`, `ctpb`, `llpb` (see [Supported leagues](leagues.md)).

---

## Types

### `Club`

A pelota club (e.g. Denek Bat, Noizbait, Bixintxo).

**Owned by**: `clubs` subgraph

| Field     | Type         | Description                                                                  |
| --------- | ------------ | ---------------------------------------------------------------------------- |
| `id`      | `ID!`        | Unique club ID                                                               |
| `name`    | `String!`    | Official club name                                                           |
| `results` | `[Result!]!` | Matches where the club played as A or B _(from `results`)_, `limit`/`offset` |

---

### `Competition`

A competition (e.g. Championnat LCAPB 2025-2026).

**Owned by**: `competitions` subgraph

| Field       | Type         | Description                                        |
| ----------- | ------------ | -------------------------------------------------- |
| `id`        | `ID!`        | Unique competition ID                              |
| `source_id` | `String`     | Identifier used by the source league system        |
| `name`      | `String!`    | Competition name                                   |
| `enabled`   | `Boolean!`   | `true` once the scheduler has saved results for it |
| `results`   | `[Result!]!` | All match results recorded in this competition     |

---

### `Specialty`

A Basque pelota discipline (e.g. Place Libre, Trinquet, Mur à Gauche).

**Owned by**: `specialties` subgraph

| Field     | Type         | Description                                                            |
| --------- | ------------ | ---------------------------------------------------------------------- |
| `id`      | `ID!`        | Unique specialty ID                                                    |
| `name`    | `String!`    | Human-readable name of the discipline                                  |
| `results` | `[Result!]!` | Matches played in this discipline _(from `results`)_, `limit`/`offset` |

---

### `Category`

An age or skill category (e.g. 1ère Série, Seniors, Cadets).

**Owned by**: `categories` subgraph

| Field     | Type         | Description                                                          |
| --------- | ------------ | -------------------------------------------------------------------- |
| `id`      | `ID!`        | Unique category ID                                                   |
| `name`    | `String!`    | Category name                                                        |
| `results` | `[Result!]!` | Matches played in this category _(from `results`)_, `limit`/`offset` |

> Categories are returned ordered: names ending in `Série` appear first, then all others alphabetically.

---

### `Result`

A single match result between two clubs.

**Owned by**: `results` subgraph

| Field         | Type           | Description                                                                    |
| ------------- | -------------- | ------------------------------------------------------------------------------ |
| `id`          | `ID!`          | Unique result ID                                                               |
| `competition` | `Competition!` | Competition this result belongs to _(cross-subgraph)_                          |
| `specialty`   | `Specialty!`   | Pelota discipline played _(cross-subgraph)_                                    |
| `category`    | `Category`     | Age/skill category _(cross-subgraph)_                                          |
| `dateMatch`   | `String`       | Date of the match as stored by the source (`DD/MM/YYYY`)                       |
| `clubA`       | `Club!`        | Home club _(cross-subgraph)_                                                   |
| `clubB`       | `Club!`        | Away club _(cross-subgraph)_                                                   |
| `scores`      | `String`       | Space-separated set scores (e.g. `"15/10 15/13"` or `"15/09 12/15 06/10"`)     |
| `sets`        | `[SetScore!]!` | `scores` parsed into per-set integers; empty when unparseable                  |
| `winner`      | `Club`         | Club with the most sets won; `null` on tie or missing score _(cross-subgraph)_ |
| `phase`       | `String`       | Tournament phase code (e.g. `P 8`, `D 1`, `F 1`)                               |
| `clubALineup` | `ClubLineup`   | Players lineup for club A                                                      |
| `clubBLineup` | `ClubLineup`   | Players lineup for club B                                                      |

Fields marked _(cross-subgraph)_ are resolved via entity federation — the gateway fetches them from their owning subgraphs.

---

### `SetScore`

One set of a match, parsed from `Result.scores`.

| Field | Type   | Description             |
| ----- | ------ | ----------------------- |
| `a`   | `Int!` | Points scored by club A |
| `b`   | `Int!` | Points scored by club B |

---

### `ClubLineup`

The two players representing a club in a match (doubles format).

| Field     | Type           | Description                  |
| --------- | -------------- | ---------------------------- |
| `player1` | `LineupPlayer` | First player                 |
| `player2` | `LineupPlayer` | Second player (doubles only) |

---

### `LineupPlayer`

A player of a match lineup, as the league site prints it. Named `Player` before the `Player` entity
existed; the fields are unchanged.

| Field    | Type      | Description                                                                      |
| -------- | --------- | -------------------------------------------------------------------------------- |
| `name`   | `String!` | Name as printed, marker included (`PRADERE Bastien (S)`)                         |
| `number` | `String`  | Licence, optionally followed by the licence club (`097866 - 01-641-015`)         |
| `player` | `Player`  | The player of that licence, for their statistics; `null` when there is no number |

---

### `Player`

A player, identified by licence number. Statistics come from the match results of the league selected
by `X-Pilotariak-League`.

**Owned by**: `results` subgraph (`name`, `stats`, `partners`, `opponents`, `results`) and `rankings`
subgraph (`rankings`), joined on the `licence` key.

| Field       | Type                | Description                                                                                 |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `licence`   | `String!`           | Licence number, leading zeros kept (`059063`)                                               |
| `name`      | `String`            | Name as printed in the player's results, marker stripped; else in their latest ranking      |
| `stats`     | `PlayerStats!`      | Match statistics; takes `competitionId`, `specialtyId`, `categoryId`                        |
| `partners`  | `[PlayerMatchup!]!` | Players met on the same side, most matches first; same filters as `stats`                   |
| `opponents` | `[PlayerMatchup!]!` | Players met on the other side, most matches first; same filters as `stats`                  |
| `results`   | `[Result!]!`        | The player's matches, most recent first; same filters as `stats`, plus `limit` and `offset` |
| `rankings`  | `[TeamRanking!]!`   | Team rankings the player appears in, as `playerRankings(licence: …)` _(cross-subgraph)_     |

`rankings` takes the `competitionId`, `specialtyId`, `categoryId`, `limit` and `offset` arguments of
`playerRankings`.

---

### `PlayerStats`

Match statistics of a player. A match with no score, or with as many sets won by each side, counts as
played but neither won nor lost, so `won + lost` can be less than `played`.

| Field           | Type                  | Description                                                                        |
| --------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `played`        | `Int!`                | Matches played                                                                     |
| `won`           | `Int!`                | Matches won (the player's side won the most sets)                                  |
| `lost`          | `Int!`                | Matches lost                                                                       |
| `setsWon`       | `Int!`                | Sets won, over every match                                                         |
| `setsLost`      | `Int!`                | Sets lost, over every match                                                        |
| `pointsFor`     | `Int!`                | Points scored by the player's side, over every set                                 |
| `pointsAgainst` | `Int!`                | Points scored by the other side, over every set                                    |
| `breakdown`     | `[PlayerStatsLine!]!` | The same figures per competition, specialty and category, most recent season first |

---

### `PlayerStatsLine`

The statistics of a player in one competition, specialty and category: the `PlayerStats` counters plus
`competition: Competition!`, `specialty: Specialty!` and `category: Category` _(cross-subgraph)_.

---

### `PlayerMatchup`

Another player and the matches shared with them. `won` and `lost` are those of the player queried.

| Field    | Type      | Description                                                    |
| -------- | --------- | -------------------------------------------------------------- |
| `player` | `Player!` | The other player                                               |
| `played` | `Int!`    | Matches played together (partners) or against them (opponents) |
| `won`    | `Int!`    | Of those, matches won                                          |
| `lost`   | `Int!`    | Of those, matches lost                                         |

---

### `TeamRanking`

One team's line in the end-of-championship ranking ("Classement à la fin du championnat") of a
competition, specialty and category, as published by the league site.

**Owned by**: `rankings` subgraph

| Field         | Type               | Description                                                                         |
| ------------- | ------------------ | ----------------------------------------------------------------------------------- |
| `id`          | `ID!`              | Unique team ranking ID                                                              |
| `competition` | `Competition!`     | Competition (season) _(cross-subgraph)_                                             |
| `specialty`   | `Specialty!`       | Pelota discipline _(cross-subgraph)_                                                |
| `category`    | `Category!`        | Category (series or age group) _(cross-subgraph)_                                   |
| `club`        | `Club!`            | Club the team plays for _(cross-subgraph)_                                          |
| `teamNumber`  | `Int!`             | Team number within the club (the site's "Equipe" column)                            |
| `rank`        | `Int!`             | Final rank, 1 for the champion                                                      |
| `phase`       | `String!`          | Phase reached, as printed: `Champion`, `Finale`, `1/2 finale`, `Poules`, `FORFAIT`… |
| `final`       | `Boolean!`         | `true` once the ranking has a champion; `false` while the championship runs         |
| `players`     | `[RankedPlayer!]!` | Players of the team, in the site's order (two or three)                             |

> While a championship runs the site already publishes its end-of-championship ranking, with
> provisional ranks and phases. `final` tells the two apart.
>
> The champion is the rank-1 team of a ranking whose `final` is `true`; its `phase` is `Champion`.
> There is no `champions` query: see
> [The champions of a season](../how-to/howto-query-rankings.md#the-champions-of-a-season).

---

### `RankedPlayer`

A player of a ranked team.

| Field     | Type      | Description                                                               |
| --------- | --------- | ------------------------------------------------------------------------- |
| `licence` | `String!` | Licence number, leading zeros kept; stable from one season to the next    |
| `name`    | `String`  | Name as printed by the site (`NAME Firstname`); `null` for a bare licence |

---

## Queries

### `echo` — echo subgraph

```graphql
echo(message: String!): String!
```

Echoes back the provided message. Useful for liveness checks. Does not require `X-Pilotariak-League`.

---

### `version` — echo subgraph

```graphql
version: String!
```

Returns the current version of the Frontis project. Does not require `X-Pilotariak-League`.

---

### `club` — clubs subgraph

```graphql
club(id: ID!): Club
```

Fetches a single club by its ID. Returns `null` if not found.

---

### `clubs` — clubs subgraph

```graphql
clubs: [Club!]!
```

Lists all clubs in the league database identified by `X-Pilotariak-League`.

---

### `competition` — competitions subgraph

```graphql
competition(id: ID!): Competition
```

Fetches a single competition by its ID. Returns `null` if not found.

---

### `competitions` — competitions subgraph

```graphql
competitions(enabled: Boolean): [Competition!]!
```

Lists competitions ordered by `id`. Pass `enabled: true` to keep only competitions that have results, `enabled: false` for the opposite, or omit the argument for all of them.

---

### `specialty` — specialties subgraph

```graphql
specialty(id: ID!): Specialty
```

Fetches a single specialty by its ID. Returns `null` if not found.

---

### `specialties` — specialties subgraph

```graphql
specialties: [Specialty!]!
```

Lists all specialties (pelota disciplines).

---

### `result` — results subgraph

```graphql
result(id: ID!): Result
```

Fetches a single result by its ID. Returns `null` if not found.

---

### `results` — results subgraph

```graphql
results(
  competitionId: ID
  specialtyId: ID
  categoryId: ID
  clubId: ID
  phase: String
  limit: Int = 100
  offset: Int = 0
): [Result!]!
```

Lists results ordered by `id` with optional filters. All filters are combinable. A non-numeric ID argument returns a `BAD_USER_INPUT` error.

| Argument        | Type     | Description                                          |
| --------------- | -------- | ---------------------------------------------------- |
| `competitionId` | `ID`     | Restrict to results belonging to this competition    |
| `specialtyId`   | `ID`     | Restrict to results for this discipline              |
| `categoryId`    | `ID`     | Restrict to results for this category                |
| `clubId`        | `ID`     | Restrict to matches where this club played as A or B |
| `phase`         | `String` | Exact match on phase code (e.g. `P 8`)               |
| `limit`         | `Int`    | Page size, clamped to 1..500 (default 100)           |
| `offset`        | `Int`    | Number of results to skip (default 0)                |

The same `limit`/`offset` arguments are available on `Club.results`, `Specialty.results` and `Category.results`.

---

### `player` — results subgraph

```graphql
player(licence: String!): Player
```

A player by exact licence number, leading zeros included. Returns `null` when the licence appears in no
result and no ranking of the league. An empty licence returns a `BAD_USER_INPUT` error.

```graphql
{
  player(licence: "059063") {
    name
    stats { played won lost setsWon setsLost }
    rankings { rank phase }
  }
}
```

---

### `players` — results subgraph

```graphql
players(name: String!, limit: Int = 100, offset: Int = 0): [Player!]!
```

Players whose name matches, in name order, with the same matching as `playerRankings(name:)`: every
word must appear in the name, ignoring case, accents and order, and words of one character are ignored.
Only players with results are found. `limit` is clamped to 1..500.

---

### `teamRanking` — rankings subgraph

```graphql
teamRanking(id: ID!): TeamRanking
```

Fetches a single team ranking by its ID. Returns `null` if not found.

---

### `rankings` — rankings subgraph

```graphql
rankings(competitionId: ID!, specialtyId: ID!, categoryId: ID!): [TeamRanking!]!
```

The end-of-championship ranking of one competition, specialty and category, ordered by rank, as the
league site shows it. Empty when the site publishes none.

---

### `playerRankings` — rankings subgraph

```graphql
playerRankings(
  licence: String
  name: String
  competitionId: ID
  specialtyId: ID
  categoryId: ID
  limit: Int = 100
  offset: Int = 0
): [TeamRanking!]!
```

Every team ranking a player appears in, most recent season first. Give `licence`, `name`, or both;
neither returns a `BAD_USER_INPUT` error.

| Argument        | Type     | Description                                                                                                       |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `licence`       | `String` | Exact licence number, leading zeros included (`000101`)                                                           |
| `name`          | `String` | Every word must appear in the player's name, ignoring case, accents and order; words of one character are ignored |
| `competitionId` | `ID`     | Restrict to this competition                                                                                      |
| `specialtyId`   | `ID`     | Restrict to this discipline                                                                                       |
| `categoryId`    | `ID`     | Restrict to this category                                                                                         |
| `limit`         | `Int`    | Page size, clamped to 1..500 (default 100)                                                                        |
| `offset`        | `Int`    | Number of rankings to skip (default 0)                                                                            |

`"ane etxeberri"` and `"Etxeberri"` both find `ETXEBERRI Ane`. A word matches anywhere in the name, so
`"Ane"` also finds `ANETTE`.

---

## Required headers

| Header                | Required by                                                                 | Values                            |
| --------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `Content-Type`        | All requests                                                                | `application/json`                |
| `X-Pilotariak-League` | `clubs`, `competitions`, `results`, `specialties`, `categories`, `rankings` | `lcapb`, `lidfpb`, `ctpb`, `llpb` |
