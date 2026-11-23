---
adr: 0001
status: ✅ Accepted
deciders: nlamirault
consulted:
informed:
date: 2026-11-23
spdx-license: Apache-2.0
---

# ADR-0001: Keep slot data out of Frontis

## Context

Kancha is getting a slots feature. A slot is a court that a group of friends books at a fixed time, every week or
every other week: for example a trinquet every Wednesday evening. For each session, every player of the group answers
OK, KO or available if needed. A session takes place only when at least four players answer OK, because a trinquet or
mur à gauche game is two against two. Groups range from five to about ten players.

This data has little in common with what Frontis serves today:

- Frontis serves public competition data that its scheduler scrapes from the league websites. Every subgraph schema
  declares queries only: the supergraph has no `Mutation` type.
- The gateway is public and anonymous. It has no end-user authentication.
- Slot data is written by the players themselves. It is private to a group (first names, who comes, who does not) and
  is purged after the season.

Kancha, Azkena, Xilo and Plaza all read Frontis. A change to the supergraph reaches all of them.

The question is where this new data lives.

## Considered Options

1. A `slots` subgraph federated by the Frontis gateway, with mutations and end-user authentication.
2. A separate slots service, pik, in its own repository (`pilotariak/pik`): a Cloudflare Worker and a D1 database that
   Kancha calls directly. Frontis does not change.
3. Slot tables in the existing league D1 databases, written by a new Frontis worker that stays outside the supergraph.

## Pros and Cons

### 1. A federated `slots` subgraph

**Pros:**

- ✅ Kancha keeps a single endpoint and a single GraphQL client.
- ✅ Reuses the Frontis tooling: Bun workspace, Hive registry, deploy scripts.

**Cons:**

- ❌ Adds mutations and end-user authentication to a gateway that is public, anonymous and read-only today.
- ❌ Private data sits behind the same gateway as public data, one configuration mistake away from being readable by
  anyone.
- ❌ Every change to the slots schema goes through supergraph composition, and a broken composition affects every
  downstream repo.

### 2. A separate slots service, pik

**Pros:**

- ✅ Frontis stays public, anonymous and read-only. Nothing changes in this repo.
- ✅ Private data and its access rules live in one place, with its own retention policy.
- ✅ pik can ship, fail or be removed without touching the supergraph.

**Cons:**

- ❌ Kancha talks to a second backend, with its own client and error handling.
- ❌ One more repo, Worker and D1 database to deploy and watch.
- ❌ No single graph across competitions and slots.

### 3. Slot tables in the league databases

**Pros:**

- ✅ No new repo and no new database.

**Cons:**

- ❌ League databases are split by league, while a slot belongs to a group of friends, not to a league.
- ❌ Data that players type in would sit next to scraped data, which `database/reset.sql` deletes and the scrapers
  rebuild.
- ❌ The access rules of a private feature would live in a repo designed around public reads.

## Decision

We will use _option 2_: slot data lives in pik, a separate service in its own repository
([`pilotariak/pik`](https://github.com/pilotariak/pik)), and Kancha calls it directly. Frontis does not store, serve or
proxy slot data, and the gateway does not federate pik.

The reason is the gap between the two kinds of data. Frontis is a public, read-only view of scraped competition data.
Slots are private data written by end users. Keeping them apart keeps each service's blast radius limited to its own
concern.

## Consequences

### Positive

- ✅ The gateway keeps no mutations and no end-user authentication.
- ✅ Kancha, Azkena, Xilo and Plaza see no change.

### Negative

- ❌ A query cannot join competition data and slot data. Kancha resolves both on the client.

### Neutral

- ↔️ If a slot records its specialty as a Frontis specialty id, that id becomes a contract with one more consumer.
  Renumbering specialties would then need a check of pik, as for any downstream repo.
- ↔️ If slots ever need to appear in the graph, for example as Azkena tools, a new ADR will reopen the question. A
  read-only subgraph exposed by pik would be the starting point.

## References

- [Architecture](../explanation/architecture.md)
- [pik: the slots service](https://github.com/pilotariak/pik)
- [Kancha ADR-0001: Call a dedicated slots service next to Frontis](https://github.com/pilotariak/kancha/blob/main/docs/adr/0001-call-a-dedicated-slots-service.md)
- [Slots prototype in Kancha](https://github.com/pilotariak/kancha/tree/main/src/app/%28tabs%29/slot)
