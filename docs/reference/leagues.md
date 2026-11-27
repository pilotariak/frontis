# Supported leagues

This page is the single source of truth for the leagues Frontis supports. Other pages link here instead of
repeating the list.

A league is supported when it has a D1 database bound in every worker and a scraper registered in the
scheduler. The regional leagues publish their results with the same euskalpilota.fr `resultats.php`
application. The federation, `ffpb`, publishes its national competitions with a PC SOFT WebDev application,
which has a scraper of its own: see [FFPB](#ffpb).

## Leagues

| Code     | Name                                            | Results site                                     | Nightly refresh |
| -------- | ----------------------------------------------- | ------------------------------------------------ | --------------- |
| `lcapb`  | Comité de Côte d'Argent de Pelote Basque        | <https://lcapb.euskalpilota.fr/resultats.php>    | yes             |
| `lidfpb` | Ligue d'Ile de France                           | <https://lidfpb.euskalpilota.fr/resultats.php>   | yes             |
| `ctpb`   | Comité Territorial Pays Basque de Pelote Basque | <https://ctpb.euskalpilota.fr/resultats.php>     | no              |
| `llpb`   | Comité des Landes de Pelote Basque              | <https://llpb.euskalpilota.fr/resultats.php>     | no              |
| `ffpb`   | Fédération Française de Pelote basque           | <https://competition.ffpb.net/FFPB_COMPETITION/> | no              |

- **Code**: the lowercase code every API and worker takes.
- **Name**: the `<title>` of the league's results site.
- **Nightly refresh**: whether the code is in `CRON_LEAGUES` (`workers/scheduler/src/index.ts`), so
  the 03:00 UTC cron refreshes its results and rankings. A league joins it once its results are
  loaded: see
  [Enrol the league in the nightly refresh](../how-to/howto-league-load-results.md#5-enrol-the-league-in-the-nightly-refresh).
  `ffpb` cannot join it as it is: the cron scrapes every specialty and category at once, which `ffpb`
  refuses.

## D1 databases

| Code     | Binding            | Database name       | Database ID                            |
| -------- | ------------------ | ------------------- | -------------------------------------- |
| `lcapb`  | `DB_LEAGUE_LCAPB`  | `pilotariak-lcapb`  | `bbf41c91-1bfd-4c31-bbc1-a83b588dacc4` |
| `lidfpb` | `DB_LEAGUE_LIDFPB` | `pilotariak-lidfpb` | `e5ebfb2b-6736-4662-8fd2-e078df3d9bee` |
| `ctpb`   | `DB_LEAGUE_CTPB`   | `pilotariak-ctpb`   | `11d235a6-faf2-4dde-81bd-2781f7e1e15e` |
| `llpb`   | `DB_LEAGUE_LLPB`   | `pilotariak-llpb`   | `6f3f9566-33a9-4f20-bf54-1cc4e2f76e43` |
| `ffpb`   | `DB_LEAGUE_FFPB`   | `pilotariak-ffpb`   | `ba5e1944-0cf0-425c-b59c-5398a85a411e` |

Each binding is declared in the `wrangler.toml` of `database/`, of each D1-backed subgraph
(`categories`, `clubs`, `competitions`, `rankings`, `results`, `specialties`), of `workers/scheduler`
and of `workers/setup-league`. Workers pick the binding at request time with
`DB_LEAGUE_${code.toUpperCase()}`. All databases share the schema in `database/migrations`.

## Scrapers

| Code     | Class           | File                                      | Session priming    |
| -------- | --------------- | ----------------------------------------- | ------------------ |
| `lcapb`  | `LcapbScraper`  | `workers/scheduler/src/leagues/lcapb.ts`  | no                 |
| `lidfpb` | `LidfpbScraper` | `workers/scheduler/src/leagues/lidfpb.ts` | no                 |
| `ctpb`   | `CtpbScraper`   | `workers/scheduler/src/leagues/ctpb.ts`   | yes                |
| `llpb`   | `LlpbScraper`   | `workers/scheduler/src/leagues/llpb.ts`   | no                 |
| `ffpb`   | `FfpbScraper`   | `workers/scheduler/src/leagues/ffpb.ts`   | yes, a WebDev flow |

Every class is registered in the `scrapers` map of `workers/scheduler/src/scraper.ts`. Every class but
`FfpbScraper` extends `EuskalpilotaScraper` (`leagues/euskalpilota.ts`). The CTPB site redirects to
`redirection.php` when a request carries no `PHPSESSID` cookie, so `CtpbScraper` fetches a session
cookie before each request. The other euskalpilota.fr sites answer without one. `FfpbScraper`
implements `LeagueScraper` itself: see [FFPB](#ffpb).

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

## FFPB

<https://competition.ffpb.net/> publishes the Championnat de France, the Challenge National, the Coupe de
France, the Tournoi Fédéral and the Tournoi Fédéral Corporatif. It is a PC SOFT WebDev application
(site version 1.10.13 on 2026-11-19), not `resultats.php`.

### Session flow

Every scrape opens its own anonymous session and makes the same choices as a browser on the guest home
page. No login is needed.

1. `GET /FFPB_COMPETITION/` sets the cookies `FFPB_COMPETITION_HOST`, `FFPB_COMPETITION_USER`,
   `FFPB_COMPETITION_PERIMETRE` and `DYN_SECURITEd10`, and returns the guest home page. Its search form
   holds the season, competition type, specialty and category selects. Its action,
   `/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/<token>`, carries a session token.
2. Each choice is an AJAX `POST` to that action: `WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=<select>`
   followed by every field of the form, as the browser posts it. The answer is `text/xml` (`<WAJAX>`)
   with the narrowed option lists only (`<CHAMP … TYPE="14">`), in about 0.1 s: the season gives its
   competition types, the type its specialties and categories, the specialty its categories.
3. The search button (`A32`) posts the form and answers the competitions page, its results table
   already filtered, with its counter (`<shown> / <total> lignes`).

A token from another session fails with HTTP 400 `CGI1910 ERR_BAD_URL`, so the scraper reads the token
from the form action and never stores it.

Results are always asked for one specialty and one category: `/scrape_results` answers HTTP 400 to
`specialty=0` or `category=0`, as `TOUTES` makes the competitions page list every match of the
competition.

Do not change the filters on the competitions page itself: each change there rebuilds its results
table with the other filters on `TOUTES`, which took 13 to 26 s per change on 2026-11-19, against
about 0.1 s on the home page.

Requests per call, as measured on 2026-11-19:

| Call                                  | Requests to the site                                                                                       | Time      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------- |
| `/scrape_infos` for one season        | home page, plus 1 season choice for a past season, plus 1 type choice for `<season>-<type>`                | about 1 s |
| `/scrape_infos` without `competition` | home page, plus 1 season choice per past season (4 on 2026-11-19)                                          | about 2 s |
| `/admin/options`                      | home page, season, competition type                                                                        | about 1 s |
| `/scrape_results`                     | the `/admin/options` requests, then a second session: home page, season, type, specialty, category, search | 4 to 15 s |
| `/scrape_rankings`                    | none                                                                                                       | —         |

The search is the slow request: the competitions page took between 2 and 11 s to build.

### WebDev ids

WebDev numbers its controls when the site is generated, so a new release can renumber them. `WEBDEV`
and `CELL` in `workers/scheduler/src/leagues/ffpb.ts` hold every id the scraper relies on.

| Id             | Control                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| `A34`          | Année sportive (season), home page                                       |
| `A33`          | Type de compétition, home page                                           |
| `A39`, `A38`   | Spécialité, home page: the browser changes `A39`, the server syncs `A38` |
| `A41`, `A36`   | Catégorie, home page: the browser changes `A41`, the server syncs `A36`  |
| `A32`          | "Chercher rencontres / résultats" button of the home page                |
| `I158`, `I164` | Results table of the competitions page, and its row counter              |

A `<select>` is posted as the 1-based position of its option in the list the server holds for the
session, and each choice changes the next lists. Each option also carries the site's own id,
`data-wb-valmem` in the page and `VALMEM` in the XML, which stays the same across seasons. The
`source_id` of every lookup row is that id, and the scraper turns it into the position of the list
it last received. It resolves options by id rather than by label, so a renamed option still
resolves.

### Mapping to the tables

| Table          | FFPB concept                  | `source_id`          | `name`            | Example                                          |
| -------------- | ----------------------------- | -------------------- | ----------------- | ------------------------------------------------ |
| `competitions` | A season and competition type | `<season>-<type id>` | `<type> <season>` | `2026-1`, `CHAMPIONNAT DE FRANCE 2026`           |
| `specialties`  | Spécialité                    | option id            | option label      | `23`, `Fronton mur à gauche Chistera Joko Garbi` |
| `categories`   | Catégorie                     | option id            | option label      | `1`, `Nationale A`                               |

The home page has no club or phase select, so `/scrape_infos` loads no club and no phase for `ffpb`.
Saving results creates the clubs that play, without a `source_id`.

`/scrape_infos` with a season (`2026`) loads the specialties and categories of that whole season, and
without `competition` those of every season. A competition `source_id` (`2026-1`), as `/scrape_infos`,
`/admin/options` and the check before `/scrape_results` pass it, narrows them to what the competition
offers, as the site does once the competition type is chosen.

Each results row maps to a `results` row:

- **Specialty, category, competition**: the group headers of the table, which must equal the labels of
  what was asked for. Any other header fails the scrape.
- **Phase**: under a `POULES` header, the row's pool (`Poule 1`); otherwise the header
  (`1/4 DE FINALE`, `BARRAGES MAINTIEN`).
- **Pool**: under a `POULES` header, the number of the row's pool (`Poule 1` gives `1`); null
  otherwise. The pool phase is always null: the site has no pool phases.
- **Club**: the team name with its number (`AVIRON BAYONNAIS 02`); saving strips the number.
- **Players**: `NAME Firstname (licence) (marker)` gives the name and the licence. The marker (`E`,
  `S`) is dropped.
- **Date**: `DD/MM/YYYY`, without the time; the new date of a postponed match
  (`24/01/2026 reportée au 06/02/2026` gives `06/02/2026`); empty for a match with no date yet.
- **Scores**: the sets, space-separated (`15/7 - 7/15 - 9/10` gives `15/7 7/15 9/10`). A score with no
  set, such as `40/P`, `P/40` or `Forfait général`, is stored as null, so the result of a forfeit is
  lost.

### Transport

The site pads its `Content-Length` header with trailing spaces. RFC 9110 tells parsers to strip them,
but the workerd HTTP client fails the request with `invalid Content-Length header value`. The site
leaves the header out of compressed answers, and it compresses some answers and not others, depending
on the time. Under workerd, `FfpbScraper` therefore sends its requests over a TLS socket
(`cloudflare:sockets`) and parses the answers itself (`leagues/socket-fetch.ts`). Under Bun, where the
unit tests mock `fetch()`, it uses `fetch()`.

### Gaps

- **Rankings.** The Classement tab is not scraped: `openRankings` lists no ranking, so
  `/scrape_rankings` answers HTTP 400 `The league site lists no ranking for …`. The tab offers three
  rankings ("par poule", "général à l'issue des poules" and "général final"), chosen by a variable of
  the page script (`gnTypeClassement`) that the AJAX request does not post as a form field. Without it,
  the "général à l'issue des poules" request answered an empty table.
- **Phases and clubs.** No phase or club is loaded, and `/scrape_results` answers HTTP 400 to a
  `phase` other than `0`.
- **Paging.** The table shows 50 rows, then an "Afficher plus" button. The scraper does not follow it:
  a specialty and category with more than 50 matches fails the scrape instead of saving part of them.
- **setup-league.** `/bootstrap` reads the `InCompet` select of `resultats.php`, which this site does
  not have, so it finds nothing. Bootstrap `ffpb` with the scheduler.
- **Every combination walk.** The admin page's walk runs one `/scrape_results` per specialty and
  category the competition offers, each with a search of 2 to 11 s. The competition's categories are
  those of every specialty: a category the specialty does not offer answers HTTP 400 at once,
  without a search, and the walk counts it as not offered and goes on.

### Bootstrap

1. Register the league: the Init button of the admin page's "Bootstrap a league" card, or
   `POST /admin/league?league=ffpb` with `{"name":"Fédération Française de Pelote basque"}`.
2. Load the competitions, specialties and categories of every season with one call:
   `/scrape_infos?league=ffpb`. The lists are the same for every competition of a season, so the
   per-competition loop of the bootstrap guide adds nothing. `competition=2026` loads one season,
   `competition=2026-1` only what that competition offers.
3. Load results one specialty and category at a time: `/scrape_results` with the database ids of the
   competition, specialty and category, or the admin page's "One combination" mode.

## Outside this repository

Azkena (the `league` enum of its tools) and Xilo (league detection in Slack messages) keep their own
list of league codes. A league added here is not available there until those repos add it.

## Add a league

Follow the three guides in order, then add a row to each table on this page:

1. [Create the database](../how-to/howto-league-create-database.md)
2. [Bootstrap the reference data](../how-to/howto-league-bootstrap.md)
3. [Load all results](../how-to/howto-league-load-results.md)
