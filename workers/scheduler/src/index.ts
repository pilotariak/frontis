import { requireInternalToken } from "./auth";
import { scrapeInfos, scrapeResults } from "./scraper";
import type { Env } from "./types";
import { version } from "../../../package.json";

function getDatabase(env: Env, league: string): D1Database | null {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as keyof Env;
  return (env[key] as D1Database) ?? null;
}

async function lookupName(db: D1Database, table: string, id: string): Promise<string | null> {
  if (!id || id === "0") return null;
  const row = await db.prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(id).first<{ name: string }>();
  return row?.name ?? null;
}

const TEXT = { headers: { "Content-Type": "text/plain; charset=utf-8" } };

// ANSI colour helpers — returns plain-text identity functions when noColor=true.
function makeColors(noColor: boolean) {
  const a = (code: string) => (s: string) => noColor ? s : `\x1b[${code}m${s}\x1b[0m`;
  return {
    bold:    a("1"),
    dim:     a("2"),
    cyan:    a("36"),
    yellow:  a("33"),
    green:   a("32"),
    red:     a("31"),
    magenta: a("35"),
    gray:    a("90"),
    white:   a("97"),
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const dryRun  = url.searchParams.get("dry_run")  === "true";
    const noColor = url.searchParams.get("no_color") === "true";
    const { bold, dim, cyan, yellow, green, red, magenta, gray, white } = makeColors(noColor);

    // ── /version ───────────────────────────────────────────────────────────────
    // The only unauthenticated endpoint: it reveals nothing beyond the release
    // number and lets monitoring confirm the deployed version.
    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ version }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Everything below scrapes upstream sites and/or writes to D1.
    const denied = requireInternalToken(req, env.INTERNAL_SERVICE_TOKEN);
    if (denied) return denied;

    // ── /scrape_infos ──────────────────────────────────────────────────────────
    if (url.pathname === "/scrape_infos") {
      const league = url.searchParams.get("league");
      if (!league) {
        return new Response(`${red("Error: missing required parameter: league")}`, { status: 400, ...TEXT });
      }

      const competition = url.searchParams.get("competition") ?? "";
      const specialty   = url.searchParams.get("specialty")   ?? "0";
      const category    = url.searchParams.get("category")    ?? "0";
      const phase       = url.searchParams.get("phase")       ?? "0";

      try {
        const fo = await scrapeInfos(env, { league, competition, specialty, category, phase }, dryRun);

        const fmt = (items: { sourceId: string; name: string }[]) =>
          items.length
            ? items.map((o) => `  ${gray(`[${o.sourceId}]`)} ${o.name}`).join("\n")
            : dim("  (none)");

        const status = dryRun
          ? yellow("dry-run — not saved")
          : green("saved to database");

        const lines = [
          `${bold(cyan("League"))} : ${bold(league.toUpperCase())}  ${dim(`[${status}]`)}`,
          "",
          bold(yellow(`Competitions (${fo.competitions.length})`)),
          fmt(fo.competitions),
          "",
          bold(yellow(`Specialties (${fo.specialties.length})`)),
          fmt(fo.specialties),
          "",
          bold(yellow(`Clubs (${fo.clubs.length})`)),
          fmt(fo.clubs),
          "",
          bold(yellow(`Categories (${fo.categories.length})`)),
          fmt(fo.categories),
          "",
          bold(yellow(`Phases (${fo.phases.length})`)),
          fmt(fo.phases),
        ];

        return new Response(lines.join("\n") + "\n", TEXT);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`${red(`Error: ${msg}`)}`, { status: 500, ...TEXT });
      }
    }

    // ── /scrape_results ────────────────────────────────────────────────────────
    if (url.pathname === "/scrape_results") {
      const league      = url.searchParams.get("league");
      const competition = url.searchParams.get("competition");
      const specialty   = url.searchParams.get("specialty");
      const category    = url.searchParams.get("category");
      const phase       = url.searchParams.get("phase")       ?? "0";

      const JSON_HEADERS = { "Content-Type": "application/json" };
      const missing = [
        !league      && "league",
        !competition && "competition",
        !specialty   && "specialty",
        !category    && "category",
      ].filter(Boolean) as string[];

      if (missing.length > 0) {
        return new Response(
          JSON.stringify({ error: `missing required parameters: ${missing.join(", ")}` }),
          { status: 400, headers: JSON_HEADERS }
        );
      }

      try {
        const { results, saved } = await scrapeResults(
          env,
          { league: league!, competition: competition!, specialty: specialty!, category: category!, phase },
          dryRun
        );

        // Compact machine-readable summary. Used by the nightly cron (through the
        // SELF service binding) so the callee spends no CPU on rendering rows or
        // resolving display names.
        if (url.searchParams.get("format") === "json") {
          return new Response(
            JSON.stringify({ league, competition, found: results.length, saved, dry_run: dryRun }),
            { headers: JSON_HEADERS }
          );
        }

        // Tab-separated output for rendering client-side (the script draws the
        // table) or piping into `column -t` / spreadsheets. Always plain (no ANSI).
        if (url.searchParams.get("format") === "tsv") {
          const status = dryRun ? `${results.length} found (dry-run)` : `${saved} saved`;

          // Resolve the id → name for each filter so the header is readable.
          const tdb = getDatabase(env, league!);
          const [cName, sName, catName] = tdb
            ? await Promise.all([
                lookupName(tdb, "competitions", competition!),
                lookupName(tdb, "specialties", specialty!),
                lookupName(tdb, "categories", category!),
              ])
            : [null, null, null];
          const idName = (id: string, name: string | null) =>
            name ? `${id} [${name}]` : id;

          const header =
            `# ${league!.toUpperCase()}  ` +
            `competition=${idName(competition!, cName)}  ` +
            `specialty=${idName(specialty!, sName)}  ` +
            `category=${idName(category!, catName)}  —  ${status}`;

          if (results.length === 0) {
            return new Response(`${header}\n  (no results)\n`, TEXT);
          }

          // A club cell stacks the club name then one line per player. Sub-lines
          // are joined with US (\x1f); the renderer splits them back into rows.
          const US = "\x1f";
          const player = (name?: string, num?: string) =>
            name ? `(${num ?? "-"}) ${name}` : null;
          const clubCell = (
            club: string,
            p1n?: string, p1num?: string,
            p2n?: string, p2num?: string
          ) =>
            [club, player(p1n, p1num), player(p2n, p2num)]
              .filter(Boolean)
              .join(US);

          const rows = [
            ["DATE", "CLUB 1", "CLUB 2", "SCORE", "COMMENTAIRE"].join("\t"),
            ...results.map((r: (typeof results)[number]) =>
              [
                r.date_match ?? "??-??-??",
                clubCell(r.club_a, r.club_a_player1_name, r.club_a_player1_number, r.club_a_player2_name, r.club_a_player2_number),
                clubCell(r.club_b, r.club_b_player1_name, r.club_b_player1_number, r.club_b_player2_name, r.club_b_player2_number),
                r.scores ?? "-/-",
                "",
              ].join("\t")
            ),
          ];

          return new Response(`${header}\n${rows.join("\n")}\n`, TEXT);
        }

        const statusLine = dryRun
          ? `${results.length} results found — ${yellow("not saved (dry-run)")}`
          : `${green(`${saved} results saved`)}`;

        const db = getDatabase(env, league!);
        const [competitionName, specialtyName, categoryName] = db
          ? await Promise.all([
              lookupName(db, "competitions", competition!),
              lookupName(db, "specialties", specialty!),
              lookupName(db, "categories", category!),
            ])
          : [null, null, null];

        const fmtId = (id: string, name: string | null) =>
          name ? `${id} ${dim(`[${name}]`)}` : id;

        const filterParts = [
          `specialty=${fmtId(specialty!, specialtyName)}`,
          `category=${fmtId(category!, categoryName)}`,
          ...(phase !== "0" ? [`phase=${phase}`] : []),
        ];

        const lines = [
          `${bold(cyan("League     "))} : ${bold(league!.toUpperCase())}`,
          `${bold(cyan("Competition"))} : ${fmtId(competition!, competitionName)}`,
          `${bold(cyan("Filters    "))} : ${filterParts.join("  ")}`,
          `${bold(cyan("Status     "))} : ${statusLine}`,
          "",
        ];

        const fmtPlayer = (name?: string, id?: string) =>
          name ? `  ${white(name)}${id ? `  ${gray(`(${id})`)}` : ""}` : null;

        if (results.length === 0) {
          lines.push(dim("  (no results)"));
        } else {
          for (const r of results) {
            const score = r.scores ? green(r.scores) : dim("-/-");

            lines.push(
              "",
              `  ${cyan(r.date_match ?? "??-??-??")}  ${bold(r.club_a.padEnd(32))} ${score}  ${bold(r.club_b)}`,
              `  ${" ".repeat(12)}${dim(r.category)}  ${dim("—")}  ${magenta(r.phase)}`,
            );

            const p1a = fmtPlayer(r.club_a_player1_name, r.club_a_player1_number);
            const p2a = fmtPlayer(r.club_a_player2_name, r.club_a_player2_number);
            const p1b = fmtPlayer(r.club_b_player1_name, r.club_b_player1_number);
            const p2b = fmtPlayer(r.club_b_player2_name, r.club_b_player2_number);
            if (p1a || p1b) lines.push(`  ${dim("Club A".padEnd(52))} ${dim("Club B")}`);
            if (p1a || p1b) lines.push(`  ${(p1a ?? dim("  —")).padEnd(52)} ${p1b ?? dim("  —")}`);
            if (p2a || p2b) lines.push(`  ${(p2a ?? dim("  —")).padEnd(52)} ${p2b ?? dim("  —")}`);
          }
        }

        return new Response(lines.join("\n") + "\n", TEXT);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (url.searchParams.get("format") === "json") {
          return new Response(JSON.stringify({ error: msg }), { status: 500, headers: JSON_HEADERS });
        }
        return new Response(`${red(`Error: ${msg}`)}`, { status: 500, ...TEXT });
      }
    }

    // ── help ───────────────────────────────────────────────────────────────────
    const base = url.origin;
    return new Response(
      `${bold(cyan("Frontis Scheduler"))}

${bold("/scrape_infos")}   — fetch form options (competitions, specialties, clubs, categories, phases)
  ${gray(`${base}/scrape_infos?league=lcapb&competition=20260501`)}
  ${gray(`${base}/scrape_infos?league=lcapb&competition=20260501&dry_run=true`)}

${bold("/scrape_results")} — fetch and display match results (competition/specialty/category/phase are DB ids)
  ${gray(`${base}/scrape_results?league=lcapb&competition=2&specialty=10&category=1&phase=0`)}
  ${gray(`${base}/scrape_results?league=lcapb&competition=2&specialty=10&category=1&phase=0&dry_run=true`)}

Supported leagues: ${yellow("lcapb")}  ${yellow("lidfpb")}

Authentication: every endpoint except ${bold("/version")} requires the header
  ${gray("x-internal-token: <INTERNAL_SERVICE_TOKEN>")}
`,
      TEXT
    );
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[scheduler] Cron triggered at ${event.cron}`);
    ctx.waitUntil(runNightlyScrape(env));
  },
} satisfies ExportedHandler<Env>;

const CRON_LEAGUES = ["lcapb", "lidfpb"];

/**
 * Nightly job: refresh results for every enabled competition of each league.
 *
 * `scrapeResults` requires a competition DB id; the upstream sites only filter
 * by competition, so there is no "all competitions" request. The cron therefore
 * iterates the league's competitions and scrapes each one with no other filter.
 *
 * Only competitions with `enabled = 1` are visited. That flag is opt-in: it is
 * flipped by `saveResults` the first time results land for a competition,
 * typically through a manual `/scrape_results` call. Bootstrapping a competition
 * once by hand is what enrols it in the nightly refresh. The full list produced
 * by `/scrape_infos` reaches back to 2013 and must not be re-scraped every night.
 *
 * Each competition is scraped by calling our own `/scrape_results` endpoint
 * through the SELF service binding rather than by calling `scrapeResults`
 * directly. A service-binding call is a separate Worker invocation with its own
 * CPU time limit (10 ms on the Free plan), so the parsing cost of one
 * competition's page is no longer summed with every other competition in the
 * cron invocation, and a competition that blows the limit does not take the
 * rest of the night's run down with it. The cron invocation itself only runs
 * two small D1 queries and reads tiny JSON summaries.
 *
 * Competitions run sequentially: each self-call is one subrequest (50 per
 * invocation on the Free plan, 32 Worker invocations per request chain), and
 * going parallel would only hammer the upstream site.
 */
async function runNightlyScrape(env: Env): Promise<void> {
  for (const league of CRON_LEAGUES) {
    const db = getDatabase(env, league);
    if (!db) {
      console.error(`[scheduler][${league}] No database binding, skipping`);
      continue;
    }

    let competitions: { id: number; name: string }[];
    try {
      ({ results: competitions } = await db
        .prepare("SELECT id, name FROM competitions WHERE enabled = 1 ORDER BY id")
        .all<{ id: number; name: string }>());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[scheduler][${league}] Failed to list enabled competitions: ${message}`);
      continue;
    }

    if (competitions.length === 0) {
      console.log(
        `[scheduler][${league}] No enabled competition; run /scrape_results once for a competition to enrol it`
      );
      continue;
    }

    let total = 0;
    let failed = 0;
    for (const competition of competitions) {
      const label = `${competition.name} (#${competition.id})`;
      try {
        const { saved, found } = await scrapeViaSelf(env, league, competition.id);
        total += saved;
        console.log(`[scheduler][${league}] ${label}: found ${found}, saved ${saved} results`);
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[scheduler][${league}] ${label}: ${message}`);
      }
    }

    console.log(
      `[scheduler][${league}] Saved ${total} results across ${competitions.length} competitions (${failed} failed)`
    );
  }
}

/**
 * Scrape one competition in a fresh invocation of this worker via the SELF
 * service binding. The hostname is irrelevant for a service binding; only the
 * path and query are routed. The callee is this same worker, so the request
 * must carry the internal token like any other HTTP caller.
 */
async function scrapeViaSelf(
  env: Env,
  league: string,
  competitionId: number
): Promise<{ found: number; saved: number }> {
  const params = new URLSearchParams({
    league,
    competition: String(competitionId),
    specialty: "0",
    category: "0",
    phase: "0",
    format: "json",
  });
  const res = await env.SELF.fetch(`https://frontis-scheduler.internal/scrape_results?${params}`, {
    headers: { "x-internal-token": env.INTERNAL_SERVICE_TOKEN },
  });
  const body = (await res.json().catch(() => null)) as
    | { found?: number; saved?: number; error?: string }
    | null;

  if (!res.ok || !body || typeof body.saved !== "number") {
    throw new Error(body?.error ?? `self-call failed with HTTP ${res.status}`);
  }
  return { found: body.found ?? 0, saved: body.saved };
}
