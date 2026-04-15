import type { Env, ScrapedResult } from "./types";
import { LcapbScraper } from "./leagues/lcapb";
import { LidfpbScraper } from "./leagues/lidfpb";
import type { FormOptions, LeagueScraper, ScrapeOptions } from "./leagues/types";

export interface ScraperOptions extends ScrapeOptions {
  league: string;
}

const scrapers: Record<string, LeagueScraper> = {
  lcapb: new LcapbScraper(),
  lidfpb: new LidfpbScraper(),
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

async function saveResults(db: D1Database, options: ScraperOptions, results: ScrapedResult[]): Promise<number> {
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

  let saved = 0;

  for (const res of results) {
    const specialty = sharedSpecialty ?? await db
      .prepare("SELECT id FROM specialties WHERE name = ?")
      .bind(res.specialty)
      .first<{ id: number }>();

    const clubA = await db
      .prepare("SELECT id FROM clubs WHERE name = ?")
      .bind(baseClubName(res.club_a))
      .first<{ id: number }>();

    const clubB = await db
      .prepare("SELECT id FROM clubs WHERE name = ?")
      .bind(baseClubName(res.club_b))
      .first<{ id: number }>();

    if (!specialty || !clubA || !clubB) {
      console.warn(`[saveResults] Skipping result: missing lookup for specialty='${res.specialty}' club_a='${res.club_a}' club_b='${res.club_b}'`);
      continue;
    }

    // Resolve category name → id, creating the row if it does not exist yet.
    await db
      .prepare(`INSERT OR IGNORE INTO categories (name) VALUES (?)`)
      .bind(res.category)
      .run();
    const category = await db
      .prepare("SELECT id FROM categories WHERE name = ?")
      .bind(res.category)
      .first<{ id: number }>();

    if (!category) {
      console.warn(`[saveResults] Skipping result: could not resolve category='${res.category}'`);
      continue;
    }

    const existing = await db
      .prepare(
        `SELECT id FROM results
         WHERE competition_id = ? AND specialty_id = ? AND category_id = ?
         AND date_match = ? AND club_a_id = ? AND club_b_id = ? AND phase = ?`
      )
      .bind(competition.id, specialty.id, category.id, res.date_match, clubA.id, clubB.id, res.phase)
      .first<{ id: number }>();

    if (!existing) {
      await db
        .prepare(
          `INSERT INTO results (
            competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id,
            score_a, score_b, phase,
            club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
            club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          competition.id, specialty.id, category.id, res.date_match,
          clubA.id, clubB.id, res.score_a, res.score_b, res.phase,
          res.club_a_player1_name ?? null, res.club_a_player1_number ?? null,
          res.club_a_player2_name ?? null, res.club_a_player2_number ?? null,
          res.club_b_player1_name ?? null, res.club_b_player1_number ?? null,
          res.club_b_player2_name ?? null, res.club_b_player2_number ?? null
        )
        .run();
      saved++;
    }
  }

  return saved;
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
