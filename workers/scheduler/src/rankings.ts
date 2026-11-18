import { getDatabase, scrapers } from "./scraper";
import type { Env } from "./types";
import type { RankingPage, ScrapedRanking } from "./leagues/types";

/** Same arguments as /scrape_results: DB ids, "0" for every one. */
export interface RankingOptions {
  league: string;
  competition: string;
  specialty: string;
  category: string;
}

export interface RankingPageSummary {
  specialty: string;
  category: string;
  teams: ScrapedRanking[];
  /** Why the page was not written, when it was not. */
  skipped?: string;
}

export interface RankingSummary {
  competition: string;
  pages: RankingPageSummary[];
  /** Teams read across every page. */
  found: number;
  /** Teams written; 0 on a dry run. */
  saved: number;
}

/**
 * Upper-case, accent- and punctuation-free form of a player name, stored as
 * `ranking_players.name_key` for the rankings subgraph's name search. The
 * subgraph normalises the searched text the same way.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

async function sourceIdOf(db: D1Database, table: string, id: string, label: string): Promise<string> {
  if (!id || id === "0") return "0";
  const row = await db
    .prepare(`SELECT source_id FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ source_id: string | null }>();
  if (!row?.source_id) {
    throw new Error(`${label} with id '${id}' not found in database. Run /scrape_infos first.`);
  }
  return row.source_id;
}

/** source_id → id for the given source_ids; the oldest row wins a duplicate. */
async function idsBySourceId(db: D1Database, table: string, sourceIds: string[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const distinct = [...new Set(sourceIds)];
  if (distinct.length === 0) return ids;
  const { results } = await db
    .prepare(`SELECT id, source_id FROM ${table} WHERE source_id IN (${distinct.map(() => "?").join(", ")}) ORDER BY id`)
    .bind(...distinct)
    .all<{ id: number; source_id: string }>();
  for (const r of results) if (!ids.has(r.source_id)) ids.set(r.source_id, r.id);
  return ids;
}

/**
 * Club ids for the clubs of the given rankings: by source_id (`no_club`), then
 * by name. Clubs found by neither are inserted first, as saveResults does, so
 * no team is dropped for a club /scrape_infos never listed.
 */
async function resolveClubs(db: D1Database, pages: RankingPage[]): Promise<(row: ScrapedRanking) => number | undefined> {
  const load = async () => {
    const { results } = await db
      .prepare("SELECT id, source_id, name FROM clubs ORDER BY id")
      .all<{ id: number; source_id: string | null; name: string }>();
    const bySource = new Map<string, number>();
    const byName = new Map<string, number>();
    for (const c of results) {
      if (c.source_id && !bySource.has(c.source_id)) bySource.set(c.source_id, c.id);
      byName.set(c.name, c.id);
    }
    return (row: ScrapedRanking) => bySource.get(row.clubSourceId) ?? byName.get(row.club);
  };

  let lookup = await load();
  const missing = new Map<string, string>();
  for (const page of pages) {
    for (const row of page.rows) {
      if (lookup(row) === undefined) missing.set(row.clubSourceId, row.club);
    }
  }
  if (missing.size > 0) {
    const insert = db.prepare("INSERT OR IGNORE INTO clubs (source_id, name) VALUES (?, ?)");
    await db.batch([...missing].map(([sourceId, name]) => insert.bind(sourceId, name)));
    lookup = await load();
  }
  return lookup;
}

/**
 * Scrape the end-of-championship rankings of a competition and replace them in
 * D1.
 *
 * A ranking changes while its championship runs, so each fetched
 * (specialty, category) ranking replaces the stored one: its rows and players
 * are deleted and inserted again. Every page goes into one db.batch(), which
 * D1 runs as one transaction. A page that lists no team is left untouched, so
 * a page the site fails to render never wipes a stored ranking.
 */
export async function scrapeRankings(env: Env, options: RankingOptions, dryRun: boolean): Promise<RankingSummary> {
  const scraper = scrapers[options.league.toLowerCase()];
  if (!scraper) throw new Error(`Unsupported league: ${options.league}`);

  const db = getDatabase(env, options.league);
  const competition = await db
    .prepare("SELECT id, source_id, name FROM competitions WHERE id = ?")
    .bind(options.competition)
    .first<{ id: number; source_id: string | null; name: string }>();
  if (!competition?.source_id) {
    throw new Error(`Competition with id '${options.competition}' not found in database. Run /scrape_infos first.`);
  }
  const specialty = await sourceIdOf(db, "specialties", options.specialty, "Specialty");
  const category = await sourceIdOf(db, "categories", options.category, "Category");

  const pages = await scraper.fetchRankings(competition.source_id, specialty, category);

  const specialtyIds = await idsBySourceId(db, "specialties", pages.map((p) => p.specialty.sourceId));
  const categoryIds = await idsBySourceId(db, "categories", pages.map((p) => p.category.sourceId));

  const summaries: RankingPageSummary[] = [];
  const toSave: { page: RankingPage; specialtyId: number; categoryId: number }[] = [];
  for (const page of pages) {
    const summary: RankingPageSummary = {
      specialty: page.specialty.name,
      category: page.category.name,
      teams: page.rows,
    };
    const specialtyId = specialtyIds.get(page.specialty.sourceId);
    const categoryId = categoryIds.get(page.category.sourceId);
    if (page.rows.length === 0) {
      summary.skipped = "no ranking";
    } else if (specialtyId === undefined || categoryId === undefined) {
      const unknown = specialtyId === undefined
        ? `specialty source_id ${page.specialty.sourceId}`
        : `category source_id ${page.category.sourceId}`;
      summary.skipped = `${unknown} not in database; run /scrape_infos for competition ${competition.source_id}`;
    } else {
      toSave.push({ page, specialtyId, categoryId });
    }
    summaries.push(summary);
  }

  const found = pages.reduce((n, p) => n + p.rows.length, 0);
  if (dryRun || toSave.length === 0) {
    return { competition: competition.name, pages: summaries, found, saved: 0 };
  }

  const clubIdOf = await resolveClubs(db, toSave.map((s) => s.page));

  const deletePlayers = db.prepare(
    `DELETE FROM ranking_players WHERE ranking_id IN (
       SELECT id FROM rankings WHERE competition_id = ? AND specialty_id = ? AND category_id = ?)`
  );
  const deleteRankings = db.prepare(
    "DELETE FROM rankings WHERE competition_id = ? AND specialty_id = ? AND category_id = ?"
  );
  const insertRanking = db.prepare(
    `INSERT INTO rankings (competition_id, specialty_id, category_id, club_id, team_number, rank, phase)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // The ranking id comes from the row inserted just before, found through its
  // UNIQUE key: a batch cannot carry ids from one statement to the next.
  const insertPlayer = db.prepare(
    `INSERT INTO ranking_players (ranking_id, position, licence, name, name_key, licence_club, marker)
     VALUES ((SELECT id FROM rankings
              WHERE competition_id = ? AND specialty_id = ? AND category_id = ? AND club_id = ? AND team_number = ?),
             ?, ?, ?, ?, ?, ?)`
  );

  const statements: D1PreparedStatement[] = [];
  let saved = 0;
  for (const { page, specialtyId, categoryId } of toSave) {
    const key = [competition.id, specialtyId, categoryId] as const;
    statements.push(deletePlayers.bind(...key), deleteRankings.bind(...key));

    const seen = new Set<string>();
    for (const row of page.rows) {
      const clubId = clubIdOf(row);
      // A team listed twice would break the UNIQUE key and fail the whole batch.
      if (clubId === undefined || seen.has(`${clubId}:${row.teamNumber}`)) {
        console.warn(`[scrapeRankings] Skipping team '${row.club}' ${row.teamNumber} (rank ${row.rank})`);
        continue;
      }
      seen.add(`${clubId}:${row.teamNumber}`);
      statements.push(insertRanking.bind(...key, clubId, row.teamNumber, row.rank, row.phase));
      row.players.forEach((p, i) => {
        statements.push(
          insertPlayer.bind(
            ...key, clubId, row.teamNumber,
            i + 1, p.licence, p.name ?? null, p.name ? nameKey(p.name) : null, p.licenceClub ?? null, p.marker ?? null
          )
        );
      });
      saved++;
    }
  }

  await db.batch(statements);
  return { competition: competition.name, pages: summaries, found, saved };
}
