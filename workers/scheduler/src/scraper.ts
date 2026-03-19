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

async function saveResults(db: D1Database, results: ScrapedResult[]): Promise<number> {
  for (const res of results) {
    let specialty = await db
      .prepare("SELECT id FROM specialties WHERE name = ?")
      .bind(res.specialty)
      .first<{ id: number }>();

    if (!specialty) {
      await db.prepare("INSERT INTO specialties (name) VALUES (?)").bind(res.specialty).run();
      specialty = await db
        .prepare("SELECT id FROM specialties WHERE name = ?")
        .bind(res.specialty)
        .first<{ id: number }>();
    }

    let clubA = await db
      .prepare("SELECT id FROM clubs WHERE name = ?")
      .bind(res.club_a)
      .first<{ id: number }>();

    if (!clubA) {
      await db.prepare("INSERT INTO clubs (name) VALUES (?)").bind(res.club_a).run();
      clubA = await db
        .prepare("SELECT id FROM clubs WHERE name = ?")
        .bind(res.club_a)
        .first<{ id: number }>();
    }

    let clubB = await db
      .prepare("SELECT id FROM clubs WHERE name = ?")
      .bind(res.club_b)
      .first<{ id: number }>();

    if (!clubB) {
      await db.prepare("INSERT INTO clubs (name) VALUES (?)").bind(res.club_b).run();
      clubB = await db
        .prepare("SELECT id FROM clubs WHERE name = ?")
        .bind(res.club_b)
        .first<{ id: number }>();
    }

    let competition = await db
      .prepare("SELECT id FROM competitions WHERE name = ?")
      .bind(res.competition)
      .first<{ id: number }>();

    if (!competition) {
      await db
        .prepare("INSERT INTO competitions (name) VALUES (?)")
        .bind(res.competition)
        .run();
      competition = await db
        .prepare("SELECT id FROM competitions WHERE name = ?")
        .bind(res.competition)
        .first<{ id: number }>();
    }

    if (specialty && clubA && clubB && competition) {
      const existing = await db
        .prepare(
          `SELECT id FROM results
           WHERE competition_id = ? AND specialty_id = ? AND category = ?
           AND date_match = ? AND club_a_id = ? AND club_b_id = ? AND phase = ?`
        )
        .bind(competition.id, specialty.id, res.category, res.date_match, clubA.id, clubB.id, res.phase)
        .first<{ id: number }>();

      if (!existing) {
        await db
          .prepare(
            `INSERT INTO results (
              competition_id, specialty_id, category, date_match, club_a_id, club_b_id,
              score_a, score_b, phase,
              club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
              club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            competition.id, specialty.id, res.category, res.date_match,
            clubA.id, clubB.id, res.score_a, res.score_b, res.phase,
            res.club_a_player1_name ?? null, res.club_a_player1_number ?? null,
            res.club_a_player2_name ?? null, res.club_a_player2_number ?? null,
            res.club_b_player1_name ?? null, res.club_b_player1_number ?? null,
            res.club_b_player2_name ?? null, res.club_b_player2_number ?? null
          )
          .run();
      }
    }
  }

  return results.length;
}

export async function scrapeResults(
  env: Env,
  options: ScraperOptions,
  dryRun: boolean
): Promise<{ results: ScrapedResult[]; saved: number }> {
  const scraper = scrapers[options.league.toLowerCase()];
  if (!scraper) throw new Error(`Unsupported league: ${options.league}`);

  const { results } = await scraper.fetchData(options, true);

  if (dryRun) {
    return { results, saved: 0 };
  }

  const db = getDatabase(env, options.league);
  const saved = await saveResults(db, results);
  return { results, saved };
}
