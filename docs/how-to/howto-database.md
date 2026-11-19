# How to manage D1 databases

Frontis uses [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) as its
database layer. All league databases share the same schema and are managed from the `database/`
directory.

## Databases

| Binding            | Database name       | League |
| ------------------ | ------------------- | ------ |
| `DB_LEAGUE_LCAPB`  | `pilotariak-lcapb`  | LCAPB  |
| `DB_LEAGUE_LIDFPB` | `pilotariak-lidfpb` | LIDFPB |
| `DB_LEAGUE_CTPB`   | `pilotariak-ctpb`   | CTPB   |
| `DB_LEAGUE_LLPB`   | `pilotariak-llpb`   | LLPB   |

The schema is identical across all databases. Each database is populated independently by the
scheduler worker. [Supported leagues](../reference/leagues.md) lists each league's results site and database ID.

---

## Directory layout

```
database/
├── wrangler.toml          ← D1 bindings for all league databases
├── dummy.ts               ← required by wrangler, never deployed
├── reset.sql              ← wipe scraped data (keeps leagues seed)
├── package.json           ← migration / query / reset scripts
└── migrations/
    ├── 0001_initial.sql             ← full schema (specialties, clubs, competitions, results)
    ├── 0002_source_ids.sql          ← add source_id to lookups; add categories and phases tables
    ├── 0003_competitions_schema.sql ← drop year/level from competitions; add source_id
    ├── 0004_category_id.sql         ← results.category text → category_id FK; add categories table
    ├── 0005_leagues.sql             ← add leagues seed table
    ├── 0006_clean_phases.sql        ← phases cleanup
    ├── 0007_scores.sql              ← replace score_a/score_b ints with a single scores TEXT column
    ├── 0008_competitions_enabled.sql ← add enabled flag (INTEGER 0/1, default 0) to competitions
    ├── 0009_categories_enabled.sql   ← add enabled flag (INTEGER 0/1, default 0) to categories
    ├── 0010_specialties_enabled.sql  ← add enabled flag (INTEGER 0/1, default 0) to specialties
    ├── 0011_indexes.sql              ← secondary indexes on results filters and source_id lookups
    ├── 0012_rankings.sql             ← end-of-championship rankings (rankings, ranking_players)
    └── 0013_result_players.sql       ← players of the results, one row each (result_players)
```

---

## Applying migrations

### Local (wrangler dev)

Apply pending migrations to the local SQLite files used by `wrangler dev`:

```bash
bun run migrate:local
```

This runs (one per league):

```bash
wrangler d1 migrations apply pilotariak-lcapb --local --persist-to ../.wrangler/state
wrangler d1 migrations apply pilotariak-lidfpb --local --persist-to ../.wrangler/state
wrangler d1 migrations apply pilotariak-ctpb --local --persist-to ../.wrangler/state
wrangler d1 migrations apply pilotariak-llpb --local --persist-to ../.wrangler/state
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

### Output and long queries

`wrangler d1 execute` prints a table. For scripts, or to read wide rows, ask for JSON and use `jq`. Put
a long query in a file:

```bash
cd database

bunx wrangler d1 execute pilotariak-lcapb --local --persist-to ../.wrangler/state --json \
  --command "SELECT id, source_id, name FROM competitions" | jq '.[0].results'

bunx wrangler d1 execute pilotariak-lcapb --local --persist-to ../.wrangler/state --file query.sql
```

A query may span several lines inside `--command`. Wrap it in double quotes and keep SQL strings in
single quotes.

### Interactive shell with sqlite3

wrangler has no interactive SQL shell. The local databases are plain SQLite files under
`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/`, so `sqlite3` can open them. A file is named
after a hash, not after its database: recognise it by its content, here the latest competition:

```bash
for f in .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite; do
  echo "$(sqlite3 -readonly "$f" "SELECT count(*) || ' competitions, latest: ' || coalesce(
    (SELECT name FROM competitions ORDER BY source_id DESC LIMIT 1), '-') FROM competitions" 2>/dev/null) $f"
done
```

LCAPB competitions are named `… CCAPB …`, LIDFPB ones `Compétition …`, and CTPB ones include
`Championnat d'Hiver` or `Tournoi PILOTARIAK`. Old files with no `rankings` table can remain from
earlier states: compare the count with `bun run db:lcapb:local "SELECT count(*) FROM competitions"`.
Then open the file read-only:

