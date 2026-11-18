# How to create the database for a new league

This guide is step 1 of 3 to set up a league from scratch:

1. **Create the database** (this guide)
2. [Bootstrap the reference data](howto-league-bootstrap.md)
3. [Load all results](howto-league-load-results.md)

A league is one D1 database, `pilotariak-<league>`. Each worker reaches it through a binding named
`DB_LEAGUE_<LEAGUE>`, which it picks at request time from the league code
(`DB_LEAGUE_${league.toUpperCase()}`). A worker without the binding answers `Unknown league` or
`No database binding`, so every worker that reads or writes league data needs it.

In the commands below, replace `<league>` with the lowercase code (for example `ctpb`) and `<LEAGUE>`
with the uppercase one (`CTPB`).

## Prerequisites

- Wrangler is logged in to the Cloudflare account that holds the `pilotariak-*` databases: run
  `bunx wrangler whoami` to check.
- The league's results site runs the euskalpilota.fr `resultats.php` application, like LCAPB, LIDFPB
  and CTPB. A site built on another application needs its own scraper, which this guide does not
  cover.

---

## 1. Create the D1 database

```bash
cd database
bunx wrangler d1 create pilotariak-<league>
```

Keep the `database_id` it prints. Steps 2 and 3 use it.

---

## 2. Bind the database in every worker

Add this block to each of the 8 `wrangler.toml` files listed below, next to the existing
`DB_LEAGUE_*` blocks:

```toml
[[d1_databases]]
binding = "DB_LEAGUE_<LEAGUE>"
database_name = "pilotariak-<league>"
database_id = "<database_id from step 1>"
migrations_dir = "../../database/migrations"
```

| File                                   | Why it needs the binding                    |
| -------------------------------------- | ------------------------------------------- |
| `database/wrangler.toml`               | Migrations and SQL queries (`database/`)    |
| `workers/setup-league/wrangler.toml`   | `/init` and `/bootstrap` write the league   |
| `workers/scheduler/wrangler.toml`      | `/scrape_infos` and `/scrape_results` write |
| `subgraphs/categories/wrangler.toml`   | GraphQL reads                               |
| `subgraphs/clubs/wrangler.toml`        | GraphQL reads                               |
| `subgraphs/competitions/wrangler.toml` | GraphQL reads                               |
| `subgraphs/results/wrangler.toml`      | GraphQL reads                               |
| `subgraphs/specialties/wrangler.toml`  | GraphQL reads                               |

In `database/wrangler.toml` only, set `migrations_dir = "migrations"`.

The `echo` subgraph and the gateway hold no D1 binding: leave them unchanged.

---

## 3. Declare the binding in the TypeScript `Env` types

Add `DB_LEAGUE_<LEAGUE>: D1Database;` to the `Env` interface in these 7 files:

- `subgraphs/categories/db.ts`
- `subgraphs/clubs/db.ts`
- `subgraphs/competitions/db.ts`
- `subgraphs/results/db.ts`
- `subgraphs/specialties/db.ts`
- `workers/scheduler/src/types.ts`
- `workers/setup-league/src/types.ts`

---

## 4. Register the league scraper in the scheduler

The setup-league worker needs no code change: it reads the league URL from the `leagues` table,
written by `/init` in the [bootstrap guide](howto-league-bootstrap.md). The scheduler keeps one
scraper class per league instead.

1. Create `workers/scheduler/src/leagues/<league>.ts`:

   ```ts
   import { EuskalpilotaScraper } from "./euskalpilota";

   export class <League>Scraper extends EuskalpilotaScraper {
     protected readonly baseUrl = "https://<league>.euskalpilota.fr/resultats.php";
     protected readonly leagueName = "<LEAGUE>";
   }
   ```

   If the site redirects away from `resultats.php` without a `PHPSESSID` cookie, copy
   `leagues/ctpb.ts` instead: it primes a session before each request.

2. Register the class in the `scrapers` map of `workers/scheduler/src/scraper.ts`:

   ```ts
   const scrapers: Record<string, LeagueScraper> = {
     lcapb: new LcapbScraper(),
     lidfpb: new LidfpbScraper(),
     ctpb: new CtpbScraper(),
     <league>: new <League>Scraper(),
   };
   ```

The league URL now lives in two places: `baseUrl` in this class, and the `url` you pass to `/init`.
Keep them identical.

The nightly cron is a separate, per-league choice. It covers only the leagues listed in
`CRON_LEAGUES` in `workers/scheduler/src/index.ts` (CTPB is deliberately left out, and
`index.test.ts` checks it). Add the league there only once its results are loaded: see
[Enrol the league in the nightly refresh](howto-league-load-results.md#5-enrol-the-league-in-the-nightly-refresh).

---

## 5. Add the package scripts

In `database/package.json`:

- Append the league to the three chains `migrate:local`, `migrate:remote` and `migrate:list`, for
  example `&& wrangler d1 migrations apply pilotariak-<league> --remote` in `migrate:remote`.
- Add `db:<league>:local`, `db:<league>:remote`, `db:reset:<league>:local` and
  `db:reset:<league>:remote`, copied from the `ctpb` ones.

In the root `package.json`, add `db:<league>:local`, `db:reset:<league>:local` and
`db:reset:<league>:remote`, copied from the `ctpb` ones. The root has no `db:*:remote` script: run
remote queries from `database/`.

---

## 6. Apply the migrations

Local state, used by `wrangler dev`:

```bash
bun run migrate:local
```

Production:

```bash
cd database
bunx wrangler d1 migrations apply pilotariak-<league> --remote
```

`bun run migrate:remote` works as well. It applies only pending migrations, so the other leagues are
left unchanged.

Check that the `leagues` table exists:

```bash
cd database
bun run db:<league>:remote "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
```

---

## 7. Deploy

The GraphQL schema does not change, so there is nothing to publish to Hive. Deploy the 5 subgraphs
and the 2 workers that gained the binding:

```bash
make cloudflare-deploy SERVICE=subgraphs/categories
make cloudflare-deploy SERVICE=subgraphs/clubs
make cloudflare-deploy SERVICE=subgraphs/competitions
make cloudflare-deploy SERVICE=subgraphs/results
make cloudflare-deploy SERVICE=subgraphs/specialties
bun run setup-league:deploy
bun run scheduler:deploy
```

`bun run deploy` deploys the subgraphs and the gateway, but not the scheduler and setup-league
workers.

---

## 8. Update the league lists in the docs

Add the league code where the supported leagues are listed:

- `AGENTS.md` (league codes)
- `docs/how-to/howto-database.md` (databases table)
- `docs/how-to/howto-query-the-api.md` (supported `X-Pilotariak-League` values)
- `docs/reference/graphql-schema.md` (supported `X-Pilotariak-League` values)
- `docs/explanation/architecture.md` (D1 bindings)
- `docs/reference/configuration.md` (D1 bindings)

---

## Verify

The API accepts the new league code once the subgraphs are deployed. It returns an empty list until
the league is bootstrapped:

```bash
curl -s https://frontis-gateway.pilotariak.com/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: <league>" \
  -d '{"query":"{ competitions { id name } }"}'
# {"data":{"competitions":[]}}
```

An `Unknown league: <league>` error means a subgraph was deployed without the binding.

Next: [Bootstrap the reference data](howto-league-bootstrap.md).

---

## Outside this repository

Azkena (the `league` enum of its tools) and Xilo (league detection in Slack messages) keep their own
list of league codes. Open an issue in each repo that should support the new league.
