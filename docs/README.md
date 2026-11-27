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

### Set up a league from scratch

Follow these three guides in order to add a new league, from an empty database to its full results.

| Step | Document                                                         | Description                                                |
| ---- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| 1    | [Create the database](how-to/howto-league-create-database.md)    | D1 database, bindings in every worker, scraper, migrations |
| 2    | [Bootstrap the reference data](how-to/howto-league-bootstrap.md) | League, competitions, specialties and categories           |
| 3    | [Load all results](how-to/howto-league-load-results.md)          | Results of every competition, then the nightly refresh     |

### Other guides

| Document                                                       | Description                                          |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [Develop and run Frontis](how-to/howto-dev.md)                 | Local dev, Docker, scheduler, deploy, port reference |
| [Query the GraphQL API](how-to/howto-query-the-api.md)         | Setup and troubleshooting, one guide per subgraph    |
| [Manage D1 databases](how-to/howto-database.md)                | Migrations, schema, adding leagues                   |
| [Set up a league](how-to/howto-setup-league.md)                | Bootstrap competitions, specialties, and categories  |
| [Use the scheduler](how-to/howto-scheduler.md)                 | Admin page, scrape results, source IDs, cron, logs   |
| [Use the scheduler scripts](how-to/howto-scheduler-scripts.md) | `scrape-competition.sh` and `scrape-all-results.sh`  |
| [Test the rankings locally](how-to/howto-rankings-local.md)    | Scrape rankings, query the subgraph and the gateway  |
| [Publish schemas to Hive](how-to/howto-hive-registry.md)       | Schema registry workflow                             |
| [Add a new subgraph](how-to/howto-add-subgraph.md)             | Introduce a new federated service                    |

---

## Reference — technical specifications

Look these up when you need accurate, factual information.

| Document                                      | Description                                             |
| --------------------------------------------- | ------------------------------------------------------- |
| [GraphQL Schema](reference/graphql-schema.md) | All types, queries, and fields                          |
| [Configuration](reference/configuration.md)   | Environment variables, Wrangler bindings, secrets       |
| [Supported leagues](reference/leagues.md)     | Codes, results sites, D1 databases, scrapers            |
| [Logs](reference/logs.md)                     | Log fields and events of the scheduler and setup-league |
| [Ports](reference/ports.md)                   | Local development port assignments                      |

---

## Explanation — understanding the design

Read these to deepen your understanding of how and why Frontis works the way it does.

| Document                                                  | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| [Architecture](explanation/architecture.md)               | System design, Cloudflare Workers, service bindings, data flow |
| [Federation concepts](explanation/federation-concepts.md) | Entities, `@key`, supergraph SDL, Hive environments            |
