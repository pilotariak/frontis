# How to bootstrap a league's reference data

This guide is step 2 of 3 to set up a league from scratch:

1. [Create the database](howto-league-create-database.md)
2. **Bootstrap the reference data** (this guide)
3. [Load all results](howto-league-load-results.md)

Bootstrapping fills the lookup tables that results point to: `leagues`, `competitions`,
`specialties` and `categories`. The setup-league worker reads them from the dropdowns of the league's
`resultats.php` form. Results can only be loaded for a competition that is in the `competitions`
table.

In the commands below, replace `<league>` with the lowercase league code, for example `ctpb`.

## Prerequisites

- The league database exists and every worker has its binding:
  [Create the database](howto-league-create-database.md).
- `curl` and `jq` are installed.
- For production, wrangler is logged in: `bunx wrangler whoami`. See
  [Log in to wrangler](howto-scheduler-scripts.md#log-in-to-wrangler).

---

## Start the setup-league worker

Pick the target database:

| Target      | Command                       | Writes to                          |
| ----------- | ----------------------------- | ---------------------------------- |
| Local state | `bun run setup-league:local`  | `.wrangler/state` (shared locally) |
| Production  | `bun run setup-league:remote` | Production D1                      |

Both commands serve the worker on `http://127.0.0.1:8788`. Keep it running in its own terminal and
set the base URL in the terminal you run the next steps from:

```bash
BASE=http://127.0.0.1:8788
```

`setup-league:remote` runs your local code against the production databases, so every write lands in
production. The deployed worker is protected by Cloudflare Access: to call it instead, see the
service token example in [Set up a league](howto-setup-league.md#examples).

---

## 1. Register the league

`/init` inserts the league row that `/bootstrap` reads. `url` is the league's results page, the same
URL as `baseUrl` in its scheduler scraper class.

```bash
curl -fsS "$BASE/init?acronym=<league>&name=<URL-encoded full name>&url=https://<league>.euskalpilota.fr/resultats.php"
# {"ok":true,"league":{"name":"...","acronym":"<league>","url":"..."}}
```

Example for LCAPB:

```bash
curl -fsS "$BASE/init?acronym=lcapb&name=Comit%C3%A9+Cote+d%27Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php"
```

`/init` is an upsert: running it again updates the name and URL. A `400` with `No database binding`
means the worker has no `DB_LEAGUE_<LEAGUE>` binding: go back to step 2 of the
[database guide](howto-league-create-database.md#2-bind-the-database-in-every-worker).

---

## 2. Preview the form values

`/bootstrap` defaults to a dry run in this worker, so this call writes nothing:

```bash
curl -fsS -H "X-Pilotariak-League: <league>" "$BASE/bootstrap?no_color=true"
```

The output lists every competition with its `source_id` in brackets, then the specialties and
categories. Check that the competitions look right before you save.

> **Dry-run defaults differ between workers.** setup-league's `/bootstrap` only writes with
> `dry_run=false`. The scheduler's `/scrape_infos` writes unless you pass `dry_run=true`.

---

## 3. Save the competitions

```bash
curl -fsS -H "X-Pilotariak-League: <league>" "$BASE/bootstrap?dry_run=false&no_color=true"
```

This saves every competition the site lists, current and past seasons. Every competition starts
with `enabled = 0`.

---

## 4. Save the specialties and categories of each competition

Without a competition, the site returns a reduced list of specialties and categories. Run
`/bootstrap` once per competition to get the full lists:

```bash
cd database

bunx wrangler d1 execute pilotariak-<league> --remote --json \
  --command "SELECT source_id FROM competitions ORDER BY source_id" \
  | jq -r '.[0].results[].source_id' \
  | while read -r c; do
      curl -fsS -H "X-Pilotariak-League: <league>" \
        "$BASE/bootstrap?competition_source_id=$c&dry_run=false&no_color=true" > /dev/null \
        && echo "ok      $c" || echo "FAILED  $c"
      sleep 0.3 # be gentle on the upstream site
    done
```

The loop reads one id per line, so it works in bash and zsh alike.

Against local state, replace `--remote` with `--local --persist-to ../.wrangler/state`.

Do not skip this step for past seasons. When results are saved, missing clubs and categories are
created on the fly, but missing specialties are not: when you load all specialties of a competition
at once, a result whose specialty name is not in the `specialties` table is skipped.

---

## 5. Optional: save the clubs and phases

`/bootstrap` does not save clubs or phases. Loading results creates the clubs that play, and the
results keep their phase as text, so you only need this step to list clubs that have no result yet
or to filter results by phase. The scheduler's `/scrape_infos` saves them; start it with
`bun run scheduler:local` or `bun run scheduler:remote`, then:

```bash
curl -fsS "http://127.0.0.1:8787/scrape_infos?league=<league>&competition=<competition source_id>"
```

This call writes by default.

---

## Verify

```bash
cd database
bun run db:<league>:remote "SELECT 'leagues' AS t, count(*) AS n FROM leagues
  UNION ALL SELECT 'competitions', count(*) FROM competitions
  UNION ALL SELECT 'specialties',  count(*) FROM specialties
  UNION ALL SELECT 'categories',   count(*) FROM categories"
```

Use `db:<league>:local` instead for local state. Each table must have at least one row, and
`leagues` exactly one. Running this against `--remote` also confirms that a `setup-league:remote`
session wrote to production.

Next: [Load all results](howto-league-load-results.md).
