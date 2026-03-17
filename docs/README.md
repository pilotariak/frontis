# Frontis Documentation

**Frontis** is the GraphQL federation gateway for the Pilotariak platform — a Basque pelota competition management system. It uses [Hive Gateway](https://the-guild.dev/graphql/hive/docs/gateway) to federate five subgraphs into a single API, running on Cloudflare Workers with D1 databases.

This documentation follows the [Diátaxis](https://diataxis.fr/) framework, organized into four distinct types based on what you need.

---

## Tutorials — learning by doing

Start here if you are new to Frontis.

| Document                                                 | Description                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| [Your first Frontis query](tutorials/getting-started.md) | Set up the stack locally and run your first cross-subgraph query |

---

## How-to guides — solving specific problems

Use these when you know what you want to accomplish and need the steps.

| Document                                                 | Description                                          |
| -------------------------------------------------------- | ---------------------------------------------------- |
| [Develop and run Frontis](how-to/howto-dev.md)           | Local dev, Docker, scheduler, deploy, port reference |
| [Query the GraphQL API](how-to/howto-query-the-api.md)   | curl examples for all queries                        |
| [Manage D1 databases](how-to/howto-database.md)          | Migrations, schema, adding leagues                   |
| [Publish schemas to Hive](how-to/howto-hive-registry.md) | Schema registry workflow                             |
| [Add a new subgraph](how-to/howto-add-subgraph.md)       | Introduce a new federated service                    |

---

## Reference — technical specifications

Look these up when you need accurate, factual information.

| Document                                      | Description                                       |
| --------------------------------------------- | ------------------------------------------------- |
| [GraphQL Schema](reference/graphql-schema.md) | All types, queries, and fields                    |
| [Configuration](reference/configuration.md)   | Environment variables, Wrangler bindings, secrets |
| [Ports](reference/ports.md)                   | Local development port assignments                |

---

## Explanation — understanding the design

Read these to deepen your understanding of how and why Frontis works the way it does.

| Document                                                  | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| [Architecture](explanation/architecture.md)               | System design, Cloudflare Workers, service bindings, data flow |
| [Federation concepts](explanation/federation-concepts.md) | Entities, `@key`, supergraph SDL, Hive environments            |
