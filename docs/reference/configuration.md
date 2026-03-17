# Configuration Reference

This reference documents all environment variables, Wrangler bindings, and configuration settings for the Frontis gateway and subgraphs.

---

## Gateway (`gateway/wrangler.toml`)

### Environment variables

| Variable                    | Required | Default         | Description                                                          |
| --------------------------- | -------- | --------------- | -------------------------------------------------------------------- |
| `ENVIRONMENT`               | no       | `dev`           | Deployment environment identifier (`dev`, `staging`, `production`)   |
| `GRAPHQL_MAX_DEPTH`         | no       | `7`             | Maximum allowed query depth. Deeper queries are rejected.            |
| `GRAPHQL_MAX_TOKENS`        | no       | `1000`          | Maximum number of tokens in a query document.                        |
| `GRAPHQL_MAX_DIRECTIVES`    | no       | `10`            | Maximum number of directives in a query document.                    |
| `HIVE_CDN_ENDPOINT`         | yes (prod)| —              | URL of the Hive CDN artifact endpoint for the supergraph SDL.        |
| `HIVE_CDN_TOKEN`            | yes (prod)| —              | Access token for the Hive CDN. Store as a Wrangler secret.           |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no     | `http://localhost:4318` | OTLP collector endpoint for traces and metrics.           |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | no     | `http/protobuf` | OTLP export protocol. Supported values: `http/protobuf`, `grpc`.    |
| `OTEL_SERVICE_NAME`         | no       | `frontis-gateway`| Service name reported in traces.                                    |
| `OTEL_SERVICE_VERSION`      | no       | `0.1.0`         | Service version reported in traces.                                  |

### Wrangler bindings

#### Service bindings

The gateway calls subgraphs via Cloudflare service bindings (in-process, no public HTTP):

| Binding         | Worker name           | Subgraph      |
| --------------- | --------------------- | ------------- |
| `ECHO`          | `frontis-echo`        | echo          |
| `SPECIALTIES`   | `frontis-specialties` | specialties   |
| `CLUBS`         | `frontis-clubs`       | clubs         |
| `COMPETITIONS`  | `frontis-competitions`| competitions  |
| `RESULTS`       | `frontis-results`     | results       |

#### KV namespaces

| Binding            | Purpose                                      |
| ------------------ | -------------------------------------------- |
| `SUPERGRAPH_CACHE` | Caches the supergraph SDL fetched from Hive CDN. Avoids a remote fetch on every cold start. |

### Observability

The `[observability]` section in `wrangler.toml` enables Cloudflare's built-in Workers observability with 100% head sampling:

```toml
[observability]
enabled = true
head_sampling_rate = 1
```

---

## Subgraphs (`subgraphs/*/wrangler.toml`)

### Shared environment variables

| Variable     | Required | Default | Description                                    |
| ------------ | -------- | ------- | ---------------------------------------------- |
| `ENVIRONMENT`| no       | `dev`   | Deployment environment identifier               |

### D1 database bindings

All D1-backed subgraphs (`clubs`, `competitions`, `results`, `specialties`) bind to league databases:

| Binding             | Database name        | League |
| ------------------- | -------------------- | ------ |
| `DB_LEAGUE_LCAPB`   | `pilotariak_lcapb`   | LCAPB  |
| `DB_LEAGUE_LIDFPB`  | `pilotariak_lidfpb`  | LIDFPB |

The active binding is selected at runtime based on the `X-Pilotariak-League` request header.

---

## Database (`database/wrangler.toml`)

Used exclusively for running migrations. Not deployed as a Worker.

| Binding             | Database name        | Purpose                        |
| ------------------- | -------------------- | ------------------------------ |
| `DB_LEAGUE_LCAPB`   | `pilotariak_lcapb`   | LCAPB league data              |
| `DB_LEAGUE_LIDFPB`  | `pilotariak_lidfpb`  | LIDFPB league data             |

---

## Scheduler (`workers/scheduler/wrangler.toml`)

The `bildu` scheduler Worker runs on a cron trigger and scrapes match results into D1.

### Cron schedule

```
0 3 * * *
```

Runs daily at 03:00 UTC.

### Secrets

| Secret          | Description                                              |
| --------------- | -------------------------------------------------------- |
| (league-specific) | The scheduler may require API keys or session tokens for league websites. Set via `wrangler secret put`. |

---

## Secrets management

Sensitive values must never be stored in `wrangler.toml`. Use Wrangler secrets:

```bash
# Set a secret for the production environment
wrangler secret put HIVE_CDN_TOKEN --env production

# List secrets for a Worker
wrangler secret list
```

Secrets are encrypted at rest and injected as environment variables at runtime.
