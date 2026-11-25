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
database ids or build URLs by hand. It also bootstraps a league: see
[Bootstrap a league](#bootstrap-a-league). Open `/admin` on the scheduler:

- Production: `https://frontis-scheduler.pilotariak.com/admin`. Cloudflare Access protects the
  scheduler, so the browser asks for your GitHub login first.
- Locally: `http://127.0.0.1:8787/admin`, with the local D1 databases.

The page has two modes:

- **One combination** runs one request for the specialty and category you pick.
- **Every combination** works like `scrape-competition.sh --all`. It walks each specialty and
  category the competition offers, shows a preview of each, and asks whether to save it.

### One combination

1. Choose **Match results** or **Rankings**. The league site has one page for each, and they can
   offer different specialties.
2. Choose the league, then the competition. Competitions the nightly cron refreshes come first,
   under **Refreshed nightly**. The others follow, newest season first.
3. Choose the specialty and the category. The menus list only what the league site offers for this
   competition, read live from its form. **All specialties** and **All categories** send `0`.
   A choice shown greyed out is offered by the site but missing from the database:
   [bootstrap the league](#bootstrap-a-league) with this competition as its scope.
4. Leave **Dry run** checked and click **Preview**. The output panel shows the request it sent and
   the scheduler's plain-text answer.
5. Click **Save these results** (or **Save these rankings**) to run the same request again without
   dry run. To save in one step, uncheck **Dry run** and click **Run and save**.

### Every combination

1. Choose **Match results** or **Rankings**, then **Every combination**.
2. Choose the league, then the competition. The hint under the menus counts the combinations to
   walk: every specialty the league site offers for this competition, times every category.
   Choices missing from the database are left out.
3. Leave **Ask before each save** checked and click **Review N combinations**. The page previews
   each combination in turn with a dry run and skips the empty ones. For each other one, choose:

   | Button                 | Key | Effect                                            |
   | ---------------------- | --- | ------------------------------------------------- |
   | **Save**               | `y` | Run the request again without dry run, then go on |
   | **Skip**               | `n` | Save nothing for this combination, then go on     |
   | **Save all remaining** | `a` | Save this one and every later one without asking  |
   | **Stop**               | `q` | End the walk; what is already saved stays saved   |

4. When the walk ends, the output panel lists each combination saved, skipped or failed, with the
   counts. A failed combination does not stop the walk: you can skip it and go on.

To save every combination without previews, uncheck **Ask before each save** and click
**Save N combinations**: each one is scraped and saved in one request. The page waits 300 ms
between combinations, as the script does, to spare the league site.

Match results already in D1 are not inserted twice, so saving them again reports `0 saved`. A
stored result is updated in place when the site gives it a new score, lineup, pool or pool phase,
and then counts as saved: a match saved before it was played gets its score the next time its
combination is saved, and the first save after migration `0014` counts every stored result it
gives a pool. A score or player the site no longer gives is kept as stored and does not count as
saved.

### Bootstrap a league

The **Bootstrap a league** card, under the main form, does from the page what setup-league's
`/init` and `/bootstrap` do. It registers the league in `leagues`, then runs `/scrape_infos`, which
saves the competitions, specialties, categories, clubs and phases the league site offers. The page
opens the card when the league you choose has no competition in D1.

The card lists only the leagues the scheduler already supports: a scraper class and a
`DB_LEAGUE_<LEAGUE>` binding. A new league needs that code first: see
[Create the database](howto-league-create-database.md).

1. Choose the league. The card shows whether it is registered and how many competitions D1 holds.
2. Give its full name, prefilled when the league is registered. **Site URL** shows the URL saved
   with it, read-only: the scraper's `baseUrl`, the page the scheduler reads. To change it, change
   the scraper class. **Init (register only)** writes the league row now and scrapes nothing,
   like setup-league's `/init`. The save in step 4 writes it too, so Init is optional.
3. Choose the scope:

   | Scope                                         | Request                                           |
   | --------------------------------------------- | ------------------------------------------------- |
   | **Site default competition**                  | `/scrape_infos` with no competition               |
   | A competition                                 | `/scrape_infos` with the competition source_id    |
   | **Every competition in D1, one request each** | One `/scrape_infos` per competition, 300 ms apart |

4. Leave **Dry run** checked and click **Preview**, then **Bootstrap and save**. A save first writes
   the league row (`POST /admin/league`), then runs `/scrape_infos` without dry run. **Every
   competition** always saves, shows its progress, and stops with **Stop** or `q`.

For a new league, save the site default competition first: it lists every competition of the site.
Then save every competition once: the site offers all the specialties and categories of a
competition only when the request names it, and loading results skips a result whose specialty is
not in D1. The walk goes from the oldest competition to the newest: the last save of a
category or a phase sets its name, so the current season's labels win.

### Limits and errors

A rankings request for every specialty and every category can exceed the 35 pages one call may
fetch. The scheduler then answers HTTP 400: pick a specialty.

If a menu or a run reports that the scheduler did not answer, your Cloudflare Access session has
probably expired: reload the page.

### JSON routes

The page reads these JSON routes, which you can also call yourself:

| Route                                                          | Returns                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /admin/competitions?league=lcapb`                         | `{ competitions: [{ id, source_id, name, enabled }] }`, competitions with a `source_id`, newest first |
| `GET /admin/options?league=lcapb&competition=2&script=results` | `{ specialties: [{ id, name }], categories: [{ id, name }] }`, `id` null when not in D1               |
| `GET /admin/league?league=lcapb`                               | `{ acronym, url, name }`, `name` null when the league is not registered                               |
| `POST /admin/league?league=lcapb` with `{"name": "..."}`       | The same, after an upsert of the league row with the scraper's URL                                    |

`script` is `results` or `rankings`. A wrong parameter, or a competition the league site does not
list, is an HTTP 400 with `{ error }`. `POST /admin/league` takes a JSON body: a missing or empty
`name` is an HTTP 400.

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

The worker reads the results form alone: a GET of `resultats.php?InCompet=<source_id>`, about
25 KB, never the results page. On CTPB it first opens a session (`PHPSESSID`). The competitions
list every competition of the site; the specialties, categories and phases are the ones the
competition offers.

The route takes no `specialty`, `category` or `phase`: they filter results, not the dropdowns, and
it ignores them. A page without a competition list (session not opened, error page, changed markup)
answers HTTP 500 and saves nothing, as does a league site that does not answer.

**Required parameters**

| Parameter | Description                         |
| --------- | ----------------------------------- |
| `league`  | `lcapb`, `lidfpb`, `ctpb` or `llpb` |

**Optional parameters**

| Parameter     | Default | Description                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------------- |
| `competition` | `""`    | Competition `source_id` whose dropdowns to read; empty for the site default one |
| `dry_run`     | `false` | If `true`, fetch and display the dropdowns but do not save                      |

**Examples**

```bash
# List the form options of the site's default competition for LCAPB
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
  walked on raw DOM nodes, and nothing is logged per row. A full-season page (~500 KB, ~600
  results) parses in roughly 10 ms on a laptop versus ~80 ms before.
- **The form is read alone.** `/scrape_infos`, and the checks of `/scrape_results` and of the
  admin page, read the dropdowns from a GET with `InCompet` only, about 25 KB. A GET with every
  form field returns the full results page instead, several MB on CTPB: parsing it is what pushed
  `/scrape_infos` far over the limit.
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

| Value | Endpoint          | Meaning                                                  |
| ----- | ----------------- | -------------------------------------------------------- |
| `0`   | `/scrape_results` | No filter — fetch all                                    |
| `""`  | `/scrape_infos`   | `competition` only: the site's default competition       |
| `N`   | `/scrape_results` | Internal DB `id` — resolved to `source_id`               |
| ID    | `/scrape_infos`   | `competition` only: `source_id` sent as `InCompet` alone |

> **Note:** `/scrape_infos` takes a competition `source_id`, sent as is to the upstream form,
> and no specialty, category or phase. `/scrape_results` accepts internal DB `id` values and
> resolves them to `source_id`s before hitting the upstream website.

### Output flags

| Parameter  | Default | Description                                                 |
| ---------- | ------- | ----------------------------------------------------------- |
| `dry_run`  | `false` | Fetch and display results but do not write to the database  |
| `no_color` | `false` | Strip ANSI escape codes from the response (use in browsers) |

The text answers of `/scrape_results` and `/scrape_rankings` carry two headers: `X-Scrape-Found`,
the rows read from the league site, and `X-Scrape-Saved`, the rows written (`0` on a dry run). The
admin page reads them to skip empty combinations.
