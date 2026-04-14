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

Use the bracketed values (e.g. `[20260501]`, `[2]`, `[1]`) as filter parameters for
`/scrape_results`.

---

### `GET /scrape_results` — scrape and save match results

Fetches match results from the league website and saves them to the D1 database.
Categories are upserted automatically — if a category name scraped from the HTML is not
yet in the `categories` table it is created on the fly.

**Required parameters**

| Parameter     | Description                                           |
| ------------- | ----------------------------------------------------- |
| `league`      | `lcapb` or `lidfpb`                                   |
| `competition` | Competition `source_id` (from `/scrape_infos`)        |

**Optional parameters**

| Parameter   | Default | Description                                                   |
| ----------- | ------- | ------------------------------------------------------------- |
| `specialty` | `0`     | Specialty `source_id`; `0` means all specialties              |
| `category`  | `0`     | Category `source_id`; `0` means all categories                |
| `phase`     | `0`     | Phase `source_id`; `0` means all phases                       |
| `dry_run`   | `false` | If `true`, scrape and display results but do not save         |

**Examples**

```bash
# All results for a competition
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=20260501"

# Filter by specialty and category
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=20260501&specialty=2&category=1&phase=0"

# Dry-run: preview what would be saved without writing to the database
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=20260501&specialty=2&category=1&dry_run=true"

# LIDFPB league, all results
curl "http://127.0.0.1:8787/scrape_results?league=lidfpb&competition=20260501"
```

**Sample output**

```
League      : LCAPB
Competition : 20260501
Filters     : specialty=2  category=1  phase=0
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
# Step 1 — seed reference data
curl "http://127.0.0.1:8787/scrape_infos?league=lcapb&competition=20260501"
curl "http://127.0.0.1:8787/scrape_infos?league=lidfpb&competition=20260501"

# Step 2 — scrape results (dry-run first to verify)
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=20260501&dry_run=true"

# Step 3 — save for real
curl "http://127.0.0.1:8787/scrape_results?league=lcapb&competition=20260501"
curl "http://127.0.0.1:8787/scrape_results?league=lidfpb&competition=20260501"
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

| Value  | Meaning                  |
| ------ | ------------------------ |
| `0`    | No filter — fetch all    |
| `""`   | No filter — fetch all    |
| ID     | Filter to that source ID |

Source IDs are opaque strings from the upstream website (e.g. `20260501` for a competition,
`2` for a specialty). Retrieve them from `/scrape_infos`.
