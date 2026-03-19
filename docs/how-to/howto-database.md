# How to manage D1 databases

Frontis uses [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) as its
database layer. All league databases share the same schema and are managed from the `database/`
directory.

## Databases

| Binding            | Database name       | League |
| ------------------ | ------------------- | ------ |
| `DB_LEAGUE_LCAPB`  | `pilotariak_lcapb`  | LCAPB  |
| `DB_LEAGUE_LIDFPB` | `pilotariak_lidfpb` | LIDFPB |

The schema is identical across all databases. Each database is populated independently by the
bildu scheduler.

---

## Directory layout

```
database/
├── wrangler.toml          ← D1 bindings for all league databases
├── dummy.ts               ← required by wrangler, never deployed
├── package.json           ← migration scripts
└── migrations/
    ├── 0001_initial.sql             ← full schema (specialties, clubs, competitions, results)
    ├── 0002_source_ids.sql          ← add source_id to lookups; add categories and phases tables
    └── 0003_competitions_schema.sql ← drop year/level from competitions; add source_id
```

---

## Applying migrations

### Local (wrangler dev)

Apply pending migrations to the local SQLite files used by `wrangler dev`:

```bash
bun run migrate:local
```

This runs:

```bash
wrangler d1 migrations apply pilotariak_lcapb --local --persist-to ../.wrangler/state
wrangler d1 migrations apply pilotariak_lidfpb --local --persist-to ../.wrangler/state
```

### Remote (production)

Apply pending migrations to the live Cloudflare D1 databases:

```bash
bun run migrate:remote
```

### Check migration status

List applied and pending migrations for all databases:

```bash
bun run migrate:list
```

---

## Querying the local database

All wrangler commands (scheduler dev, migrations, queries) share a single local state directory
at the project root: `.wrangler/state/`. This is controlled by:

- `persist_to = "../../.wrangler/state"` in `workers/scheduler/wrangler.toml`
- `--persist-to ../.wrangler/state` in every `database/` script

This means data written by `wrangler dev` (the scheduler) is immediately visible when you
query via `bun run db:lcapb:local`.

Use `wrangler d1 execute` to run queries without opening the raw SQLite file.

### From the project root

```bash
bun run db:lcapb:local "SELECT * FROM specialties"
bun run db:lcapb:local "SELECT count(*) FROM results"
bun run db:lcapb:local "SELECT * FROM clubs LIMIT 20"
bun run db:lidfpb:local "SELECT * FROM specialties"
```

### From `database/` (convenience scripts)

```bash
cd database

bun run db:lcapb:local "SELECT * FROM specialties"
bun run db:lcapb:local "SELECT * FROM clubs LIMIT 20"
bun run db:lcapb:local "SELECT count(*) FROM results"
bun run db:lcapb:local "SELECT * FROM results LIMIT 5"

bun run db:lidfpb:local "SELECT * FROM specialties"
```

### Useful queries

```sql
-- List all tables
SELECT name FROM sqlite_master WHERE type = 'table';

-- Row counts per table
SELECT 'specialties' AS t, count(*) FROM specialties
UNION ALL SELECT 'clubs',        count(*) FROM clubs
UNION ALL SELECT 'competitions', count(*) FROM competitions
UNION ALL SELECT 'categories',   count(*) FROM categories
UNION ALL SELECT 'phases',       count(*) FROM phases
UNION ALL SELECT 'results',      count(*) FROM results;

-- Last 10 scraped results
SELECT r.date_match, ca.name AS club_a, r.score_a, r.score_b, cb.name AS club_b
FROM results r
JOIN clubs ca ON ca.id = r.club_a_id
JOIN clubs cb ON cb.id = r.club_b_id
ORDER BY r.id DESC LIMIT 10;
```

> **Note:** All workers (scheduler and subgraphs) share a single local D1 state at the project
> root: `.wrangler/state/v3/d1/`. This is enforced via `persist_to = "../../.wrangler/state"` in
> every `wrangler.toml` and `--persist-to ../.wrangler/state` in all `database/` scripts.
> Run `bun run migrate:local` once after cloning to apply all migrations before querying.

---

## Creating a new migration

Run the following from the `database/` directory:

```bash
cd database
wrangler d1 migrations create pilotariak_lcapb "<description>"
```

This creates a new numbered file in `database/migrations/`, for example:

```
database/migrations/0002_add_index_on_results.sql
```

Edit the file to add your SQL, then apply it to all databases:

```bash
bun run migrate:remote
```

> **Note:** The `wrangler d1 migrations create` command only creates a file — it does not
> apply anything. Always review the SQL before running `migrate:remote`.

---

## Adding a new league

1. Create the D1 database:

   ```bash
   wrangler d1 create pilotariak_<league>
   ```

2. Add a `[[d1_databases]]` binding to `database/wrangler.toml`:

   ```toml
   [[d1_databases]]
   binding = "DB_LEAGUE_<LEAGUE>"
   database_name = "pilotariak_<league>"
   database_id = "<id from step 1>"
   migrations_dir = "migrations"
   ```

3. Add the same binding to `subgraphs/clubs/wrangler.toml` and
   `subgraphs/competitions/wrangler.toml`.

4. Add `DB_LEAGUE_<LEAGUE>: D1Database` to the `Env` interface in
   `subgraphs/clubs/db.ts` and `subgraphs/competitions/db.ts`.

5. Apply migrations:

   ```bash
   cd database
   wrangler d1 migrations apply pilotariak_<league> --remote
   ```

6. Deploy the subgraphs:

   ```bash
   bun run deploy
   ```
