// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { scrapeFormOptions } from "./scraper";
import type { Env, FormOption, League } from "./types";

const TEXT = { headers: { "Content-Type": "text/plain; charset=utf-8" } };

function makeColors(noColor: boolean) {
  const a = (code: string) => (s: string) => noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
  return {
    bold:    a("1"),
    dim:     a("2"),
    cyan:    a("36"),
    yellow:  a("33"),
    green:   a("32"),
    red:     a("31"),
    gray:    a("90"),
  };
}

function getDatabase(env: Env, acronym: string): D1Database {
  const key = `DB_LEAGUE_${acronym.toUpperCase()}` as keyof Env;
  const db = env[key];
  if (!db) throw new Error(`No database binding for league '${acronym}'.`);
  return db;
}

async function saveFormOptions(db: D1Database, options: ReturnType<typeof scrapeFormOptions> extends Promise<infer T> ? T : never): Promise<void> {
  for (const c of options.competitions) {
    await db
      .prepare(`INSERT INTO competitions (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`)
      .bind(c.sourceId, c.name)
      .run();
  }
  for (const s of options.specialties) {
    await db
      .prepare(`INSERT INTO specialties (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id`)
      .bind(s.sourceId, s.name)
      .run();
  }
  for (const c of options.categories) {
    await db
      .prepare(`INSERT INTO categories (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name`)
      .bind(c.sourceId, c.name)
      .run();
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url     = new URL(req.url);
    const acronym             = url.searchParams.get("acronym");
    const competitionSourceId = url.searchParams.get("competition_source_id") ?? undefined;
    const dryRun              = url.searchParams.get("dry_run") !== "false";
    const noColor             = url.searchParams.get("no_color") === "true";
    const { bold, dim, cyan, yellow, green, red, gray } = makeColors(noColor);

    if (!acronym) {
      return new Response(`${red("Error: missing required parameter: acronym")}`, { status: 400, ...TEXT });
    }

    let db: D1Database;
    try {
      db = getDatabase(env, acronym);
    } catch (err: unknown) {
      return new Response(`${red(`Error: ${err instanceof Error ? err.message : String(err)}`)}`, { status: 400, ...TEXT });
    }

    // ── Look up league in database ────────────────────────────────────────────
    const league = await db
      .prepare("SELECT id, name, acronym, url FROM leagues WHERE acronym = ?")
      .bind(acronym)
      .first<League>();

    if (!league) {
      return new Response(`${red(`Error: league '${acronym}' not found in database.`)}`, { status: 404, ...TEXT });
    }

    // ── Scrape form options from league URL ───────────────────────────────────
    let options: Awaited<ReturnType<typeof scrapeFormOptions>>;
    try {
      options = await scrapeFormOptions(league.url, competitionSourceId);
    } catch (err: unknown) {
      return new Response(`${red(`Error: ${err instanceof Error ? err.message : String(err)}`)}`, { status: 500, ...TEXT });
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
        return new Response(`${red(`Error saving to database: ${err instanceof Error ? err.message : String(err)}`)}`, { status: 500, ...TEXT });
      }
    }

    return new Response(lines.join("\n") + "\n", TEXT);
  },
} satisfies ExportedHandler<Env>;
