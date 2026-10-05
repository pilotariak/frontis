import type { Env, ScrapedResult } from "./types";
import { CtpbScraper } from "./leagues/ctpb";
import { LcapbScraper } from "./leagues/lcapb";
import { LidfpbScraper } from "./leagues/lidfpb";
import type { FormOptions, LeagueScraper, ScrapeOptions } from "./leagues/types";

export interface ScraperOptions extends ScrapeOptions {
  league: string;
}

const scrapers: Record<string, LeagueScraper> = {
  lcapb: new LcapbScraper(),
  lidfpb: new LidfpbScraper(),
  ctpb: new CtpbScraper(),
};

type DatabaseBinding = Extract<keyof Env, `DB_LEAGUE_${string}`>;

function getDatabase(env: Env, league: string): D1Database {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as DatabaseBinding;
  const db: D1Database | undefined = env[key];
  if (!db) {
    throw new Error(`Database binding for league '${league}' not found.`);
  }
  return db;
}

// ── /scrape_infos ─────────────────────────────────────────────────────────────

/**
 * Upsert every scraped dropdown value into its lookup table.
 *
 * All rows go through a single `db.batch()`: one D1 subrequest instead of one
 * per row (a full `/scrape_infos` yields a few hundred rows, which used to be a
 * few hundred sequential round trips), and D1 runs a batch as one transaction,
 * so a failure midway no longer leaves the lookup tables half-updated. Each
 * prepared statement is reused across its rows via `bind()`.
 *
 * Conflict targets differ on purpose: specialties and clubs are keyed by name
 * (the HTML results only carry names), categories/phases/competitions by
 * source_id (their names change between seasons, the id does not).
 */
async function saveFormOptions(db: D1Database, options: FormOptions): Promise<void> {
  const bySourceIdOnNameConflict = (table: string) =>
    db.prepare(
      `INSERT INTO ${table} (source_id, name) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id`
    );
  const byNameOnSourceIdConflict = (table: string) =>
    db.prepare(
      `INSERT INTO ${table} (source_id, name) VALUES (?, ?)
       ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`
    );

  const upsertSpecialty = bySourceIdOnNameConflict("specialties");
  const upsertClub = bySourceIdOnNameConflict("clubs");
  const upsertCategory = byNameOnSourceIdConflict("categories");
  const upsertPhase = byNameOnSourceIdConflict("phases");
  const upsertCompetition = byNameOnSourceIdConflict("competitions");

  const statements: D1PreparedStatement[] = [
    ...options.specialties.map((s) => upsertSpecialty.bind(s.sourceId, s.name)),
    ...options.clubs.map((c) => upsertClub.bind(c.sourceId, c.name)),
    ...options.categories.map((c) => upsertCategory.bind(c.sourceId, c.name)),
    ...options.phases.map((p) => upsertPhase.bind(p.sourceId, p.name)),
    ...options.competitions.map((c) => upsertCompetition.bind(c.sourceId, c.name)),
  ];

  if (statements.length > 0) await db.batch(statements);
}

export async function scrapeInfos(
  env: Env,
  options: ScraperOptions,
  dryRun: boolean
): Promise<FormOptions> {
  const scraper = scrapers[options.league.toLowerCase()];
  if (!scraper) throw new Error(`Unsupported league: ${options.league}`);

  const { formOptions } = await scraper.fetchData(options, false);

  if (!dryRun) {
    const db = getDatabase(env, options.league);
    await saveFormOptions(db, formOptions);
  }

  return formOptions;
}

// ── /scrape_results ───────────────────────────────────────────────────────────

/**
 * Resolve internal DB IDs to source_ids before passing options to the league
 * scraper, which communicates with the external website using source_ids.
 */
async function resolveSourceIds(db: D1Database, options: ScraperOptions): Promise<ScraperOptions> {
  const competition = await db
    .prepare("SELECT source_id FROM competitions WHERE id = ?")
    .bind(options.competition)
    .first<{ source_id: string }>();

  if (!competition?.source_id) {
    throw new Error(`Competition with id '${options.competition}' not found in database. Run /scrape_infos first.`);
  }

  let specialty = options.specialty;
  if (specialty && specialty !== "0") {
    const row = await db
      .prepare("SELECT source_id FROM specialties WHERE id = ?")
      .bind(specialty)
      .first<{ source_id: string }>();
    if (!row?.source_id) {
      throw new Error(`Specialty with id '${specialty}' not found in database. Run /scrape_infos first.`);
    }
    specialty = row.source_id;
  }

  let category = options.category;
  if (category && category !== "0") {
    const row = await db
      .prepare("SELECT source_id FROM categories WHERE id = ?")
      .bind(category)
      .first<{ source_id: string | null }>();
    if (row?.source_id) {
      category = row.source_id;
    }
  }

  let phase = options.phase;
  if (phase && phase !== "0") {
    const row = await db
      .prepare("SELECT source_id FROM phases WHERE id = ?")
      .bind(phase)
      .first<{ source_id: string }>();
    if (!row?.source_id) {
      throw new Error(`Phase with id '${phase}' not found in database. Run /scrape_infos first.`);
    }
    phase = row.source_id;
  }

  return { ...options, competition: competition.source_id, specialty, category, phase };
}

