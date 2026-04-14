# How to publish GraphQL schemas to the Hive Registry

[GraphQL Hive](https://the-guild.dev/graphql/hive) is the schema registry used to track and compose the Frontis federated supergraph. Each subgraph schema must be published to Hive whenever it changes.

## Prerequisites

- A [GraphQL Hive](https://app.graphql-hive.com) account with access to the `pilotariak` organization
- A Hive **Registry Access Token** for the target project (created in Hive → project → Settings → Registry Tokens)

---

## Understanding the `--target` flag

The `--target` flag identifies **where** in Hive the schema is published. It follows the format:

```
<organization>/<project>/<environment>
```

| Part           | Description                                                                   | Example       |
| -------------- | ----------------------------------------------------------------------------- | ------------- |
| `organization` | The Hive organization slug                                                    | `pilotariak`  |
| `project`      | The Hive project slug (maps to this repository)                               | `frontis`     |
| `environment`  | The Hive target (environment) name: `development`, `staging`, or `production` | `development` |

For example, `pilotariak/frontis/development` publishes to the **development** target of the **frontis** project in the **pilotariak** organization.

---

## Publish a single subgraph schema

```bash
bunx @graphql-hive/cli schema:publish \
  --registry.accessToken <YOUR_ACCESS_TOKEN> \
  --target pilotariak/frontis/development \
  --service <subgraph-name> \
  --url https://<subgraph-worker-subdomain>.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/<subgraph-name>/schema.graphql
```

### Flag reference

| Flag                     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `--registry.accessToken` | Registry access token from Hive (keep this secret, use an env variable) |
| `--target`               | `org/project/environment` path (see above)                              |
| `--service`              | The subgraph service name as registered in the supergraph composition   |
| `--url`                  | The deployed URL of this subgraph's GraphQL endpoint                    |
| `--author`               | Free-form author label (use a team name, username, or CI actor)         |

---

## Publish all subgraphs

Run the following commands, one per subgraph, substituting the real Worker URLs and access token:

```bash
export HIVE_TOKEN=<YOUR_ACCESS_TOKEN>
export HIVE_TARGET=pilotariak/frontis/development
export WORKERS_SUBDOMAIN=<your-cloudflare-workers-subdomain>

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service echo \
  --url https://echo.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/echo/schema.graphql

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service specialties \
  --url https://specialties.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/specialties/schema.graphql

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service clubs \
  --url https://clubs.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/clubs/schema.graphql

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service competitions \
  --url https://competitions.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/competitions/schema.graphql

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service categories \
  --url https://frontis-categories.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/categories/schema.graphql

bunx @graphql-hive/cli schema:publish \
  --registry.accessToken $HIVE_TOKEN \
  --target $HIVE_TARGET \
  --service results \
  --url https://results.$WORKERS_SUBDOMAIN.workers.dev/graphql \
  --author Pilotariak \
  subgraphs/results/schema.graphql
```

---

## Environments

| Hive target                      | Use for                                |
| -------------------------------- | -------------------------------------- |
| `pilotariak/frontis/development` | Local development and feature branches |
| `pilotariak/frontis/staging`     | Pre-production validation              |
| `pilotariak/frontis/production`  | Live production release                |

---

## Checking the published schema

After publishing, verify the schema was accepted in the Hive dashboard:

1. Go to [app.graphql-hive.com](https://app.graphql-hive.com)
2. Navigate to **pilotariak** → **frontis** → the target environment
3. Open **Schema** to inspect the published SDL and composition result

If composition fails (e.g. a breaking change between subgraphs), Hive will report the error and the previous valid schema remains active.