```bash
sqlite3 -readonly -box .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite
```

Never write to these files directly, and avoid opening them while `wrangler dev` workers run:
several processes on the same SQLite files can fail with `database is locked`.

---

## Querying the remote database

The production databases are queried the same way, with `--remote`. There is no local copy: every
query runs on Cloudflare D1.

```bash
cd database

bunx wrangler whoami          # logged in? Otherwise: bunx wrangler login
bun run db:lcapb:remote "SELECT count(*) FROM competitions"
bunx wrangler d1 execute pilotariak-lcapb --remote --json --command "SELECT ..." | jq '.[0].results'
bunx wrangler d1 execute pilotariak-lcapb --remote --file query.sql
```

- The remote schema is the one `bun run migrate:remote` applied: check it with `bun run migrate:list`
  before querying a new table such as `rankings`.
- A `DELETE` or `UPDATE` changes production at once. To undo a mistake, D1 Time Travel restores a
  database to an earlier point:
  `bunx wrangler d1 time-travel restore pilotariak-lcapb --timestamp=<unix or RFC 3339>`.
- For an interactive console, open the Cloudflare dashboard: Storage & Databases → D1 → the database
  → Console.

---

## Useful queries

They run unchanged on the local and remote databases.

```sql
-- List all tables, and the columns of one
SELECT name FROM sqlite_master WHERE type = 'table';
PRAGMA table_info(rankings);

-- Row counts per table
SELECT 'specialties' AS t, count(*) FROM specialties
UNION ALL SELECT 'clubs',           count(*) FROM clubs
UNION ALL SELECT 'competitions',    count(*) FROM competitions
UNION ALL SELECT 'categories',      count(*) FROM categories
UNION ALL SELECT 'phases',          count(*) FROM phases
UNION ALL SELECT 'results',         count(*) FROM results
UNION ALL SELECT 'rankings',        count(*) FROM rankings
UNION ALL SELECT 'ranking_players', count(*) FROM ranking_players
UNION ALL SELECT 'result_players', count(*) FROM result_players;

-- Last 10 scraped results (scores is a single TEXT column since 0007, e.g. "15/10 15/13")
SELECT r.date_match, ca.name AS club_a, r.scores, cb.name AS club_b
FROM results r
JOIN clubs ca ON ca.id = r.club_a_id
JOIN clubs cb ON cb.id = r.club_b_id
ORDER BY r.id DESC LIMIT 10;

-- Stored rankings, one row per competition, specialty and category.
-- final = 1 once the ranking has a champion.
SELECT c.name AS competition, s.name AS specialty, k.name AS category,
       count(*) AS teams, max(r.phase = 'Champion') AS final
FROM rankings r
JOIN competitions c ON c.id = r.competition_id
JOIN specialties  s ON s.id = r.specialty_id
JOIN categories   k ON k.id = r.category_id
GROUP BY r.competition_id, r.specialty_id, r.category_id
ORDER BY c.source_id DESC, s.name, k.name;

-- One ranking with its clubs and players (ids from the query above).
-- Some players have a licence but no name: without coalesce, NULL || '…' is
-- NULL and group_concat would silently drop them.
SELECT r.rank, r.phase, cl.name || ' ' || r.team_number AS team,
       group_concat(coalesce(p.name, '?') || ' (' || p.licence || ')', ', ') AS players
FROM rankings r
JOIN clubs cl ON cl.id = r.club_id
LEFT JOIN ranking_players p ON p.ranking_id = r.id
WHERE r.competition_id = <competition id> AND r.specialty_id = <specialty id>
  AND r.category_id = <category id>
GROUP BY r.id
ORDER BY r.rank;

-- The champion of one specialty and category in one season. The season is the
-- competition: its source_id starts with the year the season ends (20260501 is
-- "Championnat … 2025-2026"). A running championship has no 'Champion' row yet:
-- its rank 1 is provisional.
SELECT c.name AS competition, cl.name || ' ' || r.team_number AS champion,
       group_concat(coalesce(p.name, '?') || ' (' || p.licence || ')', ', ') AS players
FROM rankings r
JOIN competitions c ON c.id = r.competition_id
JOIN specialties  s ON s.id = r.specialty_id
JOIN categories   k ON k.id = r.category_id
JOIN clubs cl       ON cl.id = r.club_id
LEFT JOIN ranking_players p ON p.ranking_id = r.id
WHERE r.phase = 'Champion'
  AND c.source_id = '<competition source_id>'
  AND s.name = '<specialty name>' AND k.name = '<category name>'
GROUP BY r.id;

-- Every champion of one season (here 20260501, "Championnat CCAPB 2025-2026"),
-- one row per specialty and category.
SELECT s.name AS specialty, k.name AS category,
       cl.name || ' ' || r.team_number AS champion,
       group_concat(coalesce(p.name, '?') || ' (' || p.licence || ')', ', ') AS players
FROM rankings r
JOIN competitions c ON c.id = r.competition_id
JOIN specialties  s ON s.id = r.specialty_id
JOIN categories   k ON k.id = r.category_id
JOIN clubs cl       ON cl.id = r.club_id
LEFT JOIN ranking_players p ON p.ranking_id = r.id
WHERE r.phase = 'Champion' AND c.source_id = '20260501'
GROUP BY r.id
ORDER BY s.name, k.name;

-- Every ranking of one player, most recent season first. name_key is the
-- name in upper case without accents: p.name_key LIKE '%NAME%' also works.
SELECT c.name AS competition, k.name AS category, r.rank, r.phase
FROM ranking_players p
JOIN rankings r     ON r.id = p.ranking_id
JOIN competitions c ON c.id = r.competition_id
JOIN categories k   ON k.id = r.category_id
WHERE p.licence = '<licence>'
ORDER BY c.source_id DESC;
```

