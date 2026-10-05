# How to set up a league

The `setup-league` worker bootstraps the reference data for a league — competitions,
specialties, and categories — by scraping the league website and writing the results into
the league's D1 database.

Run `/init` once when a new league is added, then run `/bootstrap` at the start of each
season (or whenever you want to refresh the dropdown values from the upstream website).

---

## Authentication

Every endpoint except `/version` writes to the production D1 databases and hits the upstream
league websites, so the worker rejects any request that does not carry the shared secret:

```
x-internal-token: <INTERNAL_SERVICE_TOKEN>
```

It is the same `INTERNAL_SERVICE_TOKEN` the gateway presents to the subgraphs. A request
without it (or with a wrong value) gets `403 Forbidden`; a worker deployed without the secret
answers `500` to everything (fail closed).

- **Production:** `hack/scripts/setup-internal-service-token.sh` sets the secret on every
  worker, setup-league included. For one worker only:
  `wrangler secret put INTERNAL_SERVICE_TOKEN --name frontis-setup-league`.
- **Local:** create `workers/setup-league/.dev.vars` (gitignored) with
  `INTERNAL_SERVICE_TOKEN=dev-secret`, or run the setup script with `--dev-vars`.

The examples below assume the token is exported in your shell:

```bash
export INTERNAL_SERVICE_TOKEN=dev-secret
```

---

## Running locally

```bash
bun run setup-league:local
```

Or directly:

```bash
cd workers/setup-league
bun run dev
```

The worker starts on **`http://127.0.0.1:8788`**.

---

## Running against the remote database

```bash
bun run setup-league:remote
```

This connects the local worker to the **production D1 databases** — all writes go to the
real data. Always dry-run first.

---

## Endpoints

### `GET /version`

Returns the current Frontis version as JSON.

```bash
curl http://127.0.0.1:8788/version
# {"version":"0.5.0"}
```

---

### `GET /init`

Registers a new league in the database. Call this once before running `/bootstrap`.

**Required query parameters**

| Parameter | Description                                  | Example                                        |
| --------- | -------------------------------------------- | ---------------------------------------------- |
| `acronym` | Short identifier (matches DB binding suffix) | `lcapb`                                        |
| `name`    | Full display name of the league              | `Comité Cote d'Argent Pelote Basque`           |
| `url`     | URL of the upstream results page             | `https://lcapb.euskalpilota.fr/resultats.php`  |

**Response**

```json
{ "ok": true, "league": { "name": "...", "acronym": "lcapb", "url": "..." } }
```

**Example**

```bash
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lcapb&name=Comit%C3%A9+Cote+d%27Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php"
```

> The `acronym` must match an existing D1 database binding (`DB_LEAGUE_<ACRONYM>`).
> If no binding exists the worker returns a 400 error.

---

### `GET /bootstrap`

Scrapes competitions, specialties, and categories from the upstream league website and
optionally writes them to the D1 database.

**Required league** — provide one of:

| Method                       | Example                           |
| ---------------------------- | --------------------------------- |
| Header `X-Pilotariak-League` | `-H "X-Pilotariak-League: lcapb"` |
| Query parameter `league`     | `?league=lcapb`                   |

The header takes precedence if both are provided.

**Optional query parameters**

| Parameter               | Default | Description                                                                              |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `competition_source_id` | —       | Scope the scrape to a specific competition (passed as `&InCompet=` to the upstream site) |
| `dry_run`               | `true`  | If `false`, write scraped data to the database                                           |
| `no_color`              | `false` | Strip ANSI escape codes — useful for browsers and scripts                                |

> **Note:** `dry_run` defaults to `true` in this worker (unlike the scheduler).
> You must explicitly pass `dry_run=false` to write to the database.

> **Tip:** Pass `competition_source_id` to get a richer set of specialties and categories.
> Without it the upstream site returns a reduced set that may omit disciplines not
> associated with any current competition.

