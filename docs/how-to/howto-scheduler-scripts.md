# How to load results with the scheduler scripts

`workers/scheduler/scripts/` holds two Bash loaders. Each picks ids from the league database and calls
the scheduler's `/scrape_results` once per specialty and category:

| Script                  | Use it to                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `scrape-competition.sh` | Load one competition, check the results before saving them, or recover results a full load skipped |
| `scrape-all-results.sh` | Load every competition of a league in production, without prompts                                  |

To load a whole league quickly, use one request per competition instead: see
[Load all results](howto-league-load-results.md#3-load-every-competition). The scripts send one
request per specialty and category, so they take much longer.

To load one competition from a browser instead, use the scheduler's
[admin page](howto-scheduler.md#use-the-admin-page): it lists only the specialties and categories
the competition offers, and runs rankings too. Its **Every combination** mode does what
`scrape-competition.sh --all` does: it previews each combination and asks before saving it.

In the commands below, replace `<league>` with the lowercase league code, for example `lcapb`.

## Prerequisites

- Bash 4 or later: `bash --version`. The scripts start with `#!/usr/bin/env bash`, and macOS ships
  bash 3.2 as `/bin/bash`, so a newer bash must come first in your `PATH`.
- `curl`, `jq`, `perl` (draws the preview tables) and `bun` (the scripts run `bunx wrangler`).
- For production, wrangler is logged in: see [Log in to wrangler](#log-in-to-wrangler).
- The league is bootstrapped: the scripts list the `competitions`, `specialties` and `categories`
  tables. See [Bootstrap the reference data](howto-league-bootstrap.md).

---

## Log in to wrangler

The scripts read the league database with `bunx wrangler d1 execute`. In production, that call uses
your wrangler login, whichever scheduler you use: the Access token of the deployed scheduler does not
cover it.

Check the login:

```bash
bunx wrangler whoami
```

When it has expired, log in again. This opens the Cloudflare login in your browser:

```bash
bunx wrangler login
```

An expired login stops the scripts before the first menu:

```
cannot query pilotariak-<league> with wrangler:
✘ [ERROR] Failed to fetch auth token: 400 Bad Request
  if your wrangler login expired, run 'bunx wrangler login' (or set CLOUDFLARE_API_TOKEN).
```

The scripts read wrangler's output through a pipe, so wrangler cannot ask you to log in: it fails
instead. Where no browser is available, set `CLOUDFLARE_API_TOKEN` to an API token that can access the
account's D1 databases.

> **Wrangler logs can hold your refresh token.** Wrangler writes one log file per command in
> `~/.config/.wrangler/logs/`. When a command refreshes your login, its log holds your OAuth refresh
> token in plain text, on the `fetching auth token` line. Do not share these files, and delete the old
> ones: `rm ~/.config/.wrangler/logs/wrangler-*.log`.

---

## Choose the scheduler

The scripts read ids from D1 themselves, then ask the scheduler to scrape. Both must use the same
database:

| Scheduler                      | Database    | Start it with              | `SCHEDULER_BASE`        | Script flag |
| ------------------------------ | ----------- | -------------------------- | ----------------------- | ----------- |
| Local worker                   | Local state | `bun run scheduler:local`  | `http://127.0.0.1:8787` | `--local`   |
| Local worker                   | Production  | `bun run scheduler:remote` | `http://127.0.0.1:8787` | none        |
| Deployed worker, behind Access | Production  | nothing to start           | unset (the default)     | none        |

The local worker's port comes from the [Port reference](../reference/ports.md).

You can call the scripts from any directory: they move to `database/` first, where wrangler finds the
D1 bindings and `--local` finds the state in `../.wrangler/state`.

Before the first menu, each script checks both sides and stops if one does not answer:

- The scheduler's `/version`: `no scheduler answers at <url>`.
- A `SELECT 1` on the league database through wrangler: `cannot query pilotariak-<league> with wrangler`,
  followed by wrangler's own error.

`scrape-competition.sh` also refuses `--local` with a URL that is not on `127.0.0.1` or `localhost`.

### Local worker

Keep the worker running in its own terminal. In the terminal you run the scripts from:

```bash
cd database
export SCHEDULER_BASE=http://127.0.0.1:8787
```

### Deployed worker

`https://frontis-scheduler.pilotariak.com` runs the code deployed from `main`. Cloudflare Access
protects it, so the scripts must send credentials. Set one of:

| Variable                            | Credential                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `CF_ACCESS_TOKEN`                   | Your own Access token, from your GitHub login                                                                |
| `CF_CLIENT_ID` + `CF_CLIENT_SECRET` | A service token. Works only if the scheduler's Access application has a Service Auth policy that includes it |

To get your own token:

1. Install `cloudflared`, for example with `brew install cloudflared`.
2. Log in once. This opens the GitHub login in your browser:

   ```bash
   cloudflared access login https://frontis-scheduler.pilotariak.com
   ```

3. Export the token, then run the scripts without `SCHEDULER_BASE` and without `--local`:

   ```bash
   cd database
   unset SCHEDULER_BASE
   export CF_ACCESS_TOKEN="$(cloudflared access token -app=https://frontis-scheduler.pilotariak.com)"
   ../workers/scheduler/scripts/scrape-competition.sh <league>
   ```

The scripts pass the headers to `curl` through a file descriptor, so the token and the secret do not
show in the process list.

The token lasts as long as an Access session. When it expires, run step 3 again. The `/version`
check runs once at start: if the token expires during a long `scrape-all-results.sh` run, the
remaining calls get the Access login page and save nothing.

The deployed worker is subject to the Workers CPU time limit, unlike `wrangler dev`. If a call fails
with `Worker exceeded CPU time limit.`, load that competition with a local worker
(`bun run scheduler:remote`) instead.

#### What cloudflared does

`cloudflared` is Cloudflare's command-line client. The scripts only need its `access` commands. They
start no tunnel, daemon or service, and change neither the Access configuration nor the worker.

- `cloudflared access login <url>` follows the redirect of `<url>` to find the Access team
  (`portefaix.cloudflareaccess.com`) and the application. It opens the login page in your browser,
  then saves the application token in `~/.cloudflared/` and prints it.
- `cloudflared access token -app=<url>` prints the saved token without opening the browser. Once the
  token has expired, it fails: run `login` again.

The token is a JWT signed by Cloudflare. It carries your identity, the application and an expiry date.
Access checks it in the `cf-access-token` header the way it checks a browser's `CF_Authorization`
cookie, under the same policy.

Treat the token as your session on the scheduler:

- Until it expires, anyone who reads it can call the scheduler, and so write to the production
  database. It is valid for this application only.
- It is stored in plain text in `~/.cloudflared/`.
- `export` puts it in your shell environment, and every program you start from that shell inherits
  it. Run `unset CF_ACCESS_TOKEN` when you are done.
- To revoke it before it expires, revoke your sessions in the Cloudflare Zero Trust dashboard.

---

## Load one specialty and category of a competition

```bash
../workers/scheduler/scripts/scrape-competition.sh <league> --local
```

Drop `--local` to work on production. The script then:

1. Lists the competitions, sorted by name, and asks for a number.
2. Does the same for the specialty, then the category.
3. Shows a dry-run preview of the results.
4. Asks `Save these results into D1? [y/N]`. Answer `y` to save. Any other answer prints
   `aborted, nothing saved.`

```
Choose a competition:
  ...
   12) Championnat CCAPB 2025-2026  [id=444]
  ...
competition # > 12
  -> Championnat CCAPB 2025-2026 (id=444)

Choose a specialty:
  ...
specialty # > 8
  -> Trinquet / P.G. Creuse Masculin (id=95)

Choose a category:
  ...
category # > 1
  -> 1ère Série (id=881)

── Preview (dry run) ─────────────────────────────────────────
# LCAPB  competition=444 [Championnat CCAPB 2025-2026]  specialty=95 [Trinquet / P.G. Creuse Masculin]  category=881 [1ère Série]  —  40 found (dry-run)
+------------+----------------------+----------------------+-------------+-------------+
|    DATE    |        CLUB 1        |        CLUB 2        |    SCORE    | COMMENTAIRE |
+------------+----------------------+----------------------+-------------+-------------+
| 25/01/2026 | CA BEGLAIS 01        | CA BEGLAIS 02        | 15/09 15/06 |             |
|            | (012345) DUPONT Jean | (067890) MARTIN Paul |             |             |
|            | (011111) LEROY Marc  | (022222) DURAND Eric |             |             |
+------------+----------------------+----------------------+-------------+-------------+
...

Save these results into D1? [y/N] >
```

The header line shows each filter as `id [name]`. A combination with no results shows
`(no results)` under it.

A specialty or category the competition does not offer stops the script with
`HTTP 400: <reason>`, and the reason lists the ids the competition offers.

---

## Load every specialty and category of a competition

```bash
../workers/scheduler/scripts/scrape-competition.sh <league> --all
```

With `--all` you only pick the competition. The script prints
`Looping <S> specialties x <C> categories for competition=<id> (saving each).` and asks
`Proceed? [y/N]`. Then, for each specialty and category:

- It previews the results as a dry run.
- It skips a combination with no results, or one the competition does not offer, without asking.
- It shows the table and asks `Save? [y]es / [n]o / [a]ll-rest / [q]uit`. `a` saves this
  combination and every following one without asking again. `q` stops.

It ends with `done: <N> combos — <saved> saved, <skipped> skipped (empty or not offered).`

The `Save?` prompt reads from the terminal, not from standard input, so you cannot pipe answers to
it. Use `--save` instead.

Each combination costs one request, plus one more to save it. The upstream site returns the whole
competition whatever the specialty and category: the scheduler keeps the rows that match.

---

## Run without prompts

`--save` answers yes to every save prompt:

- With `--all`, the script skips `Proceed?` and saves every combination that has results.
- Without `--all`, it saves the previewed results without asking.

The competition, specialty and category menus still read standard input. To run unattended, check the
competition's number in the menu once, then pipe it:

```bash
echo 12 | ../workers/scheduler/scripts/scrape-competition.sh <league> --all --save
```

The numbers follow the alphabetical order of the names, so they change when a competition is added.

---

## Load only one phase

Both scripts take `--phase <id>`, where `<id>` is the `id` column of the `phases` table. The default,
`0`, loads every phase. Unlike the specialty and category, the upstream site applies this filter
itself (tested on LCAPB: 40 results without a phase, 30 with `Poules`).

```bash
bun run db:<league>:local "SELECT id, name FROM phases ORDER BY name"
../workers/scheduler/scripts/scrape-competition.sh <league> --local --phase <id>
```

`/bootstrap` does not fill the `phases` table: load it with the scheduler's `/scrape_infos`, as in
step 5 of [Bootstrap the reference data](howto-league-bootstrap.md#5-optional-save-the-clubs-and-phases).

---

## Load every competition in production

`scrape-all-results.sh` loops over every competition, specialty and category in the production
database, with no menu and no prompt. It has no `--local` flag: use `bun run scheduler:remote` or the
[deployed worker](#deployed-worker).

Preview first, then save:

```bash
../workers/scheduler/scripts/scrape-all-results.sh <league> --dry-run > scrape-all.log
../workers/scheduler/scripts/scrape-all-results.sh <league> > scrape-all.log
```

The first line gives the size of the run:

```
league=<league> competitions=<N> specialties=<S> categories=<C> dry=no
```

The script then prints `GET <url>` and the scheduler's answer for each combination. A combination
the competition does not offer is answered with HTTP 400 and printed as `skipped: <reason>`; most
combinations are skipped this way. Any other failed request prints
`!! failed comp=<id> spec=<id> cat=<id>` and the loop goes on. Count the failures when it ends:

```bash
grep -c '!! failed' scrape-all.log
```

The script sends N × S × C requests, with a 0.3 s pause after each. For 36 competitions, 11
specialties and 8 categories, that is 3,168 requests and close to 16 minutes of pauses alone.

---

## Load every ranking in production

`scrape-all-rankings.sh` loads the end-of-championship rankings the same way: one `/scrape_rankings`
call per competition and specialty of the production database, every category at once. A competition missing from the rankings page,
or a specialty the competition does not offer, is answered with HTTP 400 and printed as
`skipped: <reason>`: most combinations are skipped, and only other errors print `!! failed`.

```bash
../workers/scheduler/scripts/scrape-all-rankings.sh <league> --dry-run > rankings-all.log
../workers/scheduler/scripts/scrape-all-rankings.sh <league> > rankings-all.log
grep -c '!! failed' rankings-all.log
```

Rankings of a season still running stay in the nightly refresh until each has a champion.

---

## After a load

Saving results enables the competition, which puts it in the nightly refresh when the league is
listed in `CRON_LEAGUES`. After loading past seasons, follow
[Enrol the league in the nightly refresh](howto-league-load-results.md#5-enrol-the-league-in-the-nightly-refresh).

---

## Troubleshooting

| Symptom                                                  | Cause and fix                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no competition found in pilotariak-<league>`            | The table is empty in the database you read. Check `--local`, or bootstrap the league.                                                                                                                                                                                                                  |
| `mapfile: command not found`                             | Bash 3.2 ran the script. Put bash 4 or later first in your `PATH`.                                                                                                                                                                                                                                      |
| `no scheduler answers at <url>`                          | Local worker: start it and set `SCHEDULER_BASE`. Deployed worker: set `CF_ACCESS_TOKEN`, or get a new one if it expired.                                                                                                                                                                                |
| `cannot query pilotariak-<league> with wrangler`         | Followed by `Failed to fetch auth token: 400 Bad Request`: your wrangler login expired: see [Log in to wrangler](#log-in-to-wrangler). Followed by `Couldn't find a D1 DB`: the league has no binding in `database/wrangler.toml`.                                                                      |
| `--local needs a local worker`                           | `--local` with the deployed URL. Drop `--local`, or set `SCHEDULER_BASE=http://127.0.0.1:8787`.                                                                                                                                                                                                         |
| `set both CF_CLIENT_ID and CF_CLIENT_SECRET, or neither` | Only one half of the service token is set.                                                                                                                                                                                                                                                              |
| `curl: (22) ... error: 500`, or `(request failed)`       | The scheduler failed. A local worker prints why in its terminal; for the deployed one, run `bunx wrangler tail frontis-scheduler` from `workers/scheduler/`. `Competition with id '<id>' not found` means the script and the scheduler use different databases: match `--local` with `scheduler:local`. |
| `unknown arg: <arg>`                                     | The flag does not exist in this script. `scrape-all-results.sh` takes `--dry-run` and `--phase` only.                                                                                                                                                                                                   |
