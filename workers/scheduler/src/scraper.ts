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

function getDatabase(env: Env, league: string): D1Database {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as keyof Env;
  const db = env[key];
  if (!db) {
    throw new Error(`Database binding for league '${league}' not found.`);
  }
  return db;
}

// ── /scrape_infos ─────────────────────────────────────────────────────────────

async function saveFormOptions(db: D1Database, options: FormOptions): Promise<void> {
  for (const s of options.specialties) {
    await db
      .prepare(
        `INSERT INTO specialties (source_id, name) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id`
      )
      .bind(s.sourceId, s.name)
      .run();
  }

  for (const c of options.clubs) {
    await db
      .prepare(
        `INSERT INTO clubs (source_id, name) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id`
      )
      .bind(c.sourceId, c.name)
      .run();
  }

  for (const c of options.categories) {
    await db
      .prepare(
        `INSERT INTO categories (source_id, name) VALUES (?, ?)
         ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`
      )
      .bind(c.sourceId, c.name)
      .run();
  }

  for (const p of options.phases) {
    await db
      .prepare(
        `INSERT INTO phases (source_id, name) VALUES (?, ?)
         ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`
      )
      .bind(p.sourceId, p.name)
      .run();
  }

  for (const c of options.competitions) {
    await db
      .prepare(
        `INSERT INTO competitions (source_id, name) VALUES (?, ?)
         ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`
      )
      .bind(c.sourceId, c.name)
      .run();
  }
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
 *   3. one db.batch() of INSERT OR IGNORE statements for the results.
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

  // One subrequest for the whole batch; INSERT OR IGNORE reports changes=0 for
  // rows that already existed, so meta.changes sums to the newly inserted count.
  const batchResults = await db.batch(statements);
  return batchResults.reduce((sum, r) => sum + (r.meta.changes ?? 0), 0);
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

  const { results } = await scraper.fetchData(resolved, true);

  if (dryRun) {
    return { results, saved: 0 };
  }

  const saved = await saveResults(db, resolved, results);
  return { results, saved };
}
