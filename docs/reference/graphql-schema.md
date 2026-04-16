# GraphQL Schema Reference

This reference documents all types, queries, and fields available in the Frontis unified GraphQL API. All queries are available through the gateway at `/graphql`.

Subgraphs that access D1 databases require the `X-Pilotariak-League` header on every request. Supported values: `lcapb`, `lidfpb`, `ctpb`.

---

## Types

### `Club`

A pelota club (e.g. Denek Bat, Noizbait, Bixintxo).

**Owned by**: `clubs` subgraph

| Field  | Type      | Description        |
| ------ | --------- | ------------------ |
| `id`   | `ID!`     | Unique club ID     |
| `name` | `String!` | Official club name |

---

### `Competition`

An annual competition grouping (e.g. Championnat de France 2025).

**Owned by**: `competitions` subgraph

| Field     | Type         | Description                                                        |
| --------- | ------------ | ------------------------------------------------------------------ |
| `id`      | `ID!`        | Unique competition ID                                              |
| `year`    | `Int!`       | Year of the competition                                            |
| `name`    | `String!`    | Competition name (e.g. Championnat de France)                      |
| `level`   | `String`     | Playing surface / level (e.g. Place Libre, Trinquet, Mur à Gauche) |
| `results` | `[Result!]!` | All match results recorded in this competition                     |

---

### `Specialty`

A Basque pelota discipline (e.g. Place Libre, Trinquet, Mur à Gauche).

**Owned by**: `specialties` subgraph

| Field  | Type      | Description                           |
| ------ | --------- | ------------------------------------- |
| `id`   | `ID!`     | Unique specialty ID                   |
| `name` | `String!` | Human-readable name of the discipline |

---

### `Category`

An age or skill category (e.g. 1ère Série, Seniors, Cadets).

**Owned by**: `categories` subgraph

| Field  | Type      | Description          |
| ------ | --------- | -------------------- |
| `id`   | `ID!`     | Unique category ID   |
| `name` | `String!` | Category name        |

> Categories are returned ordered: names ending in `Série` appear first, then all others alphabetically.

---

### `Result`

A single match result between two clubs.

**Owned by**: `results` subgraph

| Field         | Type           | Description                                              |
| ------------- | -------------- | -------------------------------------------------------- |
| `id`          | `ID!`          | Unique result ID                                                              |
| `competition` | `Competition!` | Competition this result belongs to _(cross-subgraph)_                         |
| `specialty`   | `Specialty!`   | Pelota discipline played _(cross-subgraph)_                                   |
| `category`    | `Category`     | Age/skill category _(cross-subgraph)_                                         |
| `dateMatch`   | `String`       | Date of the match (ISO 8601)                                                  |
| `clubA`       | `Club!`        | Home club _(cross-subgraph)_                                                  |
| `clubB`       | `Club!`        | Away club _(cross-subgraph)_                                                  |
| `scores`      | `String`       | Space-separated set scores (e.g. `"15/10 15/13"` or `"15/09 12/15 06/10"`)   |
| `phase`       | `String`       | Tournament phase (e.g. `Finale`, `1/2 Finale`, `P 8`)                        |
| `clubALineup` | `ClubLineup`   | Players lineup for club A                                                     |
| `clubBLineup` | `ClubLineup`   | Players lineup for club B                                                     |

Fields marked _(cross-subgraph)_ are resolved via entity federation — the gateway fetches them from their owning subgraphs.

---

### `ClubLineup`

The two players representing a club in a match (doubles format).

| Field     | Type     | Description                  |
| --------- | -------- | ---------------------------- |
| `player1` | `Player` | First player                 |
| `player2` | `Player` | Second player (doubles only) |

---

### `Player`

A player participating in a match.

| Field    | Type      | Description                     |
| -------- | --------- | ------------------------------- |
| `name`   | `String!` | Player display name             |
| `number` | `String`  | Jersey number or licence number |

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
competitions(year: Int): [Competition!]!
```

Lists competitions. Optionally filtered by `year`.

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
  phase: String
): [Result!]!
```

Lists results with optional filters. All filters are combinable.

| Argument        | Type  | Description                                       |
| --------------- | ----- | ------------------------------------------------- |
| `competitionId` | `ID`  | Restrict to results belonging to this competition |
| `specialtyId`   | `ID`  | Restrict to results for this discipline           |
| `categoryId`    | `ID`  | Restrict to results for this category             |
| `phase`         | `String` | Exact match on phase string (e.g. `P 8`)       |

---

## Required headers

| Header                | Required by                                                          | Values                     |
| --------------------- | -------------------------------------------------------------------- | -------------------------- |
| `Content-Type`        | All requests                                                         | `application/json`         |
| `X-Pilotariak-League` | `clubs`, `competitions`, `results`, `specialties`, `categories`      | `lcapb`, `lidfpb`, `ctpb`  |
