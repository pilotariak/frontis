# How to use the Frontis Scheduler

The scheduler is a Cloudflare Worker that scrapes match results from the league websites
([LCAPB](https://lcapb.euskalpilota.fr/resultats.php) and
[LIDFPB](https://lidfpb.euskalpilota.fr/resultats.php)) and writes them into the D1 databases.

It exposes two HTTP endpoints for on-demand scraping and runs automatically on a daily cron
(`0 3 * * *` — every day at 03:00 UTC).

---

## Running locally

```bash
cd workers/scheduler
bun run dev
```

The worker starts on **`http://127.0.0.1:8787`**.

The `--test-scheduled` flag (already in the `dev` script) enables the cron trigger endpoint
so you can fire it manually without waiting for 03:00 UTC.

---

## Endpoints

### `GET /` — built-in help

Browse to `http://127.0.0.1:8787/` for a quick reference of all endpoints and example URLs.

---

### `GET /scrape_infos` — discover source IDs

Fetches the form dropdowns from the league website and returns all available
**competitions**, **specialties**, **clubs**, **categories**, and **phases** with their
`source_id` values.

Run this first to discover the IDs you need for `/scrape_results`.

**Required parameters**

| Parameter     | Description                       |
| ------------- | --------------------------------- |
| `league`      | `lcapb` or `lidfpb`               |

**Optional parameters**

| Parameter     | Default | Description                                              |
| ------------- | ------- | -------------------------------------------------------- |
| `competition` | `""`    | Filter dropdowns to a specific competition `source_id`   |
| `dry_run`     | `false` | If `true`, fetch and display results but do not save     |

**Examples**

```bash
# List all available form options for LCAPB
curl "http://127.0.0.1:8787/scrape_infos?league=lcapb"

# Scope to a specific competition
curl "http://127.0.0.1:8787/scrape_infos?league=lcapb&competition=20260501"

# Dry-run: fetch but do not write to the database
curl "http://127.0.0.1:8787/scrape_infos?league=lcapb&competition=20260501&dry_run=true"

# LIDFPB league
curl "http://127.0.0.1:8787/scrape_infos?league=lidfpb"
```

**Sample output**

```
League : LCAPB  [saved to database]

Competitions (3)
  [20260501] Championnat LCAPB 2026
  [20250501] Championnat LCAPB 2025
  [20240501] Championnat LCAPB 2024

Specialties (4)
  [1] Trinquet/P.G. Pleine Masculin
  [2] Trinquet/P.G. Pleine Féminin
  [3] Grand Chistera Masculin
  [4] Xare Masculin

Categories (4)
  [1] 1ère Série
  [2] 2ème Série
  [3] 3ème Série
  [4] Poussin (stage)

Phases (12)
  [1] GROUPE A Poule phase 1
  ...
```

The bracketed values (e.g. `[20260501]`, `[2]`, `[1]`) are the `source_id`s stored in the
database. To get the internal DB `id` needed by `/scrape_results`, query the database after
running this endpoint:

```bash
npx wrangler d1 execute DB_LEAGUE_LCAPB --command \
  "SELECT id, source_id, name FROM competitions"
```

---

### `GET /scrape_results` — scrape and save match results

Fetches match results from the league website and saves them to the D1 database.
Categories are upserted automatically — if a category name scraped from the HTML is not
yet in the `categories` table it is created on the fly.

Filter parameters (`competition`, `specialty`, `category`, `phase`) are **internal
database IDs** (the `id` primary key column), not `source_id` values.
The worker resolves them to `source_id`s internally before hitting the upstream website.
Use `/scrape_infos` first to seed the database, then query it to obtain the IDs.

**Required parameters**

| Parameter     | Description                                           |
| ------------- | ----------------------------------------------------- |
| `league`      | `lcapb` or `lidfpb`                                   |
| `competition` | Competition DB `id`                                   |

**Optional parameters**

| Parameter   | Default | Description                                                   |
| ----------- | ------- | ------------------------------------------------------------- |
| `specialty` | `0`     | Specialty DB `id`; `0` means all specialties                  |
| `category`  | `0`     | Category DB `id`; `0` means all categories                    |
| `phase`     | `0`     | Phase DB `id`; `0` means all phases                           |
| `dry_run`   | `false` | If `true`, scrape and display results but do not save         |
| `no_color`  | `false` | If `true`, strip ANSI escape codes — useful for browsers      |

**Examples**

```bash
# Look up the DB id for the competition you want first
npx wrangler d1 execute DB_LEAGUE_LCAPB --command \
  "SELECT id, source_id, name FROM competitions"

# All results for competition id=2
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2"

# Filter by specialty id=10 and category id=1
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2&specialty=10&category=1&phase=0"

# Dry-run: preview what would be saved without writing to the database
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2&specialty=10&category=1&dry_run=true"

# Plain-text output (no ANSI colours) — suitable for browser or piping
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2&specialty=10&category=1&no_color=true"

# LIDFPB league, all results for competition id=1
curl "http://127.0.0.1:8787/scrape_results?league=lidfpb&competition=1"
```

**Sample output**

```
League      : LCAPB
Competition : 2
Filters     : specialty=10  category=1  phase=0
Status      : 3 results saved

  2026-03-15  CA BEGLAIS 01                    3 / 1  AVIRON BAYONNAIS 02
              1ère Série  —  GROUPE A Poule phase 1 - F 1
  Club A                                               Club B
    Dupont Jean  (12345)                                 Martin Paul  (67890)
    Leroy Marie  (11111)                                 Durand Claire  (22222)
```

---

## Recommended workflow

Always run `/scrape_infos` before `/scrape_results` for a new competition season.
It seeds the `competitions`, `specialties`, `clubs`, `categories`, and `phases` tables
that `/scrape_results` depends on for its lookups.

```bash
# Step 1 — seed reference data (uses competition source_id for the form fetch)
curl "http://127.0.0.1:8787/scrape_infos?league=lcapb&competition=20260501"
curl "http://127.0.0.1:8787/scrape_infos?league=lidfpb&competition=20260501"

# Step 2 — look up the internal DB ids assigned to the seeded rows
npx wrangler d1 execute DB_LEAGUE_LCAPB --command \
  "SELECT id, source_id, name FROM competitions"
# e.g. id=2 → source_id=20260501 → "Championnat LCAPB 2026"

npx wrangler d1 execute DB_LEAGUE_LCAPB --command \
  "SELECT id, source_id, name FROM specialties"
# e.g. id=10 → source_id=2 → "Trinquet/P.G. Pleine Féminin"

npx wrangler d1 execute DB_LEAGUE_LCAPB --command \
  "SELECT id, source_id, name FROM categories"
# e.g. id=1 → source_id=1 → "1ère Série"

# Step 3 — scrape results using DB ids (dry-run first to verify)
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2&dry_run=true"

# Step 4 — save for real
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=2"
curl "http://127.0.0.1:8787/scrape_results?league=lidfpb&competition=1"
```

---

## Triggering the cron manually

In local development the daily cron (`0 3 * * *`) can be triggered without waiting using
the Wrangler test endpoint:

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=0+3+*+*+*"
```

This runs the same logic as the automatic nightly job: it scrapes all results for both
`lcapb` and `lidfpb` with no filters and saves new rows to D1.

---

## Parameter reference

### Filter values (`competition`, `specialty`, `category`, `phase`)

| Value | Endpoint        | Meaning                                      |
| ----- | --------------- | -------------------------------------------- |
| `0`   | `/scrape_results` | No filter — fetch all                      |
| `""`  | `/scrape_infos`   | No filter — fetch all form options         |
| `N`   | `/scrape_results` | Internal DB `id` — resolved to `source_id` |
| ID    | `/scrape_infos`   | `source_id` string used as form value      |

> **Note:** `/scrape_infos` still accepts `source_id` values directly (they are passed
> straight to the upstream form). `/scrape_results` accepts internal DB `id` values and
> resolves them to `source_id`s before hitting the upstream website.

### Output flags

| Parameter  | Default | Description                                                    |
| ---------- | ------- | -------------------------------------------------------------- |
| `dry_run`  | `false` | Fetch and display results but do not write to the database     |
| `no_color` | `false` | Strip ANSI escape codes from the response (use in browsers)    |
