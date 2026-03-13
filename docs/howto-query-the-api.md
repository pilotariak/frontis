# How to query the Frontis GraphQL API

This guide shows how to query the Frontis federated gateway using `curl`. The gateway
stitches together the `echo`, `clubs`, and `competitions` subgraphs behind a single endpoint.

**Gateway endpoint:** `http://localhost:4000/graphql`

All requests to the `clubs` and `competitions` subgraphs require an **`X-Pilotariak-League` header**
identifying the target database. Supported values: `lcapb`, `lidfpb`.

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
curl -s -X POST http://localhost:4003/graphql \
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
curl -s -X POST http://localhost:4003/graphql \
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
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```

### Fetch a single club by ID

```bash
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ club(id: \"1\") { id name } }"}' | jq
```

---

## Specialties (disciplines)

### List all specialties

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialties { id name } }"}' | jq
```

### Fetch a single specialty by ID

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ specialty(id: \"1\") { id name } }"}' | jq
```

---

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

## Results

### List all results

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results { id category phase scoreA scoreB } }"}' | jq
```

### Filter results by competition

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ results(competitionId: \"1\") { id category phase scoreA scoreB } }"}' | jq
```

### Filter results by specialty, category, and phase

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "{ results(specialtyId: \"1\", category: \"Seniors\", phase: \"Finale\") { id scoreA scoreB } }"
  }' | jq
```

---

## Cross-subgraph query (federation in action)

This query spans both subgraphs: `results` and `competition` come from the
`competitions` subgraph, while `clubA` and `clubB` are resolved from
the `clubs` subgraph at query time by the gateway. The `X-Pilotariak-League` header is
forwarded by the gateway to both subgraphs automatically.

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
The `X-Pilotariak-League` header is still required for `clubs` and `competitions`.

| Subgraph     | URL                             |
| ------------ | ------------------------------- |
| echo         | `http://localhost:4003/graphql` |
| clubs        | `http://localhost:4001/graphql` |
| competitions | `http://localhost:4002/graphql` |

```bash
# echo subgraph directly (no X-Pilotariak-League needed)
curl -s -X POST http://localhost:4003/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ echo(message: \"ping\") }"}' | jq

# clubs subgraph directly
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq

# competitions subgraph directly
curl -s -X POST http://localhost:4002/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lidfpb" \
  -d '{"query": "{ competitions { id name year } }"}' | jq
```

> **Note:** Cross-subgraph fields (e.g. `clubA.name` on a `Result`) are only
> resolved when going through the gateway — direct subgraph calls will return
> `null` or an error for those fields.
