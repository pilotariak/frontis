# frontis

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://github.com/Pilotariak/frontis/blob/main/LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Pilotariak/frontis/badge)](https://scorecard.dev/viewer/?uri=github.com/Pilotariak/frontis)
[![CII Best Practices](https://bestpractices.coreinfrastructure.org/projects/xxxxxx/badge)](https://bestpractices.coreinfrastructure.org/projects/xxxxxxx)

## Overview

**Frontis** is the GraphQL federation gateway for the Pilotariak platform — a Basque pelota competition management system.

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

## Documentation

Documentation follows the [Diátaxis](https://diataxis.fr/) framework — see [`docs/`](docs/) for the full index.

| Type              | Documents                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tutorials**     | [Getting started](docs/tutorials/getting-started.md)                                                                                                                                                                                                |
| **How-to guides** | [Dev & run](docs/how-to/howto-dev.md) · [Query the API](docs/how-to/howto-query-the-api.md) · [Database](docs/how-to/howto-database.md) · [Hive Registry](docs/how-to/howto-hive-registry.md) · [Add a subgraph](docs/how-to/howto-add-subgraph.md) |
| **Reference**     | [GraphQL schema](docs/reference/graphql-schema.md) · [Configuration](docs/reference/configuration.md) · [Ports](docs/reference/ports.md)                                                                                                            |
| **Explanation**   | [Architecture](docs/explanation/architecture.md) · [Federation concepts](docs/explanation/federation-concepts.md)                                                                                                                                   |

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
