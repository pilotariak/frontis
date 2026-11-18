# Supported leagues

This page is the single source of truth for the leagues Frontis supports. Other pages link here instead of
repeating the list.

A league is supported when it has a D1 database bound in every worker and a scraper registered in the
scheduler. Every league publishes its results with the same euskalpilota.fr `resultats.php`
application.

## Leagues

| Code     | Name                                            | Results site                                   | Nightly refresh |
| -------- | ----------------------------------------------- | ---------------------------------------------- | --------------- |
| `lcapb`  | Comité de Côte d'Argent de Pelote Basque        | <https://lcapb.euskalpilota.fr/resultats.php>  | yes             |
| `lidfpb` | Ligue d'Ile de France                           | <https://lidfpb.euskalpilota.fr/resultats.php> | yes             |
| `ctpb`   | Comité Territorial Pays Basque de Pelote Basque | <https://ctpb.euskalpilota.fr/resultats.php>   | no              |
| `llpb`   | Comité des Landes de Pelote Basque              | <https://llpb.euskalpilota.fr/resultats.php>   | no              |

- **Code**: the lowercase code every API and worker takes.
- **Name**: the `<title>` of the league's results site.
- **Nightly refresh**: whether the code is in `CRON_LEAGUES` (`workers/scheduler/src/index.ts`), so
  the 03:00 UTC cron refreshes its results and rankings. A league joins it once its results are
  loaded: see
  [Enrol the league in the nightly refresh](../how-to/howto-league-load-results.md#5-enrol-the-league-in-the-nightly-refresh).

## D1 databases

| Code     | Binding            | Database name       | Database ID                            |
| -------- | ------------------ | ------------------- | -------------------------------------- |
| `lcapb`  | `DB_LEAGUE_LCAPB`  | `pilotariak-lcapb`  | `bbf41c91-1bfd-4c31-bbc1-a83b588dacc4` |
| `lidfpb` | `DB_LEAGUE_LIDFPB` | `pilotariak-lidfpb` | `e5ebfb2b-6736-4662-8fd2-e078df3d9bee` |
| `ctpb`   | `DB_LEAGUE_CTPB`   | `pilotariak-ctpb`   | `11d235a6-faf2-4dde-81bd-2781f7e1e15e` |
| `llpb`   | `DB_LEAGUE_LLPB`   | `pilotariak-llpb`   | `6f3f9566-33a9-4f20-bf54-1cc4e2f76e43` |

Each binding is declared in the `wrangler.toml` of `database/`, of each D1-backed subgraph
(`categories`, `clubs`, `competitions`, `rankings`, `results`, `specialties`), of `workers/scheduler`
and of `workers/setup-league`. Workers pick the binding at request time with
`DB_LEAGUE_${code.toUpperCase()}`. All databases share the schema in `database/migrations`.

## Scrapers

| Code     | Class           | File                                      | Session priming |
| -------- | --------------- | ----------------------------------------- | --------------- |
| `lcapb`  | `LcapbScraper`  | `workers/scheduler/src/leagues/lcapb.ts`  | no              |
| `lidfpb` | `LidfpbScraper` | `workers/scheduler/src/leagues/lidfpb.ts` | no              |
| `ctpb`   | `CtpbScraper`   | `workers/scheduler/src/leagues/ctpb.ts`   | yes             |
| `llpb`   | `LlpbScraper`   | `workers/scheduler/src/leagues/llpb.ts`   | no              |

Every class extends `EuskalpilotaScraper` (`leagues/euskalpilota.ts`) and is registered in the
`scrapers` map of `workers/scheduler/src/scraper.ts`. The CTPB site redirects to `redirection.php`
when a request carries no `PHPSESSID` cookie, so `CtpbScraper` fetches a session cookie before each
request. The other sites answer without one.

## Where the code goes

| Component                           | Parameter                                                | Unknown code                                         |
| ----------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| GraphQL API (gateway, subgraphs)    | `X-Pilotariak-League` header, any case                   | `BAD_USER_INPUT`: `Unknown league: <code>`           |
| Scheduler (`/scrape_*`, `/admin/*`) | `league` query parameter                                 | `Unsupported league: <code>`                         |
| setup-league `/init`                | `acronym` query parameter                                | HTTP 400: `No database binding for league '<code>'.` |
| setup-league `/bootstrap`           | `X-Pilotariak-League` header or `league` query parameter | HTTP 400: `No database binding for league '<code>'.` |

## `ccapb` is not accepted by Frontis

LCAPB names its competitions after its committee, for example `Championnat CCAPB 2025-2026`. These
competitions belong to `lcapb`. Frontis has no `ccapb` database: the API answers
`Unknown league: ccapb` and the scheduler `Unsupported league: ccapb`.

## Outside this repository

Azkena (the `league` enum of its tools) and Xilo (league detection in Slack messages) keep their own
list of league codes. A league added here is not available there until those repos add it.

## Add a league

Follow the three guides in order, then add a row to each table on this page:

1. [Create the database](../how-to/howto-league-create-database.md)
2. [Bootstrap the reference data](../how-to/howto-league-bootstrap.md)
3. [Load all results](../how-to/howto-league-load-results.md)
