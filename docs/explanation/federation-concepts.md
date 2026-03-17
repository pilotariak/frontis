# Explanation: GraphQL Federation concepts in Frontis

This document explains the key GraphQL federation concepts used in Frontis and how they relate to each other. It is intended for developers who are new to federation or who want to understand how Frontis uses these primitives.

---

## Entities and ownership

In a federated graph, an **entity** is a type that can be referenced and resolved across subgraphs. An entity is identified by a **key** — one or more fields that uniquely identify an instance.

In Frontis:

| Entity        | Owning subgraph | Key field |
| ------------- | --------------- | --------- |
| `Club`        | clubs           | `id`      |
| `Competition` | competitions    | `id`      |
| `Result`      | results         | `id`      |
| `Specialty`   | specialties     | `id`      |

The `echo` subgraph declares no entities — it has no persistent data.

### The `@key` directive

A subgraph declares ownership with `@key`:

```graphql
type Club @key(fields: "id") {
  id: ID!
  name: String!
}
```

Other subgraphs that need to *reference* `Club` declare a stub — only the key fields, no other fields:

```graphql
# In results/schema.graphql
type Club @key(fields: "id") {
  id: ID!
}
```

The gateway knows: "if you need `Club.name`, ask the clubs subgraph; if you only have a `Club.id`, use it to look it up."

---

## Entity resolution: the `_entities` query

When the gateway resolves a cross-subgraph field, it sends a special `_entities` query to the owning subgraph. This query accepts a list of "representations" (objects with `__typename` and key fields) and returns the full entity.

For the query:

```graphql
{ results { clubA { name } } }
```

The gateway:
1. Fetches all `Result` objects from the results subgraph, requesting `clubA { id }` (the key).
2. Batches the `clubA` ids into a single `_entities` query to the clubs subgraph.
3. Merges the returned `{ name }` values back.

This is transparent to the client. The client writes one query; the gateway handles the coordination.

---

## The supergraph SDL

The **supergraph SDL** is the merged schema built by composing all subgraph schemas. It describes the complete API that clients see, including which fields come from which subgraph.

In local development, the supergraph SDL is built by `bun run compose` and stored in `gateway/supergraph.graphql`. In production, the gateway fetches it from the **Hive CDN** (cached in KV) — this means subgraph schema updates are picked up without redeploying the gateway.

---

## Schema composition and the Hive Registry

Before subgraph schemas can be used in production, they must be **published** to the Hive Registry. Hive:

1. Validates each new subgraph schema for internal consistency.
2. **Composes** all subgraph schemas together and checks for federation-level conflicts (e.g., two subgraphs defining incompatible types).
3. If composition succeeds, makes the new supergraph SDL available on the Hive CDN.
4. If composition fails, the previous valid SDL remains active — the system does not break.

This prevents a bad schema change in one subgraph from silently breaking the entire API.

---

## Environments and targets

Hive tracks schemas per **target** (environment). Frontis uses three:

| Target                             | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `pilotariak/frontis/development`   | Local and feature branch development       |
| `pilotariak/frontis/staging`       | Pre-production validation                  |
| `pilotariak/frontis/production`    | Live production                            |

Each target has its own supergraph SDL. Publishing to `development` does not affect `production`. This gives a safe promotion path: develop → stage → promote.

---

## Header forwarding

The `X-Pilotariak-League` header is attached by the client and must reach every D1-backed subgraph. The gateway forwards all request headers to subgraphs automatically. No special configuration is needed — the header propagates through the service binding calls transparently.

---

## Related documentation

- [Architecture overview](./architecture.md) — the "why" behind design choices
- [GraphQL Schema Reference](../reference/graphql-schema.md) — all types and queries
- [How to publish schemas to Hive](../how-to/howto-hive-registry.md) — practical steps
