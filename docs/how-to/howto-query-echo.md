# How to query the echo subgraph

The `echo` subgraph is useful for quickly verifying that the gateway is up and routing correctly.
It reads no database, so it does not require an `X-Pilotariak-League` header.

Before you start, export `FRONTIS_GW` (see [Setup](howto-query-the-api.md#setup)).
Field reference: [`echo`](../reference/graphql-schema.md#echo--echo-subgraph) and
[`version`](../reference/graphql-schema.md#version--echo-subgraph).

---

## Basic echo

```bash
curl -s -X POST "$FRONTIS_GW" \
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

## Get the Frontis version

```bash
curl -s -X POST "$FRONTIS_GW" \
  -H "Content-Type: application/json" \
  -d '{"query": "{ version }"}' | jq
```

Expected response (the value tracks the `echo` subgraph's `package.json` version):

```json
{
  "data": {
    "version": "0.6.0"
  }
}
```

---

## Query the subgraph directly

Locally, you can skip the gateway (see
[Querying subgraphs directly](howto-query-the-api.md#querying-subgraphs-directly)). The echo
subgraph needs the internal token only, no league header:

```bash
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -H "x-internal-token: dev-secret" \
  -d '{"query": "{ echo(message: \"ping\") }"}' | jq
```
