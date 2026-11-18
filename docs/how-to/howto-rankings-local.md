# How to test the rankings locally

This guide runs the end-of-championship rankings through every layer on your machine:

1. the scheduler's `/scrape_rankings` reads a league site's `classements.php` and writes the local D1
   database,
2. the `rankings` subgraph reads that database,
3. the gateway federates it with the clubs, competitions, categories and specialties subgraphs.

Each step can be run on its own: stop after step 3 to test the scraper, after step 4 to test the
subgraph's SQL and resolvers. Only step 5 tests federation, since the club, competition, category and
specialty names come from the other subgraphs.

Run every command from the repository root unless a step says otherwise.

## Prerequisites

- `bun`, `curl` and `jq`.
- Network access to the league site: `/scrape_rankings` fetches live pages.
- A local database with the league's reference data. If `competitions` is empty, follow
  [Bootstrap the reference data](howto-league-bootstrap.md), or run `/scrape_infos` as shown in
  [step 2](#2-prepare-the-local-database).
- `subgraphs/rankings/.dev.vars` sets `INTERNAL_SERVICE_TOKEN` to the same value as the gateway and
  the other subgraphs. It is git-ignored: on a fresh clone, copy it from another subgraph:

  ```bash
  cp subgraphs/results/.dev.vars subgraphs/rankings/.dev.vars
  ```

---

## 1. Run the unit tests

```bash
bun install
bun test
bun run tsc --noEmit
```

The scraper tests (`workers/scheduler/src/rankings.test.ts`, `leagues/euskalpilota.test.ts`) and the
subgraph tests (`subgraphs/rankings/index.test.ts`) use made-up HTML and a fake D1: they need no
network and no database.

---

## 2. Prepare the local database

Apply the migrations, which create the `rankings` and `ranking_players` tables:

```bash
bun run migrate:local
```

Define two helpers for the rest of the guide. `d1` runs SQL on the local league database, `query`
sends a GraphQL query to a local worker:

```bash
LEAGUE=lcapb

d1() { # d1 "<sql>"
  (cd database && bunx wrangler d1 execute "pilotariak-${LEAGUE}" --local \
    --persist-to ../.wrangler/state --command "$1")
}

query() { # query <port> "<graphql>" ['<variables json>']
  local vars="${3:-}"
  [ -n "$vars" ] || vars='{}'
  curl -s "http://localhost:$1/graphql" \
    -H 'content-type: application/json' \
    -H "x-pilotariak-league: ${LEAGUE}" \
    -H "x-internal-token: ${TOKEN:-}" \
    -d "$(jq -n --arg q "$2" --argjson v "$vars" '{query: $q, variables: $v}')" | jq
}
```

Look up the database ids of the competition, specialty and category to test. The scheduler takes
database ids, not the site's source ids:

```bash
d1 "SELECT id, source_id, name FROM competitions ORDER BY source_id DESC LIMIT 6"
d1 "SELECT id, source_id, name FROM specialties ORDER BY name"
d1 "SELECT id, source_id, name FROM categories ORDER BY name"
```

Keep them in variables, for example the 1ère Série of Trinquet / P.G. Pleine Masculin in a finished
season:

```bash
COMPETITION=<competition id>   # e.g. "Championnat CCAPB 2025-2026"
SPECIALTY=<specialty id>       # e.g. "Trinquet / P.G. Pleine Masculin"
CATEGORY=<category id>         # e.g. "1ère Série"
```

If the competition you want is missing, or a ranking is later skipped with `not in database`, load
the competition's reference data first. `/scrape_infos` takes the competition's **source id**, and
needs the scheduler from step 3 running:

```bash
curl "http://localhost:8787/scrape_infos?league=${LEAGUE}&competition=<competition source id>&no_color=true"
```

---

## 3. Scrape rankings with the scheduler

Start the scheduler in its own terminal:

```bash
bun run scheduler:local          # http://localhost:8787
```

In another terminal (define the helpers and variables there too), preview one ranking without
writing anything:

```bash
curl "http://localhost:8787/scrape_rankings?league=${LEAGUE}&competition=${COMPETITION}&specialty=${SPECIALTY}&category=${CATEGORY}&dry_run=true&no_color=true"
```

Save every category of the specialty:

```bash
curl "http://localhost:8787/scrape_rankings?league=${LEAGUE}&competition=${COMPETITION}&specialty=${SPECIALTY}&category=0&no_color=true"
```

The output lists each ranking with its teams, or `no ranking` when the site publishes none for that
category. Running the same call again replaces the stored rankings, so the team count stays the same.

`format=json` returns the summary the nightly cron reads:

```bash
curl "http://localhost:8787/scrape_rankings?league=${LEAGUE}&competition=${COMPETITION}&specialty=${SPECIALTY}&category=0&format=json"
```

Check what was stored. `final` is 1 when the ranking has a champion, 0 while the championship runs:

```bash
d1 "SELECT competition_id, specialty_id, category_id, count(*) AS teams, SUM(phase = 'Champion') AS final
    FROM rankings GROUP BY competition_id, specialty_id, category_id"
```

To test the nightly refresh, scrape a season that is still running (its rankings have `final` 0),
then trigger the cron:

```bash
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

The scheduler terminal logs one `rankings of competition #…, specialty #…` line per ranking still in
progress. The cron also refreshes the results of every enabled competition, which fetches the league
site once per competition.

---

## 4. Query the rankings subgraph directly

Start the subgraph in its own terminal:

```bash
bun run graphql:rankings:local   # http://localhost:4007
```

A subgraph only answers requests that carry the internal token. Read it from `.dev.vars` into
`TOKEN`, which the `query` helper sends:

```bash
TOKEN=$(sed -nE 's/^INTERNAL_SERVICE_TOKEN *= *"?([^"]*)"?/\1/p' subgraphs/rankings/.dev.vars)
```

Read a whole ranking, ordered by rank:

```bash
query 4007 "{ rankings(competitionId: ${COMPETITION}, specialtyId: ${SPECIALTY}, categoryId: ${CATEGORY}) {
  rank phase final teamNumber players { licence name } } }"
```

Pick a player from the stored rankings:

```bash
d1 "SELECT p.licence, p.name FROM ranking_players p JOIN rankings r ON r.id = p.ranking_id
    WHERE r.competition_id = ${COMPETITION} AND r.category_id = ${CATEGORY} LIMIT 5"
PLAYER_LICENCE=<licence>
PLAYER_NAME="<first name> <last name>"
```

Find the player by licence, then by name. A name matches regardless of case, accents and word order:

```bash
query 4007 'query ($l: String) { playerRankings(licence: $l) {
  rank phase final teamNumber competition { id } category { id } players { name } } }' \
  "{\"l\": \"${PLAYER_LICENCE}\"}"

query 4007 'query ($n: String) { playerRankings(name: $n) { rank phase final } }' \
  "{\"n\": \"${PLAYER_NAME}\"}"
```

Both answers list the same rankings, most recent season first.

---

## 5. Query through the gateway

The gateway needs every subgraph the query touches: clubs, competitions, categories, specialties and
rankings. Start each one in its own terminal, **one after the other**: wait for `Ready on` before
starting the next. The workers share the SQLite files under `.wrangler/state`, and starting them all
at once can fail with `SQLITE_BUSY`.

```bash
bun run graphql:clubs:local          # :4003
bun run graphql:competitions:local   # :4002
bun run graphql:categories:local     # :4006
bun run graphql:specialties:local    # :4004
bun run graphql:rankings:local       # :4007
```

Then start the gateway with an empty Hive token:

```bash
cd gateway && bunx wrangler dev --port 4000 --var HIVE_CDN_TOKEN:
```

With the token from `gateway/.dev.vars`, the gateway loads the supergraph published on Hive, which
has no `rankings` until the schema is published there. With an empty token it uses
`gateway/supergraph.graphql`, composed from the local schemas. Run `bun run compose` after any
schema change.

Query a player's rankings with the names the other subgraphs resolve:

```bash
query 4000 'query ($n: String) { playerRankings(name: $n) {
  rank phase final teamNumber
  competition { name } specialty { name } category { name } club { name }
  players { licence name } } }' \
  "{\"n\": \"${PLAYER_NAME}\"}"
```

Each entry gives the season, the specialty, the category, the club and team, the final rank and the
phase the team reached. Compare it with the league site's ranking page: the rank, phase, club, team
and players must match.

---

## Troubleshooting

| Symptom                                                            | Cause and fix                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| A worker fails to start with `database is locked: SQLITE_BUSY`     | Workers started at the same time on `.wrangler/state`. Start them one after the other.                                                |
| A query fails now and then with `D1_ERROR … internal error`        | Several `wrangler dev` processes read the same SQLite files. It happens on every subgraph, not only `rankings`. Send the query again. |
| `Cannot query field "playerRankings"` through the gateway          | The gateway loaded the Hive supergraph. Start it with `--var HIVE_CDN_TOKEN:` and run `bun run compose`.                              |
| `Forbidden` from a subgraph                                        | Wrong or missing `x-internal-token`. Check `TOKEN` and `subgraphs/rankings/.dev.vars`.                                                |
| `… with id '…' not found in database. Run /scrape_infos first.`    | The id does not exist in the local database. Look it up again in step 2.                                                              |
| A ranking is skipped with `… not in database; run /scrape_infos …` | The competition offers a specialty or category the database lacks. Run `/scrape_infos` for the competition's source id.               |
| `… exceed the 35 pages one call may fetch; pass a specialty`       | Too many specialty × category pairs for one call, typically on CTPB. Pass a `specialty`.                                              |
| `Error: missing required parameters: …`                            | `/scrape_rankings` takes `league`, `competition`, `specialty` and `category`, like `/scrape_results`.                                 |

---

## Clean up

Delete the local rankings, keeping every other table:

```bash
d1 "DELETE FROM ranking_players; DELETE FROM rankings;"
```

To reset every scraped table of the local database, see
[Resetting scraped data](howto-database.md#resetting-scraped-data).
