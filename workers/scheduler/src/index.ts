import { scrapeInfos, scrapeResults } from "./scraper";
import type { Env } from "./types";
import { version } from "../../../package.json";

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
    if (url.pathname === "/version") {
      return new Response(JSON.stringify({ version }), {
        headers: { "Content-Type": "application/json" },
      });
    }

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
      const specialty   = url.searchParams.get("specialty")   ?? "0";
      const category    = url.searchParams.get("category")    ?? "0";
      const phase       = url.searchParams.get("phase")       ?? "0";

      if (!league || !competition) {
        return new Response(
          `${red("Error: missing required parameters: league, competition")}`,
          { status: 400, ...TEXT }
        );
      }

      try {
        const { results, saved } = await scrapeResults(
          env,
          { league, competition, specialty, category, phase },
          dryRun
        );

        const statusLine = dryRun
          ? `${results.length} results found — ${yellow("not saved (dry-run)")}`
          : `${green(`${saved} results saved`)}`;

        const lines = [
          `${bold(cyan("League     "))} : ${bold(league.toUpperCase())}`,
          `${bold(cyan("Competition"))} : ${competition}`,
          `${bold(cyan("Filters    "))} : specialty=${specialty}  category=${category}  phase=${phase}`,
          `${bold(cyan("Status     "))} : ${statusLine}`,
          "",
        ];

        const fmtPlayer = (name?: string, id?: string) =>
          name ? `  ${white(name)}${id ? `  ${gray(`(${id})`)}` : ""}` : null;

        if (results.length === 0) {
          lines.push(dim("  (no results)"));
        } else {
          for (const r of results) {
            const score = r.score_a !== null && r.score_b !== null
              ? green(`${r.score_a} / ${r.score_b}`)
              : dim("- / -");

            lines.push(
              "",
              `  ${cyan(r.date_match ?? "??-??-??")}  ${bold(r.club_a.padEnd(32))} ${score.padStart(7)}  ${bold(r.club_b)}`,
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
`,
      TEXT
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[scheduler] Cron triggered at ${event.cron}`);

    const leagues = ["lcapb", "lidfpb"];
    const tasks = leagues.map((league) =>
      scrapeResults(env, { league, competition: "", specialty: "0", category: "0", phase: "0" }, false)
        .then(({ saved }) => console.log(`[scheduler][${league}] Saved ${saved} results`))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[scheduler][${league}] Error: ${message}`);
        })
    );

    ctx.waitUntil(Promise.all(tasks));
  },
} satisfies ExportedHandler<Env>;
