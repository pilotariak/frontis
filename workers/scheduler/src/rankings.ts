import { getDatabase, scrapers } from "./scraper";
import type { Env } from "./types";
import type { RankingPage, ScrapedRanking } from "./leagues/types";
import { BadRequestError, checkIds, idsBySourceId, lookup, pick } from "./params";
import { nameKey } from "./players";

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
 * Most ranking pages one call may fetch. The site has no "every category"
 * ranking (it answers "Vous devez choisir une catégorie"), so a call fetches
 * one page per specialty × category pair, and each page is one subrequest out
 * of the 50 a Free plan invocation gets, which also cover the form GET, the
 * CTPB session warm-up and the D1 queries. CTPB offers about 20 specialties and
 * 10 categories per competition: those calls must name a specialty.
 */
export const MAX_RANKING_PAGES = 35;

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
  if (!scraper) throw new BadRequestError(`Unsupported league: ${options.league}`);

  checkIds({ competition: options.competition, specialty: options.specialty, category: options.category });

  const db = getDatabase(env, options.league);
  const competition = (await lookup(db, "competitions", options.competition, "Competition", false))!;
  const specialty = await lookup(db, "specialties", options.specialty, "Specialty", true);
  const category = await lookup(db, "categories", options.category, "Category", true);

  const source = await scraper.openRankings(competition.source_id);
  const label = `competition ${competition.id} (${competition.name})`;
  if (!source.listed) {
    // The site would answer with its default competition's rankings instead.
    throw new BadRequestError(`The league site lists no ranking for ${label}`);
  }
  const specialties = await pick(db, "specialties", source.specialties, specialty, "Specialty", label);
  const categories = await pick(db, "categories", source.categories, category, "Category", label);

  const count = specialties.length * categories.length;
  if (count > MAX_RANKING_PAGES) {
    throw new BadRequestError(
      `${count} rankings (${specialties.length} specialties × ${categories.length} categories) exceed the ` +
        `${MAX_RANKING_PAGES} pages one call may fetch; pass a specialty`
    );
  }

  const pages: RankingPage[] = [];
  for (const s of specialties) {
    for (const c of categories) {
      pages.push({ specialty: s, category: c, rows: await source.fetch(s.sourceId, c.sourceId) });
    }
  }

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
