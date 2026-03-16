# frontis

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/Pilotariak/frontis/blob/main/LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Pilotariak/frontis/badge)](https://scorecard.dev/viewer/?uri=github.com/Pilotariak/frontis)
[![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/xxxxxx/badge)](https://bestpractices.coreinfrastructure.org/projects/xxxxxxx)

## Overview

**Frontis** is the GraphQL federation gateway for the Pilotariak platform — a Basque pelota competition management system.

It uses [Hive Gateway](https://the-guild.dev/graphql/hive/docs/gateway) to federate five subgraphs:

| Subgraph       | Port | Inspector | Owns               |
| -------------- | ---- | --------- | ------------------ |
| `echo`         | 4001 | 9229      | liveness, version  |
| `clubs`        | 4003 | 9230      | `Club`             |
| `competitions` | 4002 | 9231      | `Competition`      |
| `results`      | 4005 | 9235      | `Result`, `Player` |
| `specialties`  | 4004 | 9234      | `Specialty`        |

The gateway runs on **port 4000** (inspector: **9232**) and presents a unified schema to clients.

## Getting Started

```bash
bun install
bun run compose
bun run dev  # gateway + all subgraphs
```

Gateway available at `http://localhost:4000/graphql`.

## Architecture

```
clients
  │
  ▼
gateway (Hive Gateway, :4000)
  ├─── echo (:4003)         — liveness, version
  ├─── specialties (:4004)  — Specialty entities
  ├─── clubs (:4001)        — Club entities
  ├─── competitions (:4002) — Competition entities
  └─── results (:4005)      — Result, Player entities
```

## How-to guides

| Guide                                                        | Description                                          |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| [`docs/howto-dev.md`](docs/howto-dev.md)                     | Local dev, Docker, scheduler, deploy, port reference |
| [`docs/howto-query-the-api.md`](docs/howto-query-the-api.md) | curl examples for all GraphQL queries                |
| [`docs/howto-database.md`](docs/howto-database.md)           | D1 migrations, schema, adding new leagues            |

Federation v2.5 is used. Each subgraph owns its entities and declares stubs for
entities owned by others via `@key` directives. The gateway stitches them at query
time — e.g. `Result` references `Competition`, `Club`, and `Specialty` entities
resolved from their respective subgraphs.

## Example queries

See [`operations/`](operations/) for ready-to-use GraphQL operations.

```graphql
# Cross-subgraph: Result from results subgraph + Club from clubs subgraph
# + Competition from competitions subgraph — all stitched by the gateway
query GetFinales($competitionId: ID!) {
  results(competitionId: $competitionId, phase: "Finale") {
    scoreA
    scoreB
    clubA {
      name
    } # resolved from the clubs subgraph
    clubB {
      name
    }
    clubALineup {
      player1 {
        name
        number
      }
    }
  }
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
See [CONTRIBUTING](CONTRIBUTING.md)

## License

See [LICENSE](LICENSE)
