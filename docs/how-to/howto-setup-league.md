# How to set up a league

The `setup-league` worker bootstraps the reference data for a league — competitions,
specialties, and categories — by scraping the league website and writing the results into
the league's D1 database.

Run it once when a new season starts, or whenever you want to refresh the dropdown values
from the upstream website.

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

## Endpoint

### `GET /`

**Required header**

| Header                 | Description         |
| ---------------------- | ------------------- |
| `X-Pilotariak-League`  | `lcapb` or `lidfpb` |

**Optional query parameters**

| Parameter              | Default | Description                                                        |
| ---------------------- | ------- | ------------------------------------------------------------------ |
| `competition_source_id`| —       | Scope the scrape to a specific competition (passed as `&InCompet=` to the upstream site) |
| `dry_run`              | `true`  | If `false`, write scraped data to the database                     |
| `no_color`             | `false` | Strip ANSI escape codes — useful for browsers and scripts          |

> **Note:** `dry_run` defaults to `true` in this worker (unlike the scheduler).
> You must explicitly pass `dry_run=false` to write to the database.

> **Tip:** Pass `competition_source_id` to get a richer set of specialties and categories.
> Without it the upstream site returns a reduced set that may omit disciplines not
> associated with any current competition.

---

## Examples

```bash
# Preview all form options — does not write to the database
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?no_color=true"

# Scope to a specific competition (scoped dropdowns from upstream)
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&no_color=true"

# Save competitions, specialties, and categories for LCAPB
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?dry_run=false&no_color=true"

# Save scoped to a specific competition
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&dry_run=false&no_color=true"

# Same for LIDFPB
curl -H "X-Pilotariak-League: lidfpb" \
     "http://127.0.0.1:8788/?dry_run=false&no_color=true"
```

Against the deployed worker (requires Cloudflare Access service token):

```bash
CF_CLIENT_ID=xxx.access
CF_CLIENT_SECRET=yyy
BASE="https://frontis-setup-league.nicolas-lamirault.workers.dev"

curl -H "CF-Access-Client-Id: ${CF_CLIENT_ID}" \
     -H "CF-Access-Client-Secret: ${CF_CLIENT_SECRET}" \
     -H "X-Pilotariak-League: lcapb" \
     -L \
     "${BASE}/?competition_source_id=20260501&dry_run=false&no_color=true"
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
# Step 1 — dry-run to preview (scoped to the current season competition)
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&no_color=true"

# Step 2 — write to database
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&dry_run=false&no_color=true"
curl -H "X-Pilotariak-League: lidfpb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&dry_run=false&no_color=true"

# Step 3 — verify the data was saved
bun wrangler d1 execute pilotariak-lcapb \
  --command "SELECT id, source_id, name FROM competitions ORDER BY source_id DESC LIMIT 5"
```

To reset and re-seed a league database:

```bash
bun run db:reset:lcapb:local
curl -H "X-Pilotariak-League: lcapb" \
     "http://127.0.0.1:8788/?competition_source_id=20260501&dry_run=false&no_color=true"
```

Then proceed to the scheduler to scrape match results — see
[Use the scheduler](howto-scheduler.md).

---

## Deploying

```bash
bun run setup-league:deploy
```
