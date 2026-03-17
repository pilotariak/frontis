# Tutorial: Your first Frontis query

In this tutorial we will set up the Frontis stack locally and run your first cross-subgraph GraphQL query. By the end you will have seen federation in action: a single request that pulls data from three independent subgraphs.

**What you will build**: a query that returns the finalists of a pelota competition, with club names and player rosters — data that lives across three subgraphs (`results`, `clubs`, and `competitions`), stitched together by the gateway.

---

## Prerequisites

Before we start, make sure you have:

- [Bun](https://bun.sh) >= 1.1 installed (`bun --version`)
- `curl` and `jq` available in your shell
- The repository cloned locally

---

## Step 1 — Install dependencies

From the repository root, run:

```bash
bun install
```

You should see Bun resolve and install all packages. Wrangler CLI is installed automatically as a dev dependency.

---

## Step 2 — Compose the supergraph

The gateway needs a `supergraph.graphql` file that describes the merged schema from all subgraphs. Generate it now:

```bash
bun run compose
```

Expected output ends with something like:

```
✔  Supergraph SDL written to gateway/supergraph.graphql
```

This file is the stitched schema that Hive Gateway reads at startup.

---

## Step 3 — Start all services

Start the gateway and all five subgraphs with a single command:

```bash
bun run dev
```

Wait until you see all six services report ready. Each one listens on its own port:

| Service      | URL                           |
| ------------ | ----------------------------- |
| gateway      | http://localhost:4000/graphql |
| echo         | http://localhost:4001/graphql |
| competitions | http://localhost:4002/graphql |
| clubs        | http://localhost:4003/graphql |
| specialties  | http://localhost:4004/graphql |
| results      | http://localhost:4005/graphql |

---

## Step 4 — Verify the gateway is running

In a new terminal, send a liveness check to the echo subgraph through the gateway:

```bash
curl -s -X POST http://localhost:4000/graphql \
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

The gateway received your request and routed it to the `echo` subgraph. Federation is working.

---

## Step 5 — Query a single subgraph

Let's fetch all clubs from the `clubs` subgraph. Note the `X-Pilotariak-League` header — it tells all D1-backed subgraphs which database to query.

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{"query": "{ clubs { id name } }"}' | jq
```

You will get a list of pelota clubs registered in the LCAPB league database.

---

## Step 6 — Your first cross-subgraph query

Now for the interesting part. This query asks for match results **and** the names of the clubs involved **and** which competition they belong to — three subgraphs in a single request:

```bash
curl -s -X POST http://localhost:4000/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: lcapb" \
  -d '{
    "query": "query GetFinales($competitionId: ID!) { results(competitionId: $competitionId, phase: \"Finale\") { id scoreA scoreB clubA { name } clubB { name } competition { name year } } }",
    "variables": { "competitionId": "1" }
  }' | jq
```

What is happening behind the scenes:

1. The gateway receives the query and consults the supergraph schema.
2. `results` fields are fetched from the **results** subgraph.
3. `clubA { name }` and `clubB { name }` are resolved by the **clubs** subgraph using the `id` keys from step 2.
4. `competition { name year }` is resolved by the **competitions** subgraph.
5. The gateway merges all responses and returns one unified JSON to you.

---

## What you learned

- How to start the full Frontis stack locally.
- What the `X-Pilotariak-League` header is and why it is required.
- How GraphQL federation transparently stitches data from multiple subgraphs into one response.

## Next steps

- See the **[How-to guides](../how-to/)** for specific tasks like deploying to Cloudflare Workers or adding a new league.
- Read the **[Explanation: Architecture](../explanation/architecture.md)** to understand why the system is designed this way.
- Browse the **[GraphQL Schema Reference](../reference/graphql-schema.md)** for all available types and queries.
