// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { errorFields, log } from "./log";
import { scrapeFormOptions } from "./scraper";
import type { Env, FormOption, FormOptions, League } from "./types";
import { version } from "../../../package.json";

const TEXT = { headers: { "Content-Type": "text/plain; charset=utf-8" } };
const JSON_HEADERS = { "Content-Type": "application/json" };

/** The route and the parameters a request named, for its log lines. */
interface RouteContext {
  route: string;
  league?: string;
  competition?: string;
  dryRun?: string;
  started: number;
}

/**
 * Log an error a route answers, then answer it. `cause` is the error caught,
 * when there is one: a league site failure carries its status and body.
 */
function errorResponse(message: string, status: number, ctx: RouteContext, cause?: unknown): Response {
  const { started, ...fields } = ctx;
  log.error({
    event: "route.error",
    ...fields,
    status,
    durationMs: Date.now() - started,
    ...errorFields(cause ?? message),
    message,
  });
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function makeColors(noColor: boolean) {
  const a = (code: string) => (s: string) => noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
  return {
    bold:    a("1"),
    dim:     a("2"),
    cyan:    a("36"),
    yellow:  a("33"),
    green:   a("32"),
    gray:    a("90"),
  };
}

function getDatabase(env: Env, acronym: string): D1Database {
  const key = `DB_LEAGUE_${acronym.toUpperCase()}` as keyof Env;
  const db = env[key];
  if (!db) throw new Error(`No database binding for league '${acronym}'.`);
  return db;
}

/**
 * Upsert every scraped dropdown value into its lookup table in one `db.batch()`:
 * a single D1 subrequest and a single transaction, so a failure midway cannot
 * leave the tables half-updated. Mirrors the scheduler's `saveFormOptions`.
 */
async function saveFormOptions(db: D1Database, options: FormOptions): Promise<void> {
  // Skip a competition whose name another source_id holds: see the scheduler.
  const upsertCompetition = db.prepare(
    `INSERT INTO competitions (source_id, name) VALUES (?, ?)
     ON CONFLICT(source_id) DO UPDATE SET name = excluded.name
       WHERE NOT EXISTS (SELECT 1 FROM competitions WHERE name = excluded.name)
     ON CONFLICT(name) DO NOTHING`
  );
  const upsertSpecialty = db.prepare(
    `INSERT INTO specialties (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id`
  );
  const upsertCategory = db.prepare(
    `INSERT INTO categories (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`
  );

  const statements: D1PreparedStatement[] = [
    ...[...options.competitions]
      .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
      .map((c) => upsertCompetition.bind(c.sourceId, c.name)),
    ...options.specialties.map((s) => upsertSpecialty.bind(s.sourceId, s.name)),
    ...options.categories.map((c) => upsertCategory.bind(c.sourceId, c.name)),
  ];

  if (statements.length > 0) await db.batch(statements);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url     = new URL(req.url);
    const acronym             = req.headers.get("x-pilotariak-league") ?? url.searchParams.get("league");
    const competitionSourceId = url.searchParams.get("competition_source_id") ?? undefined;
    const dryRun              = url.searchParams.get("dry_run") !== "false";
    const noColor             = url.searchParams.get("no_color") === "true";
    const { bold, dim, cyan, yellow, green, gray } = makeColors(noColor);
    const ctx: RouteContext = {
      route: url.pathname,
      league: acronym ?? url.searchParams.get("acronym") ?? undefined,
      competition: competitionSourceId,
      // Only /bootstrap reads dry_run.
      dryRun: url.pathname === "/bootstrap" ? String(dryRun) : undefined,
      started: Date.now(),
    };

    // ── /version ───────────────────────────────────────────────────────────────
    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ version }), { headers: JSON_HEADERS });
    }

    // ── /init ──────────────────────────────────────────────────────────────────
    if (url.pathname === "/init") {
      const name       = url.searchParams.get("name");
      const leagueUrl  = url.searchParams.get("url");
      const leagueAcro = url.searchParams.get("acronym");

      if (!name || !leagueUrl || !leagueAcro) {
        return errorResponse("missing required parameters: name, url, acronym", 400, ctx);
      }

      let db: D1Database;
      try {
        db = getDatabase(env, leagueAcro);
      } catch (err: unknown) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400, ctx, err);
      }

      try {
        await db
          .prepare(`INSERT INTO leagues (name, acronym, url) VALUES (?, ?, ?)
                    ON CONFLICT(acronym) DO UPDATE SET name = excluded.name, url = excluded.url`)
          .bind(name, leagueAcro, leagueUrl)
          .run();
      } catch (err: unknown) {
        return errorResponse(`failed to insert league: ${err instanceof Error ? err.message : String(err)}`, 500, ctx, err);
      }

      return new Response(
        JSON.stringify({ ok: true, league: { name, acronym: leagueAcro, url: leagueUrl } }),
        { headers: JSON_HEADERS }
      );
    }

    // ── /bootstrap ─────────────────────────────────────────────────────────────
    if (url.pathname === "/bootstrap") {
      if (!acronym) {
        return errorResponse("missing required league: set X-Pilotariak-League header or ?league= parameter", 400, ctx);
      }

      let db: D1Database;
      try {
        db = getDatabase(env, acronym);
      } catch (err: unknown) {
        return errorResponse(err instanceof Error ? err.message : String(err), 400, ctx, err);
      }

      const league = await db
        .prepare("SELECT id, name, acronym, url FROM leagues WHERE acronym = ?")
        .bind(acronym)
        .first<League>();

      if (!league) {
        return errorResponse(`league '${acronym}' not found in database — run /init first`, 404, ctx);
      }

      let options: Awaited<ReturnType<typeof scrapeFormOptions>>;
      try {
        options = await scrapeFormOptions(league.url, competitionSourceId);
      } catch (err: unknown) {
        return errorResponse(err instanceof Error ? err.message : String(err), 500, ctx, err);
      }

      const fmt = (items: FormOption[]) =>
        items.length
          ? items.map((o) => `  ${gray(`[${o.sourceId}]`)} ${o.name}`).join("\n")
          : dim("  (none)");

      const status = dryRun
        ? yellow("dry-run — not saved")
        : green("saved to database");

      const lines = [
        `${bold(cyan("League"))}      : ${bold(league.name)} ${dim(`(${league.acronym.toUpperCase()})`)}  ${dim(`[${status}]`)}`,
        `${bold(cyan("URL"))}         : ${league.url}`,
        `${bold(cyan("Competition"))} : ${competitionSourceId ? gray(competitionSourceId) : dim("(all)")}`,
        "",
        bold(yellow(`Competitions (${options.competitions.length})`)),
        fmt(options.competitions),
        "",
        bold(yellow(`Specialties (${options.specialties.length})`)),
        fmt(options.specialties),
        "",
        bold(yellow(`Categories (${options.categories.length})`)),
        fmt(options.categories),
      ];

      if (!dryRun) {
        try {
          await saveFormOptions(db, options);
        } catch (err: unknown) {
          return errorResponse(`failed to save to database: ${err instanceof Error ? err.message : String(err)}`, 500, ctx, err);
        }
      }

      const { started, ...fields } = ctx;
      log.info({
        event: "route.done",
        ...fields,
        status: 200,
        found: options.competitions.length + options.specialties.length + options.categories.length,
        durationMs: Date.now() - started,
        message:
          `${options.competitions.length} competitions, ${options.specialties.length} specialties, ` +
          `${options.categories.length} categories`,
      });
      return new Response(lines.join("\n") + "\n", TEXT);
    }

    // ── help ───────────────────────────────────────────────────────────────────
    const base = url.origin;
    return new Response(
      `${bold(cyan("Frontis Setup League"))}

${bold("/version")}   — return worker version as JSON

${bold("/init")}      — register a new league in the database
  ${gray(`${base}/init?acronym=lcapb&name=Comité+Cote+d'Argent+Pelote+Basque&url=https://lcapb.euskalpilota.fr/resultats.php`)}

${bold("/bootstrap")} — scrape and seed competitions, specialties, categories for a league
  ${gray(`${base}/bootstrap?league=lcapb`)}
  ${gray(`${base}/bootstrap?league=lcapb&competition_source_id=20260501&dry_run=false`)}
`,
      TEXT
    );
  },
} satisfies ExportedHandler<Env>;