To run one of these queries from the shell, pass it to `wrangler d1 execute` from `database/`. For
example, every champion of the 2025-2026 season in the local LCAPB database:

```bash
cd database

bunx wrangler d1 execute pilotariak-lcapb --local --persist-to ../.wrangler/state \
  --command "SELECT s.name AS specialty, k.name AS category,
       cl.name || ' ' || r.team_number AS champion,
       group_concat(coalesce(p.name, '?') || ' (' || p.licence || ')', ', ') AS players
FROM rankings r
JOIN competitions c ON c.id = r.competition_id
JOIN specialties  s ON s.id = r.specialty_id
JOIN categories   k ON k.id = r.category_id
JOIN clubs cl       ON cl.id = r.club_id
LEFT JOIN ranking_players p ON p.ranking_id = r.id
WHERE r.phase = 'Champion' AND c.source_id = '20260501'
GROUP BY r.id
ORDER BY s.name, k.name;"
```

Replace `--local --persist-to ../.wrangler/state` with `--remote` to query production.

---

## Resetting scraped data

`reset.sql` deletes all scraped rows (results, rankings and their players, competitions,
specialties, categories, clubs, phases) in foreign-key dependency order. The `leagues` table is **preserved** — it is seed data,
not scraped data.

```bash
cd database

# Local D1 state
bun run db:reset:lcapb:local
bun run db:reset:lidfpb:local
bun run db:reset:ctpb:local
bun run db:reset:llpb:local

# Remote (production) — irreversible
bun run db:reset:lcapb:remote
bun run db:reset:lidfpb:remote
bun run db:reset:ctpb:remote
bun run db:reset:llpb:remote
```

> **Note:** After a reset the lookup tables are empty, so `/scrape_results` and `/scrape_rankings`
> fail with "Run /scrape_infos first." Re-run `/scrape_infos` for each competition to repopulate
> competitions / specialties / categories before scraping results or rankings again.

> **Note:** All workers (scheduler and subgraphs) share a single local D1 state at the project
> root: `.wrangler/state/v3/d1/`. This is enforced via `persist_to = "../../.wrangler/state"` in
> every `wrangler.toml` and `--persist-to ../.wrangler/state` in all `database/` scripts.
> Run `bun run migrate:local` once after cloning to apply all migrations before querying.

---

## Creating a new migration

Run the following from the `database/` directory:

```bash
cd database
wrangler d1 migrations create pilotariak-lcapb "<description>"
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

See [Create the database for a new league](howto-league-create-database.md), the first of the three
guides that set up a league from scratch.
