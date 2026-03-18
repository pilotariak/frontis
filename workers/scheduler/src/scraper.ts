import type { Env, ScrapedResult } from "./types";
import { LcapbScraper } from "./leagues/lcapb";
import { LidfpbScraper } from "./leagues/lidfpb";
import type { LeagueScraper, ScrapeOptions } from "./leagues/types";

export interface ScraperOptions extends ScrapeOptions {
  league: string;
}

const scrapers: Record<string, LeagueScraper> = {
  lcapb: new LcapbScraper(),
  lidfpb: new LidfpbScraper(),
};

export async function fetchData(options: ScraperOptions): Promise<ScrapedResult[]> {
  const scraper = scrapers[options.league.toLowerCase()];
  if (!scraper) {
    throw new Error(`Unsupported league: ${options.league}`);
  }
  return scraper.fetchData(options);
}

export async function saveData(db: D1Database, results: ScrapedResult[]): Promise<number> {
  for (const res of results) {
    // 1. Ensure specialty exists
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

    // 2. Ensure clubs exist
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

    // 3. Ensure competition exists
    let competition = await db
      .prepare("SELECT id FROM competitions WHERE year = ? AND name = ? AND level = ?")
      .bind(res.year, res.competition, "Trinquet")
      .first<{ id: number }>();

    if (!competition) {
      await db
        .prepare("INSERT INTO competitions (year, name, level) VALUES (?, ?, ?)")
        .bind(res.year, res.competition, "Trinquet")
        .run();
      competition = await db
        .prepare("SELECT id FROM competitions WHERE year = ? AND name = ? AND level = ?")
        .bind(res.year, res.competition, "Trinquet")
        .first<{ id: number }>();
    }

    if (specialty && clubA && clubB && competition) {
      // 4. Insert result only if it doesn't already exist
      const existingResult = await db
        .prepare(
          `SELECT id FROM results
           WHERE competition_id = ? AND specialty_id = ? AND category = ?
           AND date_match = ? AND club_a_id = ? AND club_b_id = ? AND phase = ?`
        )
        .bind(competition.id, specialty.id, res.category, res.date_match, clubA.id, clubB.id, res.phase)
        .first<{ id: number }>();

      if (!existingResult) {
        await db
          .prepare(
            `INSERT INTO results (
              competition_id, specialty_id, category, date_match, club_a_id, club_b_id,
              score_a, score_b, phase,
              club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
              club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            competition.id,
            specialty.id,
            res.category,
            res.date_match,
            clubA.id,
            clubB.id,
            res.score_a,
            res.score_b,
            res.phase,
            res.club_a_player1_name ?? null,
            res.club_a_player1_number ?? null,
            res.club_a_player2_name ?? null,
            res.club_a_player2_number ?? null,
            res.club_b_player1_name ?? null,
            res.club_b_player1_number ?? null,
            res.club_b_player2_name ?? null,
            res.club_b_player2_number ?? null
          )
          .run();
      }
    }
  }

  return results.length;
}

function getDatabase(env: Env, league: string): D1Database {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as keyof Env;
  const db = env[key];
  if (!db) {
    throw new Error(`Database binding for league '${league}' not found.`);
  }
  return db;
}

export async function scrapeAndSave(
  env: Env,
  options: ScraperOptions,
  dryRun = false
): Promise<number> {
  const results = await fetchData(options);
  if (dryRun) {
    console.log(`[dry-run][${options.league}] Would save ${results.length} results:`);
    for (const r of results) {
      console.log(
        `[dry-run]  ${r.date_match} | ${r.competition} | ${r.specialty} | ${r.category} | phase=${r.phase} | ${r.club_a} vs ${r.club_b} (${r.score_a ?? "?"}-${r.score_b ?? "?"})`
      );
    }
    return results.length;
  }
  const db = getDatabase(env, options.league);
  return saveData(db, results);
}
