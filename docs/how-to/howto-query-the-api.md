# How to query the Frontis GraphQL API

This guide shows how to query the Frontis federated gateway using `curl`. The gateway
stitches together the `echo`, `specialties`, `clubs`, `competitions`, `results`, and `categories`
subgraphs behind a single endpoint.

**Gateway endpoint:** `http://localhost:4000/graphql`

All requests to subgraphs backed by D1 (`specialties`, `clubs`, `competitions`, `results`, `categories`)
require an **`X-Pilotariak-League` header** identifying the target database.
Supported values: `lcapb`, `lidfpb`.

---

## Prerequisites

- The stack is running locally (see [README](../README.md) for startup instructions)
- `curl` is available in your shell

---

## Echo

The echo subgraph is useful for quickly verifying that the gateway is up and routing correctly.
It does not require an `X-Pilotariak-League` header.

### Basic echo

```bash
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ echo(message: \"hello\") }"}' | jq
```

Expected response:

```json
{
  "data": {
    "echo": "hello"
  }
}
```

### Get the Frontis version

```bash
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ version }"}' | jq
```

Expected response:

```json
{
  "data": {
    "version": "0.1.0"
  }
}
```

---

## Clubs

### List all clubs

```bash
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```

### Fetch a single club by ID

```bash
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ club(id: \"1\") { id name } }"}' | jq
```

## Competitions

### List all competitions

```bash
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions { id name year level } }"}' | jq
```

### Filter competitions by year

```bash
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ competitions(year: 2025) { id name year level } }"}' | jq
```

### Fetch a single competition with its results

```bash
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ competition(id: \"1\") { id name year level results { id category phase scoreA scoreB } } }"
  }' | jq
```

---

## Categories

### List all categories

```bash
curl -s -X POST http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```

### Fetch a single category by ID

```bash
curl -s -X POST http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ category(id: \"1\") { id name } }"}' | jq
```

---

## Specialties (disciplines)

### List all specialties

```bash
curl -s -X POST http://localhost:4004/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialties { id name } }"}' | jq
```

### Fetch a single specialty by ID

```bash
curl -s -X POST http://localhost:4004/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialty(id: \"1\") { id name } }"}' | jq
```

---

## Results

### List all results

```bash
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id category phase scoreA scoreB } }"}' | jq
```

### Filter results by competition

```bash
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"1\") { id category phase scoreA scoreB } }"}' | jq
```

### Filter results by specialty, category

```bash
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"1\", category: \"1ère Série\") { id scoreA scoreB clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }'
```

### Filter results by specialty, category, and phase

```bash
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"1\", category: \"1ère Série\", phase: \"GROUPE A Poule phase 1 - F 1\") { id scoreA scoreB clubALineup { player1 { name } player2 { name } } clubBLineup { player1 { name } player2 { name } } } }"
  }' | jq
```

---

## Cross-subgraph query (federation in action)

This query spans multiple subgraphs: `results` come from the `results` subgraph,
`clubA`/`clubB` are resolved from the `clubs` subgraph, and `competition` from the
`competitions` subgraph — all stitched at query time by the gateway. The
`X-Pilotariak-League` header is forwarded to every subgraph automatically.

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "query GetFinales($competitionId: ID!) { results(competitionId: $competitionId, phase: \"Finale\") { id category scoreA scoreB clubA { name } clubB { name } clubALineup { player1 { name number } player2 { name number } } clubBLineup { player1 { name number } player2 { name number } } } }",
    "variables": { "competitionId": "1" }
  }' | jq
```

---

## Using variables

For complex queries, pass variables separately in the request body:

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{
    "query": "query GetClub($id: ID!) { club(id: $id) { id name } }",
    "variables": { "id": "1" }
  }' | jq
```

---

## Querying subgraphs directly

During development you can bypass the gateway and hit subgraphs directly.

All subgraphs (except `echo`) enforce two headers:

- **`X-Pilotariak-League`** — identifies the target D1 database (`lcapb` or `lidfpb`)
- **`x-internal-token`** — shared secret that protects the subgraph from unauthenticated access. In local development the value is `dev-secret` (set in each subgraph's `.dev.vars`).

| Subgraph     | URL                             | League header | Internal token |
| ------------ | ------------------------------- | ------------- | -------------- |
| echo         | `http://localhost:4001/graphql` | no            | no             |
| specialties  | `http://localhost:4004/graphql` | yes           | yes            |
| clubs        | `http://localhost:4003/graphql` | yes           | yes            |
| competitions | `http://localhost:4002/graphql` | yes           | yes            |
| results      | `http://localhost:4005/graphql` | yes           | yes            |
| categories   | `http://localhost:4006/graphql` | yes           | yes            |

```bash
# echo subgraph directly (no headers needed)
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ echo(message: \"ping\") }"}' | jq

# clubs subgraph directly
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq

# competitions subgraph directly
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{"query": "{ competitions { id name year } }"}' | jq

# results subgraph directly
curl -s -X POST http://localhost:4005/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id category phase scoreA scoreB } }"}' | jq

# categories subgraph directly
curl -s -X POST http://localhost:4006/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ categories { id name } }"}' | jq
```

> **Note:** Cross-subgraph fields (e.g. `clubA.name` on a `Result`) are only
> resolved when going through the gateway — direct subgraph calls will return
> `null` or an error for those fields.
