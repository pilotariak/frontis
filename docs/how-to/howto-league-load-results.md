# How to load all results for a league

This guide is step 3 of 3 to set up a league from scratch:

1. [Create the database](howto-league-create-database.md)
2. [Bootstrap the reference data](howto-league-bootstrap.md)
3. **Load all results** (this guide)

The scheduler worker scrapes the results of a competition from the league's site and saves them.
The upstream site filters results by competition only, so the cheapest way to load a league is one
request per competition, the same way the nightly cron does it.

In the commands below, replace `<league>` with the lowercase league code, for example `ctpb`.

## Prerequisites

- The league is bootstrapped, including the specialties of every competition you load:
  [Bootstrap the reference data](howto-league-bootstrap.md).
- The league has a scraper registered in the scheduler:
  [Register the league scraper](howto-league-create-database.md#4-register-the-league-scraper-in-the-scheduler).
- `curl` and `jq` are installed.
- For production, wrangler is logged in: `bunx wrangler whoami`. See
  [Log in to wrangler](howto-scheduler-scripts.md#log-in-to-wrangler).

---

## Start the scheduler worker

| Target      | Command                    | Writes to                          |
| ----------- | -------------------------- | ---------------------------------- |
| Local state | `bun run scheduler:local`  | `.wrangler/state` (shared locally) |
| Production  | `bun run scheduler:remote` | Production D1                      |

Both commands serve the worker on `http://127.0.0.1:8787` (see the
[Port reference](../reference/ports.md)). Keep it running in its own terminal and
set the base URL in the terminal you run the next steps from:

```bash
BASE=http://127.0.0.1:8787
```

Do not point `BASE` at `https://frontis-scheduler.pilotariak.com` with the commands below. Cloudflare
Access protects it, so a plain `curl` gets a redirect to the login page instead of results, and
`curl -fsS` still exits with status 0. To load results through the deployed worker, use the
scheduler scripts with an Access token: see
[Use the scheduler scripts](howto-scheduler-scripts.md#deployed-worker).

---

## 1. List the competitions

```bash
cd database
bun run db:<league>:remote "SELECT id, source_id, name, enabled FROM competitions ORDER BY source_id DESC"
```

Use `db:<league>:local` for local state. `/scrape_results` takes the `id` column, not the
`source_id`.

---

## 2. Try one competition

```bash
curl -sS "$BASE/scrape_results?league=<league>&competition=<id>&specialty=0&category=0&phase=0&dry_run=true&format=json"
# {"league":"<league>","competition":"<id>","found":<n>,"saved":0,"dry_run":true}
```

`specialty` and `category` are required: `0` means all of them. Without them the worker answers
`400 missing required parameters`.

`found` is the number of results the site returned for the competition. Drop `format=json` to see
them.

---

## 3. Load every competition

```bash
cd database

bunx wrangler d1 execute pilotariak-<league> --remote --json \
  --command "SELECT id FROM competitions ORDER BY id" \
  | jq -r '.[0].results[].id' \
  | while read -r id; do
      printf 'competition=%s ' "$id"
      curl -sS "$BASE/scrape_results?league=<league>&competition=$id&specialty=0&category=0&phase=0&format=json"
      echo
      sleep 0.3 # be gentle on the upstream site
    done
```

The loop reads one id per line, so it works in bash and zsh alike.

Against local state, replace `--remote` with `--local --persist-to ../.wrangler/state`.

Each line prints `found` and `saved` for one competition. Saving is idempotent: a result that is
already stored is not inserted again, so running the loop again saves `0` and is safe after a
failure. Only its pool is refreshed, and a result whose pool changed counts as saved.

Saving results for a competition sets its `enabled` flag, and the flags of the specialties and
categories that received results.

---

## 4. Check for skipped results

On the first load, `saved` should equal `found` for each competition. A lower `saved` has two
causes:

- **Duplicate rows on the site.** Harmless: they are stored once.
- **Unknown specialty.** When all specialties are loaded at once, each result is matched to the
  `specialties` table by its exact name. A result whose specialty is missing is skipped, and the
  worker logs a `[saveResults] Skipping result: missing lookup` line in the terminal where it runs.

To recover skipped results for a competition:

1. Run `/bootstrap` for that competition, as in step 4 of the
   [bootstrap guide](howto-league-bootstrap.md#4-save-the-specialties-and-categories-of-each-competition),
   then run its `/scrape_results` call again.
2. If results are still skipped, load the competition one specialty and category at a time with
   `scrape-competition.sh <league> --all`. With a specialty set, names are matched without accents
   or punctuation. See
   [Load every specialty and category of a competition](howto-scheduler-scripts.md#load-every-specialty-and-category-of-a-competition).

---

## 5. Enrol the league in the nightly refresh

The nightly cron (`0 3 * * *`) scrapes every enabled competition of the leagues listed in
`CRON_LEAGUES`. Each competition costs one subrequest, and the Workers Free plan allows 50 per
invocation. After a full load every past season is enabled, and past seasons do not change.

1. Keep only the current seasons enabled:

   ```bash
   cd database
   bun run db:<league>:remote "UPDATE competitions SET enabled = 0 WHERE id NOT IN (<current season ids>)"
   ```

   `enabled` is also the filter of the `competitions(enabled: true)` GraphQL query, so clients that
   use it stop listing the seasons you disable. Their results stay in the database and are still
   returned by `competitions` without the argument.

2. Add the league to `CRON_LEAGUES` in `workers/scheduler/src/index.ts`, set its **Nightly refresh**
   to `yes` in [Supported leagues](../reference/leagues.md), run `bun test`, then deploy the
   scheduler:

   ```bash
   bun run scheduler:deploy
   ```

Skip this step to keep the league out of the nightly refresh, as CTPB is today. Its results then
change only when you run step 3 again.

---

## Verify

Count the results of each competition:

```bash
cd database
bun run db:<league>:remote "SELECT c.id, c.name, c.enabled, count(r.id) AS results
  FROM competitions c LEFT JOIN results r ON r.competition_id = c.id
  GROUP BY c.id ORDER BY c.source_id DESC"
```

Running this against `--remote` also confirms that a `scheduler:remote` session wrote to production.

Query the league through the gateway:

```bash
curl -s https://frontis-gateway.pilotariak.com/graphql \
  -H "Content-Type: application/json" \
  -H "X-Pilotariak-League: <league>" \
  -d '{"query":"{ competitions(enabled: true) { id name } }"}'
```

For the endpoints and their parameters, see [Use the scheduler](howto-scheduler.md).
