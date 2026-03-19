import { scrapeInfos, scrapeResults } from "./scraper";
import type { Env } from "./types";

const TEXT = { headers: { "Content-Type": "text/plain; charset=utf-8" } };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";

    // ── /scrape_infos ──────────────────────────────────────────────────────────
    if (url.pathname === "/scrape_infos") {
      const league = url.searchParams.get("league");
      if (!league) {
        return new Response("Error: missing required parameter: league", { status: 400, ...TEXT });
      }

      const competition = url.searchParams.get("competition") ?? "";
      const specialty   = url.searchParams.get("specialty")   ?? "0";
      const category    = url.searchParams.get("category")    ?? "0";
      const phase       = url.searchParams.get("phase")       ?? "0";

      try {
        const fo = await scrapeInfos(env, { league, competition, specialty, category, phase }, dryRun);

        const fmt = (items: { sourceId: string; name: string }[]) =>
          items.length ? items.map((o) => `  [${o.sourceId}] ${o.name}`).join("\n") : "  (none)";

        const lines = [
          `League : ${league.toUpperCase()}${dryRun ? "  [dry-run — not saved]" : "  [saved to database]"}`,
          "",
          `Competitions (${fo.competitions.length})`,
          fmt(fo.competitions),
          "",
          `Specialties (${fo.specialties.length})`,
          fmt(fo.specialties),
          "",
          `Clubs (${fo.clubs.length})`,
          fmt(fo.clubs),
          "",
          `Categories (${fo.categories.length})`,
          fmt(fo.categories),
          "",
          `Phases (${fo.phases.length})`,
          fmt(fo.phases),
        ];

        return new Response(lines.join("\n"), TEXT);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`Error: ${msg}`, { status: 500, ...TEXT });
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
          "Error: missing required parameters: league, competition",
          { status: 400, ...TEXT }
        );
      }

      try {
        const { results, saved } = await scrapeResults(
          env,
          { league, competition, specialty, category, phase },
          dryRun
        );

        const lines = [
          `League     : ${league.toUpperCase()}`,
          `Competition: ${competition}`,
          `Filters    : specialty=${specialty}  category=${category}  phase=${phase}`,
          `Status     : ${dryRun ? `${results.length} results found — not saved (dry-run)` : `${saved} results saved`}`,
          "",
        ];

        if (results.length === 0) {
          lines.push("  (no results)");
        } else {
          for (const r of results) {
            const score = r.score_a !== null && r.score_b !== null
              ? `${r.score_a} / ${r.score_b}`
              : "- / -";
            lines.push(
              `  ${r.date_match ?? "??-??-??"}  ${r.club_a.padEnd(30)} ${score.padStart(7)}  ${r.club_b}`,
              `             ${r.category}  —  ${r.phase}`
            );
          }
        }

        return new Response(lines.join("\n"), TEXT);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`Error: ${msg}`, { status: 500, ...TEXT });
      }
    }

    // ── help ───────────────────────────────────────────────────────────────────
    const base = url.origin;
    return new Response(
      `Frontis Scheduler

/scrape_infos   — fetch form options (competitions, specialties, clubs, categories, phases)
  ${base}/scrape_infos?league=lcapb&competition=20260501
  ${base}/scrape_infos?league=lcapb&competition=20260501&dry_run=true

/scrape_results — fetch and display match results
  ${base}/scrape_results?league=lcapb&competition=20260501&specialty=2&category=1&phase=0
  ${base}/scrape_results?league=lcapb&competition=20260501&specialty=2&category=1&phase=0&dry_run=true

Supported leagues: lcapb, lidfpb
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
