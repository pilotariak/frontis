# frontis

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/Pilotariak/frontis/blob/main/LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Pilotariak/frontis/badge)](https://scorecard.dev/viewer/?uri=github.com/Pilotariak/frontis)
[![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/xxxxxx/badge)](https://bestpractices.coreinfrastructure.org/projects/xxxxxxx)

## Overview

**Frontis** is the GraphQL federation gateway for the Pilotariak platform — a Basque pelota competition management system.

It uses [Hive Gateway](https://the-guild.dev/graphql/hive/docs/gateway) to federate two subgraphs:

| Subgraph | Port | Owns |
|---|---|---|
| `clubs` | 4001 | `Club`, `Specialty` |
| `competitions` | 4002 | `Competition`, `Result` |

The gateway runs on **port 4000** and presents a unified schema to clients.

## Getting Started

### Prerequisites

- Node.js >= 22
- Yarn

### Install

```bash
bun install
```

### Run locally

```bash
# 1. Start subgraphs
bun run clubs        # http://localhost:4001/graphql
bun run competitions # http://localhost:4002/graphql

# 2. Compose the supergraph SDL
bun run compose

# 3. Start the gateway
bun run gateway      # http://localhost:4000/graphql
```

Or start everything at once:

```bash
bun run dev
```

### Docker

```bash
# Compose supergraph with Docker URLs first
bun run compose

docker compose up --build
```

Gateway available at `http://localhost:4000/graphql`.

## Architecture

```
clients
  │
  ▼
gateway (Hive Gateway, :4000)
  ├─── clubs (:4001)       — Specialty, Club entities
  └─── competitions (:4002) — Competition, Result entities
```

Federation v2.5 is used. The `Result` type in the competitions subgraph references
`Club` and `Specialty` entities owned by the clubs subgraph via `@key` directives.
The gateway stitches them at query time.

## Example queries

See [`operations/`](operations/) for ready-to-use GraphQL operations.

```graphql
# Cross-subgraph: Result from the competitions subgraph + Club from the clubs subgraph
query GetFinales($competitionId: ID!) {
  results(competitionId: $competitionId, phase: "Finale") {
    scoreA
    scoreB
    clubA { name city }   # resolved from the clubs subgraph
    clubB { name city }
    clubALineup { player1 { name number } }
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
See [CONTRIBUTING](CONTRIBUTING.md)

## License

See [LICENSE](LICENSE)
