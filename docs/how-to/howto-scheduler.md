# How to use the Frontis Scheduler

The scheduler is a Cloudflare Worker that scrapes match results from the league websites (see
[Supported leagues](../reference/leagues.md)) and writes them into the D1 databases.

It exposes two HTTP endpoints for on-demand scraping and runs automatically on a daily cron
(`0 3 * * *` — every day at 03:00 UTC).

---

## Running locally

```bash
cd workers/scheduler
bun run dev
```

The worker starts on **`http://127.0.0.1:8787`** (see the [Port reference](../reference/ports.md)).

The `--test-scheduled` flag (already in the `dev` script) enables the cron trigger endpoint
so you can fire it manually without waiting for 03:00 UTC.

---

## Use the admin page

The admin page runs `/scrape_results` and `/scrape_rankings` from menus, so you do not look up
database ids or build URLs by hand. Open `/admin` on the scheduler:

- Production: `https://frontis-scheduler.pilotariak.com/admin`. Cloudflare Access protects the
  scheduler, so the browser asks for your GitHub login first.
- Locally: `http://127.0.0.1:8787/admin`, with the local D1 databases.

1. Choose **Match results** or **Rankings**. The league site has one page for each, and they can
   offer different specialties.
2. Choose the league, then the competition. Competitions the nightly cron refreshes come first,
   under **Refreshed nightly**. The others follow, newest season first.
