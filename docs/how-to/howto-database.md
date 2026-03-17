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
    └── 0001_initial.sql   ← full schema (specialties, clubs, competitions, results)
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
wrangler d1 migrations apply pilotariak_lcapb --local
wrangler d1 migrations apply pilotariak_lidfpb --local
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
