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

Every scrape opens its own anonymous session, as a browser does. No login is needed.

1. `GET /FFPB_COMPETITION/` sets the cookies `FFPB_COMPETITION_HOST`, `FFPB_COMPETITION_USER`,
   `FFPB_COMPETITION_PERIMETRE` and `DYN_SECURITEd10`, and returns the guest home page. Its form action,
   `/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/<token>`, carries a session token.
2. `POST <home form action>` with `WD_ACTION_=&WD_BUTTON_CLICK_=A32` (the home page's "Chercher
   rencontres / résultats" button) returns the competitions page, about 690 KB. Its form action is
   `/FFPB_COMPETITION/PAGE_COMPETITION_INVITE/<token>`.
3. Each filter change is an AJAX `POST` to that action: `WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=<select>`
   followed by every field of the form, as the browser posts it. The answer is `text/xml`
   (`<WAJAX>`): the new option list of each filter (`<CHAMP … TYPE="14">`), the results table
   (`<CHAMP ALIAS="I158">`, one row of HTML per CDATA section) and its counter (`<shown> / <total> lignes`).

A token from another session fails with HTTP 400 `CGI1910 ERR_BAD_URL`, so the scraper reads the tokens
from the form actions and never stores them.

The page opens on the current season. To show another one, the scraper first changes the season. The
site then resets every other filter to `TOUTES` and answers the first 50 rows of the whole season,
about 630 KB, which no request can avoid. Results are then asked for with a category change that also
sets the competition type, the specialty and the category. They are always asked for one specialty and
one category: `/scrape_results` answers HTTP 400 to `specialty=0` or `category=0`, as `TOUTES` returns
a very large page.

Requests per call:

| Call                                  | Requests to the site                                            |
| ------------------------------------- | --------------------------------------------------------------- |
| `/scrape_infos` for one season        | 2, plus 1 season change for a past season                       |
| `/scrape_infos` without `competition` | 2, plus 1 season change per past season (4 on 2026-11-19)       |
| `/scrape_results`                     | two sessions: the results form check, then the results (5 to 7) |
| `/scrape_rankings`                    | none                                                            |

### WebDev ids

WebDev numbers its controls when the site is generated, so a new release can renumber them. `WEBDEV`
and `CELL` in `workers/scheduler/src/leagues/ffpb.ts` hold every id the scraper relies on.

| Id             | Control                                                   |
| -------------- | --------------------------------------------------------- |
| `A32`          | "Chercher rencontres / résultats" button of the home page |
| `I5`           | Année sportive (season)                                   |
| `I4`           | Compétition (competition type)                            |
| `I10`, `I9`    | Spécialité (the page holds two, posted with one value)    |
| `I12`, `I7`    | Catégorie (the page holds two, posted with one value)     |
| `I227`         | Phases                                                    |
| `I223`         | Nom du club                                               |
| `I158`, `I164` | Results table, and its row counter                        |

A `<select>` is posted as the 1-based position of its option in the list the server holds for the
session, and that list changes with the season. Each option also carries the site's own id,
`data-wb-valmem` in the page and `VALMEM` in the XML, which stays the same across seasons. The
`source_id` of every lookup row is that id, and the scraper turns it into the position of the list
it last received. It resolves options by id rather than by label, so a renamed option still
resolves.

### Mapping to the tables

| Table          | FFPB concept                  | `source_id`              | `name`            | Example                                          |
| -------------- | ----------------------------- | ------------------------ | ----------------- | ------------------------------------------------ |
| `competitions` | A season and competition type | `<season>-<type id>`     | `<type> <season>` | `2026-1`, `CHAMPIONNAT DE FRANCE 2026`           |
| `specialties`  | Spécialité                    | option id                | option label      | `23`, `Fronton mur à gauche Chistera Joko Garbi` |
| `categories`   | Catégorie                     | option id                | option label      | `1`, `Nationale A`                               |
| `phases`       | Phases                        | option id                | option label      | `10`, `1/4 de finale`                            |
| `clubs`        | Nom du club                   | option id before its `:` | option label      | `382`, `AVIRON BAYONNAIS`                        |

The specialty, category and phase lists cover a whole season, every competition type included. A
competition type can offer fewer: such a combination answers no results.

Each results row maps to a `results` row:

- **Specialty, category, competition**: the group headers of the table, which must equal the labels of
  what was asked for. Any other header fails the scrape.
- **Phase**: under a `POULES` header, the row's pool (`Poule 1`); otherwise the header
  (`1/4 DE FINALE`). A `phase` filter keeps the rows whose header matches the phase label, case and
  accents ignored.
- **Club**: the team name with its number (`AVIRON BAYONNAIS 02`); saving strips the number.
- **Players**: `NAME Firstname (licence) (marker)` gives the name and the licence. The marker (`E`,
  `S`) is dropped.
- **Date**: `DD/MM/YYYY`, without the time; empty for a match with no date yet.
- **Scores**: the sets, space-separated (`15/7 - 7/15 - 9/10` gives `15/7 7/15 9/10`). A score with no
  set, such as `40/P` or `Forfait général`, is stored as null, so the result of a forfeit is lost.

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
- **Paging.** The table shows 50 rows, then an "Afficher plus" button. The scraper does not follow it:
  a specialty and category with more than 50 matches fails the scrape instead of saving part of them.
- **setup-league.** `/bootstrap` reads the `InCompet` select of `resultats.php`, which this site does
  not have, so it finds nothing. Bootstrap `ffpb` with the scheduler.
- **Every combination walk.** The admin page's walk runs one `/scrape_results` per specialty and
  category, two sessions each. A season offers about 40 specialties and 15 categories: load `ffpb`
  one combination at a time instead.
- **Every competition bootstrap.** The admin page's "Bootstrap a league" card can run `/scrape_infos`
  once per competition in D1. For `ffpb`, each run loads the competition's whole season again, one
  session and usually one season change each, about 25 runs. Run `/scrape_infos` once without
  `competition` instead.

### Bootstrap

1. Register the league: the Init button of the admin page's "Bootstrap a league" card, or
   `POST /admin/league?league=ffpb` with `{"name":"Fédération Française de Pelote basque"}`.
2. Load the competitions, specialties, categories, phases and clubs of every season with one call:
   `/scrape_infos?league=ffpb`. The lists are the same for every competition of a season, so the
   per-competition loop of the bootstrap guide is not needed. `competition=2026` (or `2026-1`) loads
   one season.
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