The league must already exist in the database (inserted via `/init`).

---

## Examples

### Initialise leagues

```bash
# Register LCAPB
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lcapb&name=Comit%C3%A9+Cote+d%27Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php"

# Register LIDFPB
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lidfpb&name=Ligue+Ile-de-France+de+Pelote+Basque&url=https://lidfpb.euskalpilota.fr/resultats.php"
```

### Bootstrap reference data

```bash
# Preview all form options — does not write to the database
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?no_color=true"

# Scope to a specific competition (scoped dropdowns from upstream)
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&no_color=true"

# Save competitions, specialties, and categories for LCAPB
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?dry_run=false&no_color=true"

# Save scoped to a specific competition
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&dry_run=false&no_color=true"

# Same for LIDFPB
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lidfpb" \
     "http://127.0.0.1:8788/bootstrap?dry_run=false&no_color=true"
```

Against the deployed worker, the production `INTERNAL_SERVICE_TOKEN` is required. If the
worker is additionally placed behind Cloudflare Access, add the Access service-token headers:

```bash
INTERNAL_SERVICE_TOKEN=...            # production secret
CF_CLIENT_ID=xxx.access               # only with Cloudflare Access
CF_CLIENT_SECRET=yyy
BASE="https://frontis-setup-league.nicolas-lamirault.workers.dev"

curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" \
     -H "CF-Access-Client-Id: ${CF_CLIENT_ID}" \
     -H "CF-Access-Client-Secret: ${CF_CLIENT_SECRET}" \
     -H "X-Pilotariak-League: lcapb" \
     -L \
     "${BASE}/bootstrap?competition_source_id=20260501&dry_run=false&no_color=true"
```

**Sample output**

```
League      : Comité Cote d'Argent Pelote Basque (LCAPB)  [saved to database]
URL         : https://lcapb.euskalpilota.fr/resultats.php
Competition : 20260501

Competitions (34)
  [20260502] Championnat Jeunes CCAPB 2025-2026
  [20260501] Championnat CCAPB 2025-2026
  [20260503] Championnat Corpo CCAPB 2025-2026
  ...

Specialties (10)
  [28] Mur à Gauche / P.G. Creuse Masculin Individuel
  [3]  Trinquet / P.G. Creuse Masculin
  ...

Categories (4)
  [1] 1ère Série
  [2] 2ème Série
  [3] 3ème Série
  [59] Poussin (stage)
```

Without `competition_source_id` the `Competition` line shows `(all)`.

---

## Recommended workflow

Run `setup-league` before using the scheduler's `/scrape_results` endpoint for a new
season. The scheduler depends on the `competitions`, `specialties`, and `categories` tables
being populated.

```bash
# Step 1 — register leagues (once per deployment / new league)
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lcapb&name=Comit%C3%A9+Cote+d%27Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php"
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lidfpb&name=Ligue+Ile-de-France+de+Pelote+Basque&url=https://lidfpb.euskalpilota.fr/resultats.php"

# Step 2 — dry-run to preview (scoped to the current season competition)
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&no_color=true"

# Step 3 — write to database
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&dry_run=false&no_color=true"
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lidfpb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&dry_run=false&no_color=true"

# Step 4 — verify the data was saved
bun wrangler d1 execute pilotariak-lcapb \
  --command "SELECT id, source_id, name FROM competitions ORDER BY source_id DESC LIMIT 5"
```

To reset and re-seed a league database:

```bash
bun run db:reset:lcapb:local
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" "http://127.0.0.1:8788/init?acronym=lcapb&name=Comit%C3%A9+Cote+d%27Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php"
curl -H "x-internal-token: ${INTERNAL_SERVICE_TOKEN}" -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/bootstrap?competition_source_id=20260501&dry_run=false&no_color=true"
```

Then proceed to the scheduler to scrape match results — see
[Use the scheduler](howto-scheduler.md).

---

## Deploying

```bash
bun run setup-league:deploy
```
