# How to add a new subgraph

This guide walks through adding a new subgraph to the Frontis federation. Use this when you need to introduce a new domain (e.g. `players`, `venues`, `referees`) as an independent service.

---

## Prerequisites

- Familiarity with GraphQL and Cloudflare Workers
- The existing stack running locally (`bun run dev`)
- A Hive Registry access token for the target environment

---

## 1. Create the Worker directory

```bash
mkdir subgraphs/<name>
cd subgraphs/<name>
```

Copy `package.json` and `wrangler.toml` from an existing subgraph (e.g. `subgraphs/clubs`) as a starting point.

Update `wrangler.toml`:

```toml
name = "frontis-<name>"
main = "index.ts"
compatibility_date = "2026-03-13"
compatibility_flags = ["nodejs_compat"]

[dev]
inspector_port = <unique_port>   # pick an unused port, see docs/reference/ports.md
```

---

## 2. Write the schema

Create `subgraphs/<name>/schema.graphql`. Declare your entity with `@key`:

```graphql
extend schema
  @link(
    url: "https://specs.apollo.dev/federation/v2.5"
    import: ["@key"]
  )

"""
A brief description of this entity.
"""
type <Entity> @key(fields: "id") {
  id: ID!
  # ... your fields
}

type Query {
  <entity>(id: ID!): <Entity>
  <entities>: [<Entity>!]!
}
```

If your subgraph references entities owned by another subgraph, declare a stub:

```graphql
type Club @key(fields: "id") {
  id: ID!
}
```

---

## 3. Implement the Worker

Create `subgraphs/<name>/index.ts`. The minimal pattern used by all Frontis subgraphs:

```typescript
import { createSchema, createYoga } from "graphql-yoga";
import { buildSubgraphSchema } from "@apollo/subgraph";
import { parse } from "graphql";
import schemaDoc from "./schema.graphql";

// ... resolvers

const schema = buildSubgraphSchema({
  typeDefs: parse(schemaDoc),
  resolvers,
});

const yoga = createYoga({ schema });

export default {
  fetch: yoga.fetch,
};
```

If the subgraph needs D1, add the database bindings and resolve the league database from `X-Pilotariak-League` (see `subgraphs/clubs/db.ts` for the pattern).

---

## 4. Add service binding to the gateway

In `gateway/wrangler.toml`, add:

```toml
[[services]]
binding = "<NAME_UPPER>"
service = "frontis-<name>"
```

In `gateway/index.ts`, wire the new binding into the proxy configuration (follow the existing pattern for `CLUBS`, `COMPETITIONS`, etc.).

---

## 5. Register the port

Add the new subgraph to `docs/reference/ports.md` with its app port and inspector port.

---

## 6. Recompose the supergraph

```bash
bun run compose
```

If composition fails, Hive will report which types conflict. Fix the schema and recompose.

---

## 7. Add the start script

In the root `package.json`, add:

```json
"graphql:<name>:local": "wrangler dev subgraphs/<name>/index.ts --port <port>"
```

And include it in the `dev` concurrently command.

---

## 8. Publish to Hive

After deploying the Worker to Cloudflare:

```bash
bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target pilotariak/frontis/development \
  --service <name> \
  --url https://<name>.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/<name>/schema.graphql
```

See [howto-hive-registry.md](./howto-hive-registry.md) for the full publish workflow.