3. Choose the specialty and the category. The menus list only what the league site offers for this
   competition, read live from its form. **All specialties** and **All categories** send `0`.
   A choice shown greyed out is offered by the site but missing from the database: run
   [`/scrape_infos`](#get-scrape_infos--discover-source-ids) for the league first.
4. Leave **Dry run** checked and click **Preview**. The output panel shows the request it sent and
   the scheduler's plain-text answer.
5. Click **Save these results** (or **Save these rankings**) to run the same request again without
   dry run. To save in one step, uncheck **Dry run** and click **Run and save**.

A rankings request for every specialty and every category can exceed the 35 pages one call may
fetch. The scheduler then answers HTTP 400: pick a specialty.

If a menu or a run reports that the scheduler did not answer, your Cloudflare Access session has
probably expired: reload the page.

The page reads two JSON routes, which you can also call yourself:

| Route                                                          | Returns                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /admin/competitions?league=lcapb`                         | `{ competitions: [{ id, name, enabled }] }`, competitions with a `source_id`, newest first |
| `GET /admin/options?league=lcapb&competition=2&script=results` | `{ specialties: [{ id, name }], categories: [{ id, name }] }`, `id` null when not in D1    |

`script` is `results` or `rankings`. A wrong parameter, or a competition the league site does not
list, is an HTTP 400 with `{ error }`.

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

| Parameter | Description                         |
| --------- | ----------------------------------- |
| `league`  | `lcapb`, `lidfpb`, `ctpb` or `llpb` |

**Optional parameters**

| Parameter     | Default | Description                                            |
| ------------- | ------- | ------------------------------------------------------ |
| `competition` | `""`    | Filter dropdowns to a specific competition `source_id` |
| `dry_run`     | `false` | If `true`, fetch and display results but do not save   |

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

Saving results also sets the competition's `enabled` flag to `true`. The flag is opt-in
(it defaults to `false` when `/scrape_infos` or `setup-league` creates the competition),
so a competition becomes visible as enabled as soon as it has at least one result saved.
A `dry_run=true` call never touches the flag.

Filter parameters (`competition`, `specialty`, `category`, `phase`) are **internal
database IDs** (the `id` primary key column), not `source_id` values.
The worker resolves them to `source_id`s internally before hitting the upstream website.
Use `/scrape_infos` first to seed the database, then query it to obtain the IDs.

Before fetching the results, the worker reads the competition's form (a small GET of
`resultats.php?InCompet=<source_id>`) and checks the parameters. The call fails with **HTTP 400**,
and saves nothing, when:

- an id is not a number, or is not in the database (run `/scrape_infos` first);
- the competition is not on the league site: the site would answer with its default competition,
  whose results would be saved under this one;
- the competition does not offer the requested specialty, category or phase: the error lists the
  ids it offers.

Other errors (league site unreachable or without its results form, database unreachable) answer
HTTP 500.

**Required parameters**

| Parameter     | Description                         |
| ------------- | ----------------------------------- |
| `league`      | `lcapb`, `lidfpb`, `ctpb` or `llpb` |
| `competition` | Competition DB `id`                 |

**Optional parameters**

| Parameter   | Default | Description                                              |
| ----------- | ------- | -------------------------------------------------------- |
| `specialty` | `0`     | Specialty DB `id`; `0` means all specialties             |
| `category`  | `0`     | Category DB `id`; `0` means all categories               |
| `phase`     | `0`     | Phase DB `id`; `0` means all phases                      |
| `dry_run`   | `false` | If `true`, scrape and display results but do not save    |
| `no_color`  | `false` | If `true`, strip ANSI escape codes — useful for browsers |

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

### `GET /scrape_rankings` — scrape and save end-of-championship rankings

Fetches the end-of-championship rankings ("Classement à la fin du championnat") from the league
website's `classements.php` and saves them to the `rankings` and `ranking_players` tables, read by
the `rankings` subgraph.

It takes the same parameters as `/scrape_results`, as **internal database IDs**, with `0` for every
specialty or category the competition offers. `phase` does not apply: the ranking covers the whole
championship.

The site has no "every category" ranking, so the worker fetches the competition's form once, then
one page per specialty × category pair. One call fetches at most 35 pages: on CTPB (about 20
specialties and 10 categories per competition) pass a `specialty`.

A ranking changes while its championship runs, so each fetched ranking **replaces** the stored one
for that competition, specialty and category. A page that lists no team leaves the stored ranking
untouched. Clubs missing from the database are inserted.

The parameters are checked before any ranking is fetched. The call fails with **HTTP 400**, and
saves nothing, when:

- an id is not a number, or is not in the database (run `/scrape_infos` first);
- the competition is not on the league site's rankings page: the site would answer with its
  default competition instead, whose rankings must not be saved under this one;
- the competition does not offer the requested specialty or category: the error lists the ids it
  offers;
- the call would fetch more than 35 pages.

With `specialty=0` or `category=0`, an offered specialty or category missing from the database is
reported in the output and skipped: run `/scrape_infos` for the competition first. Other errors
(league site unreachable or without its rankings form, database unreachable) answer HTTP 500.

**Parameters**

| Parameter     | Required | Description                                                            |
| ------------- | -------- | ---------------------------------------------------------------------- |
| `league`      | yes      | `lcapb`, `lidfpb`, `ctpb` or `llpb`                                    |
| `competition` | yes      | Competition DB `id`                                                    |
| `specialty`   | yes      | Specialty DB `id`; `0` means every specialty of the competition        |
| `category`    | yes      | Category DB `id`; `0` means every category of the competition          |
| `dry_run`     | no       | If `true`, scrape and display the rankings but do not save             |
| `format`      | no       | `json` returns `{ league, competition, pages, found, saved, dry_run }` |
| `no_color`    | no       | If `true`, strip ANSI escape codes                                     |

**Examples**

```bash
# Every category of one specialty
curl "http://127.0.0.1:8787/scrape_rankings?league=lcapb&competition=444&specialty=98&category=0"

# One ranking, preview only
curl "http://127.0.0.1:8787/scrape_rankings?league=lcapb&competition=444&specialty=98&category=881&dry_run=true"
```

**Sample output**

```
League      : LCAPB
Competition : 444 [Championnat CCAPB 2025-2026]
Filters     : specialty=98  category=881
Status      : 12 teams saved

  Trinquet / P.G. Pleine Masculin — 1ère Série  (12 teams)
      1  Champion       CA BEGLAIS 1
                         DUPONT Jean  (012345)
                         MARTIN Paul  (067890)
      2  Finale         CA BEGLAIS 2
  …
```

---

## Recommended workflow

To pick ids from menus and preview results before saving them, use the scripts in
`workers/scheduler/scripts/`: see [Use the scheduler scripts](howto-scheduler-scripts.md).

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

This runs the same logic as the automatic nightly job. For each of `lcapb` and `lidfpb` it
lists the competitions with `enabled = 1`, then calls its own
`/scrape_results?...&specialty=0&category=0&phase=0&format=json` endpoint once per
competition through the `SELF` service binding (see `wrangler.toml`).

A competition becomes enabled the first time results are saved for it, so to enrol one in
the nightly refresh run `/scrape_results` for it once by hand (without `dry_run`). Competitions
that were only discovered by `/scrape_infos` stay disabled and are never scraped by the cron.

The same run then refreshes the rankings still in progress: every competition and specialty
holding a ranking with no `Champion` row is scraped again through
`/scrape_rankings?...&category=0&format=json`, one self-call each. Final rankings are never fetched
again. A season enters this refresh the first time its rankings are saved, so run
`/scrape_rankings` once by hand for a new season.

### CPU time budget

On the Workers Free plan every invocation — HTTP request or cron trigger — gets **10 ms of
CPU time** (the Paid plan allows 30 s, 15 min for a daily cron). Hitting it surfaces as
`Worker exceeded CPU time limit.` in the invocation logs. Two things keep the scheduler
under that budget:

- **Parsing is cheap.** Pages are parsed with `cheerio/slim` (htmlparser2), result rows are
  walked on raw DOM nodes, the form dropdowns are only parsed by `/scrape_infos`, and nothing
  is logged per row. A full-season page (~500 KB, ~600 results) parses in roughly 10 ms on a
  laptop versus ~80 ms before.
- **One invocation per competition.** The cron does not scrape in-process: each self-call
  through the service binding is a separate invocation with its own CPU budget, so the cost of
  one competition is never added to the others', and one competition exceeding the limit does
  not abort the rest of the run.

`format=json` makes `/scrape_results` return only `{ league, competition, found, saved, dry_run }` so the callee spends no CPU rendering rows.

When running `bun run dev` the `SELF` binding points at the same dev session, so
`/__scheduled` exercises the real fan-out locally.

---

## Parameter reference

### Filter values (`competition`, `specialty`, `category`, `phase`)

| Value | Endpoint          | Meaning                                    |
| ----- | ----------------- | ------------------------------------------ |
| `0`   | `/scrape_results` | No filter — fetch all                      |
| `""`  | `/scrape_infos`   | No filter — fetch all form options         |
| `N`   | `/scrape_results` | Internal DB `id` — resolved to `source_id` |
| ID    | `/scrape_infos`   | `source_id` string used as form value      |

> **Note:** `/scrape_infos` still accepts `source_id` values directly (they are passed
> straight to the upstream form). `/scrape_results` accepts internal DB `id` values and
> resolves them to `source_id`s before hitting the upstream website.

### Output flags

| Parameter  | Default | Description                                                 |
| ---------- | ------- | ----------------------------------------------------------- |
| `dry_run`  | `false` | Fetch and display results but do not write to the database  |
| `no_color` | `false` | Strip ANSI escape codes from the response (use in browsers) |
