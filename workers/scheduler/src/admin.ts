import { renderAdminPage } from "./admin-page";
import type { FormOption } from "./leagues/types";
import { logRouteError } from "./log";
import { BadRequestError, checkIds, idsBySourceId, lookup } from "./params";
import { getDatabase, scrapers } from "./scraper";
import type { Env } from "./types";

/**
 * Admin page for /scrape_results and /scrape_rankings: pick a league, a
 * competition, a specialty and a category from menus instead of typing ids.
 * It also bootstraps a league, as setup-league's /init and /bootstrap do: it
 * writes the league's row, then runs /scrape_infos to load the menus' values.
 * The league must already be wired in code (a scraper and a D1 binding).
 *
 * It is served by the scheduler itself, so it sits behind the same Cloudflare
 * Access application as the scrape routes, and its requests carry the Access
 * cookie without CORS. The page runs the scrapes through the existing routes.
 */

export type AdminScript = "results" | "rankings";

/** An offered choice, with a null id when /scrape_infos never stored it. */
export interface AdminOption {
  id: number | null;
  name: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

/** Leagues the scheduler can scrape: a league scraper and a D1 binding. */
export function adminLeagues(env: Env): string[] {
  return Object.keys(scrapers).filter((league) => `DB_LEAGUE_${league.toUpperCase()}` in env);
}

function checkLeague(env: Env, league: string | null): string {
  if (!league) throw new BadRequestError("missing required parameter: league");
  if (!adminLeagues(env).includes(league)) throw new BadRequestError(`Unsupported league: ${league}`);
  return league;
}

/**
 * Competitions the scrape routes accept (those with a source_id), newest season
 * first. /scrape_infos takes the source_id, the other scrape routes the id.
 */
async function listCompetitions(env: Env, league: string) {
  const { results } = await getDatabase(env, league)
    .prepare(
      `SELECT id, source_id, name, enabled FROM competitions
       WHERE source_id IS NOT NULL
       ORDER BY source_id DESC`
    )
    .all<{ id: number; source_id: string; name: string; enabled: number }>();
  return results.map((c) => ({ id: c.id, source_id: c.source_id, name: c.name, enabled: c.enabled === 1 }));
}

/**
 * The league's row in `leagues`, which setup-league's /init writes. The URL is
 * the scraper's own, so the row names the site the scheduler actually reads.
 */
async function readLeague(env: Env, league: string) {
  const row = await getDatabase(env, league)
    .prepare("SELECT name FROM leagues WHERE acronym = ?")
    .bind(league)
    .first<{ name: string }>();
  return { acronym: league, url: scrapers[league]!.baseUrl, name: row?.name ?? null };
}

async function registerLeague(env: Env, league: string, req: Request) {
  const input = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name) throw new BadRequestError("missing required parameter: name");

  const url = scrapers[league]!.baseUrl;
  await getDatabase(env, league)
    .prepare(
      `INSERT INTO leagues (name, acronym, url) VALUES (?, ?, ?)
       ON CONFLICT(acronym) DO UPDATE SET name = excluded.name, url = excluded.url`
    )
    .bind(name, league, url)
    .run();
  return { acronym: league, url, name };
}

/**
 * The specialties and categories the league site offers for a competition, as
 * database ids. Results and rankings are two pages of the site, which can offer
 * different sets, so the script picks the form to read.
 */
async function listOffered(env: Env, league: string, competitionId: string, script: AdminScript) {
  checkIds({ competition: competitionId });
  const db = getDatabase(env, league);
  const competition = (await lookup(db, "competitions", competitionId, "Competition", false))!;
  const scraper = scrapers[league]!;

  let listed: boolean;
  let specialties: FormOption[];
  let categories: FormOption[];
  if (script === "results") {
    const form = await scraper.fetchResultsForm(competition.source_id);
    listed = form.competitions.some((o) => o.sourceId === competition.source_id);
    ({ specialties, categories } = form);
  } else {
    ({ listed, specialties, categories } = await scraper.openRankings(competition.source_id));
  }
  if (!listed) {
    throw new BadRequestError(`The league site lists no ${script} for competition ${competition.id} (${competition.name})`);
  }

  const withIds = async (table: string, offered: FormOption[]): Promise<AdminOption[]> => {
    const ids = await idsBySourceId(db, table, offered.map((o) => o.sourceId));
    return offered.map((o) => ({ id: ids.get(o.sourceId) ?? null, name: o.name }));
  };
  return {
    specialties: await withIds("specialties", specialties),
    categories: await withIds("categories", categories),
  };
}

/** Answer an /admin route, or null when the path is not one. */
export async function handleAdmin(req: Request, url: URL, env: Env, version: string): Promise<Response | null> {
  if (url.pathname === "/admin" || url.pathname === "/admin/") {
    return new Response(renderAdminPage(adminLeagues(env), version), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (!["/admin/competitions", "/admin/options", "/admin/league"].includes(url.pathname)) return null;

  const started = Date.now();
  try {
    const league = checkLeague(env, url.searchParams.get("league"));
    if (url.pathname === "/admin/competitions") {
      return Response.json({ competitions: await listCompetitions(env, league) });
    }
    if (url.pathname === "/admin/league") {
      return Response.json(req.method === "POST" ? await registerLeague(env, league, req) : await readLeague(env, league));
    }

    const competition = url.searchParams.get("competition");
    if (!competition) throw new BadRequestError("missing required parameter: competition");
    const script = url.searchParams.get("script");
    if (script !== "results" && script !== "rankings") {
      throw new BadRequestError(`Invalid script: '${script ?? ""}' (results or rankings)`);
    }
    return Response.json(await listOffered(env, league, competition, script));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof BadRequestError ? 400 : 500;
    logRouteError(url, started, status, err);
    return new Response(JSON.stringify({ error: msg }), { status, headers: JSON_HEADERS });
  }
}