/**
 * Persist scraped results.
 *
 * Cloudflare Workers cap each invocation at a fixed number of subrequests
 * (50 free / 1000 paid), and every D1 query counts as one. A per-row query
 * loop therefore blows the limit on any sizeable result set. This function
 * keeps the subrequest count flat and small:
 *   1. one SELECT per lookup table to preload name → id maps,
 *   2. one db.batch() to INSERT OR IGNORE any missing clubs/categories,
 *   3. one db.batch() of INSERT OR IGNORE statements for the results, plus
 *      the UPDATEs flipping `enabled` on the competition, specialties and
 *      categories those results belong to.
 * The results table carries a UNIQUE(competition_id, specialty_id,
 * category_id, date_match, club_a_id, club_b_id, phase) constraint, so
 * INSERT OR IGNORE replaces the former SELECT-then-INSERT existence check.
 */
async function saveResults(db: D1Database, options: ScraperOptions, results: ScrapedResult[]): Promise<number> {
  if (results.length === 0) return 0;

  const competition = await db
    .prepare("SELECT id FROM competitions WHERE source_id = ?")
    .bind(options.competition)
    .first<{ id: number }>();

  if (!competition) {
    throw new Error(`Competition with source_id '${options.competition}' not found in database. Run /scrape_infos first.`);
  }

  // Look up specialty by source_id when a specific specialty was requested,
  // since the scraped HTML text may differ from the stored dropdown label.
  const sharedSpecialty = options.specialty && options.specialty !== "0"
    ? await db
        .prepare("SELECT id FROM specialties WHERE source_id = ?")
        .bind(options.specialty)
        .first<{ id: number }>()
    : null;

  if (options.specialty && options.specialty !== "0" && !sharedSpecialty) {
    throw new Error(`Specialty with source_id '${options.specialty}' not found in database. Run /scrape_infos first.`);
  }

  // Club names in results carry a team-number suffix (e.g. "CA BEGLAIS 01")
  // that is not present in the dropdown used by scrape_infos ("CA BEGLAIS").
  // Strip the trailing numeric token before looking up.
  const baseClubName = (name: string) => name.replace(/\s+\d+$/, "").trim();

  // Insert any clubs/categories we have not seen yet in a single batch, so the
  // subsequent map preload sees every name. INSERT OR IGNORE is a no-op for
  // existing rows.
  const clubNames = new Set<string>();
  const categoryNames = new Set<string>();
  for (const res of results) {
    clubNames.add(baseClubName(res.club_a));
    clubNames.add(baseClubName(res.club_b));
    categoryNames.add(res.category);
  }

  const insertClub = db.prepare(`INSERT OR IGNORE INTO clubs (name) VALUES (?)`);
  const insertCategory = db.prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`);
  const upserts = [
    ...[...clubNames].map((name) => insertClub.bind(name)),
    ...[...categoryNames].map((name) => insertCategory.bind(name)),
  ];
  if (upserts.length > 0) await db.batch(upserts);

  // Preload name → id maps for every lookup table with one query each.
  const buildMap = async (table: string): Promise<Map<string, number>> => {
    const { results: rows } = await db
      .prepare(`SELECT id, name FROM ${table}`)
      .all<{ id: number; name: string }>();
    return new Map(rows.map((r) => [r.name, r.id]));
  };

  const clubIds = await buildMap("clubs");
  const categoryIds = await buildMap("categories");
  // Only needed when no single specialty was requested; resolve per row by name.
  const specialtyIds = sharedSpecialty ? null : await buildMap("specialties");

  const insertResult = db.prepare(
    `INSERT OR IGNORE INTO results (
      competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id,
      scores, phase,
      club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
      club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const statements: D1PreparedStatement[] = [];
  // Distinct specialties/categories that actually receive a result row, so the
  // matching `enabled` flags can be flipped in the same batch below.
  const usedSpecialtyIds = new Set<number>();
  const usedCategoryIds = new Set<number>();
  for (const res of results) {
    const specialtyId = sharedSpecialty?.id ?? specialtyIds?.get(res.specialty);
    const clubAId = clubIds.get(baseClubName(res.club_a));
    const clubBId = clubIds.get(baseClubName(res.club_b));
    const categoryId = categoryIds.get(res.category);

    if (!specialtyId || !clubAId || !clubBId || !categoryId) {
      console.warn(
        `[saveResults] Skipping result: missing lookup for specialty='${res.specialty}' category='${res.category}' club_a='${res.club_a}' club_b='${res.club_b}'`
      );
      continue;
    }

    usedSpecialtyIds.add(specialtyId);
    usedCategoryIds.add(categoryId);
    statements.push(
      insertResult.bind(
        competition.id, specialtyId, categoryId, res.date_match,
        clubAId, clubBId, res.scores ?? null, res.phase,
        res.club_a_player1_name ?? null, res.club_a_player1_number ?? null,
        res.club_a_player2_name ?? null, res.club_a_player2_number ?? null,
        res.club_b_player1_name ?? null, res.club_b_player1_number ?? null,
        res.club_b_player2_name ?? null, res.club_b_player2_number ?? null
      )
    );
  }

  if (statements.length === 0) return 0;

  // Saving results marks the competition, and every specialty and category
  // that received a row, as enabled: the `enabled` flags are opt-in (default 0)
  // and a lookup row that has results is, by definition, one we want exposed.
  // Runs in the same batch (same transaction) as the inserts so no flag flips
  // without the rows landing too.
  const enableCompetition = db
    .prepare("UPDATE competitions SET enabled = 1 WHERE id = ? AND enabled = 0")
    .bind(competition.id);
  const enableWhereIdIn = (table: string, ids: Set<number>): D1PreparedStatement => {
    const placeholders = [...ids].map(() => "?").join(", ");
    return db
      .prepare(`UPDATE ${table} SET enabled = 1 WHERE id IN (${placeholders}) AND enabled = 0`)
      .bind(...ids);
  };
  const enableFlags = [
    enableCompetition,
    enableWhereIdIn("specialties", usedSpecialtyIds),
    enableWhereIdIn("categories", usedCategoryIds),
  ];

  // One subrequest for the whole batch; INSERT OR IGNORE reports changes=0 for
  // rows that already existed, so meta.changes sums to the newly inserted count.
  // The trailing UPDATEs are excluded from that sum.
  const batchResults = await db.batch([...statements, ...enableFlags]);
  return batchResults
    .slice(0, statements.length)
    .reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
}

export async function scrapeResults(
  env: Env,
  options: ScraperOptions,
  dryRun: boolean
): Promise<{ results: ScrapedResult[]; saved: number }> {
  const scraper = scrapers[options.league.toLowerCase()];
  if (!scraper) throw new Error(`Unsupported league: ${options.league}`);

  // Always resolve DB IDs → source_ids before hitting the external website.
  const db = getDatabase(env, options.league);
  const resolved = await resolveSourceIds(db, options);

  const { results: scraped } = await scraper.fetchData(resolved, true);

  // The upstream site filters results by competition only — it ignores the
  // posted specialty/category and returns the competition's default block.
  // Keep only rows whose own (parsed) specialty and category match the ones
  // that were requested, so an unrelated block does not get mislabelled and
  // stored under the wrong specialty/category. Comparison is accent- and
  // punctuation-insensitive to tolerate small label differences.
  const results = await filterByRequested(db, options, scraped);

  if (dryRun) {
    return { results, saved: 0 };
  }

  const saved = await saveResults(db, resolved, results);
  return { results, saved };
}

/** Normalise a label for loose matching: lowercase, strip accents and any
 *  non-alphanumeric characters. */
function normaliseLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Drop scraped rows whose specialty/category do not match the requested ones.
 *  Filtering is skipped for a dimension when it was not specified ("0"). */
async function filterByRequested(
  db: D1Database,
  options: ScraperOptions,
  results: ScrapedResult[]
): Promise<ScrapedResult[]> {
  const nameOf = async (table: string, id: string): Promise<string | null> => {
    if (!id || id === "0") return null;
    const row = await db
      .prepare(`SELECT name FROM ${table} WHERE id = ?`)
      .bind(id)
      .first<{ name: string }>();
    return row?.name ?? null;
  };

  const specName = await nameOf("specialties", options.specialty);
  const catName = await nameOf("categories", options.category);
  if (!specName && !catName) return results;

  const wantSpec = specName ? normaliseLabel(specName) : null;
  const wantCat = catName ? normaliseLabel(catName) : null;

  return results.filter(
    (r) =>
      (!wantSpec || normaliseLabel(r.specialty) === wantSpec) &&
      (!wantCat || normaliseLabel(r.category) === wantCat)
  );
}
