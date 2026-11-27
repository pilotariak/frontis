# Logs

The scheduler and setup-league log one object per line. Workers Logs indexes the keys of a logged
object as fields, so a query can filter and group on them. A string log can only be searched as
text.

This page lists the fields and the events. To query them, see
[Read the logs](../how-to/howto-scheduler.md#read-the-logs). The code that writes them is
`workers/scheduler/src/log.ts` and `workers/setup-league/src/log.ts`: change this page with it.

## Levels

| Console method  | Used for                                                                    |
| --------------- | --------------------------------------------------------------------------- |
| `console.log`   | A step that went as planned                                                 |
| `console.warn`  | Rows left out of a save                                                     |
| `console.error` | An error a route returns, a failed cron self-call, a league the cron missed |

Every error a route returns is logged with `console.error`, an HTTP 400 too. The `status` field
tells a bad request from a failure.

## Fields

Every value is a string or a number. A line holds only the fields it knows.

| Field            | Type   | Meaning                                                                                    |
| ---------------- | ------ | ------------------------------------------------------------------------------------------ |
| `event`          | string | What happened. See [Events](#events).                                                      |
| `message`        | string | A sentence you can read alone. On `route.error`, the error the route returns.              |
| `route`          | string | The request path: `/scrape_results`, `/admin/options`, `/bootstrap`.                       |
| `league`         | string | League code: `lcapb`, `lidfpb`, `ctpb`, `llpb`, `ffpb`.                                    |
| `competition`    | string | The competition. See [Ids](#ids).                                                          |
| `specialty`      | string | The specialty, as the request or the cron named it.                                        |
| `category`       | string | The category, as the request named it.                                                     |
| `phase`          | string | The phase, as the request named it.                                                        |
| `dryRun`         | string | `"true"` or `"false"`, when the request names `dry_run`. Always set on `/bootstrap`.       |
| `status`         | number | The HTTP status the route answered. On `cron.scrape.error`, the status of the self-call.   |
| `found`          | number | Rows read from the league site. On `/scrape_infos` and `/bootstrap`, form options read.    |
| `saved`          | number | Rows written to D1. `0` on a dry run.                                                      |
| `skipped`        | number | Rows left out of a save.                                                                   |
| `failed`         | number | Self-calls that failed in a cron run.                                                      |
| `missing`        | string | The `specialty / category` labels of the rows left out. See [Skipped rows](#skipped-rows). |
| `durationMs`     | number | Wall time, in milliseconds.                                                                |
| `upstreamStatus` | number | The HTTP status the league site answered.                                                  |
| `upstreamBody`   | string | The start of what the league site answered. See [Upstream body](#upstream-body).           |
| `pageSize`       | number | Characters of the results page the league scraper read.                                    |
| `cron`           | string | The cron expression that started the run: `0 3 * * *`.                                     |

### Ids

On `route.*` lines, `competition`, `specialty`, `category` and `phase` are the request parameters,
as given. The scrape routes take database ids. `/scrape_infos` and `/bootstrap` take a competition
`source_id`. On `cron.*` and `*.skipped` lines, `competition` and `specialty` are database ids.

## Events

| Event               | Level        | Worker    | Written when                                                        |
| ------------------- | ------------ | --------- | ------------------------------------------------------------------- |
| `route.done`        | log          | both      | A scrape route answered its counts                                  |
| `route.error`       | error        | both      | A route returned an error, HTTP 4xx or 5xx                          |
| `league.results`    | log          | scheduler | A league scraper read a results page                                |
| `results.skipped`   | warn         | scheduler | `/scrape_results` left out rows. One line per call                  |
| `rankings.skipped`  | warn         | scheduler | `/scrape_rankings` left out teams. One line per call                |
| `cron.start`        | log          | scheduler | The nightly cron started                                            |
| `cron.skip`         | log or error | scheduler | The cron skipped a league                                           |
| `cron.scrape`       | log          | scheduler | One self-call of the cron answered its counts                       |
| `cron.scrape.error` | error        | scheduler | One self-call of the cron failed                                    |
| `cron.summary`      | log          | scheduler | The totals of a league for one route: `/scrape_results` or rankings |

### Routes

`route.done` is written by `/scrape_infos`, `/scrape_results`, `/scrape_rankings` and
setup-league's `/bootstrap`. It carries `status`, `found`, `saved` (not on `/scrape_infos` and
`/bootstrap`) and `durationMs`.

`route.error` is written by every error the scheduler and setup-league return: the scrape routes,
`/admin/competitions`, `/admin/options`, `/admin/league`, `/init` and `/bootstrap`. It carries the
request parameters, `status`, `durationMs` and `message`. After a league site failure it also
carries `upstreamStatus` and `upstreamBody`.

The answer of a route does not change: the same status and the same error text as before.

### League scrapers

`league.results` carries `league`, `found`, `pageSize` and `durationMs`. The euskalpilota.fr
leagues (`lcapb`, `lidfpb`, `ctpb`, `llpb`) also carry `upstreamStatus`. The `message` names the
FFPB competition, specialty and category, or the URL posted to.

### Cron

`cron.skip` is an error when the league has no D1 binding or its competitions cannot be listed. It
is a log line when the league has no enabled competition.

`cron.scrape` and `cron.scrape.error` carry `route`, `league`, `competition`, `durationMs`, and
`specialty` for rankings. `cron.scrape` also carries `found` and `saved`. The callee of a failed self-call writes its own `route.error`, with the
league site's answer.

`cron.summary` carries `route`, `league`, `saved` and `failed`.

### Skipped rows

`results.skipped` and `rankings.skipped` replace one warning per row with one per call. They carry
`league`, `competition`, `found`, `skipped` and `missing`.

`missing` lists each `specialty / category` label once, separated by `;`. It names at most 10
labels, then the count of the others: `(+3 more)`. `/scrape_results` leaves out a row whose
specialty, category or club has no database id. `/scrape_rankings` leaves out a team whose club is
unknown or listed twice.

## Upstream body

`upstreamBody` keeps what the league site answered when the scraper could not use it: an HTTP
error, or a page without the expected form or WAJAX answer. WebDev and PHP error pages name their
error in their text.

- Tags, scripts and styles are dropped. The text is kept.
- Whitespace is collapsed to single spaces.
- The text is cut to 200 characters, then `…`.
- The value after a session id, token, cookie, auth, secret, password or API key name is replaced
  by `[redacted]`: `PHPSESSID=[redacted]`, `access_token=[redacted]`.
- Any run of 32 or more letters, digits or URL symbols is replaced by `[redacted]`. This covers
  tokens, hashes and WebDev session paths.

Request headers and cookie jars are never logged. One plain-text line still shows a session id:
setup-league's `curl` line, which prints the `PHPSESSID` cookie it sends. The CTPB scraper's
session warm-up line is also still plain text.
