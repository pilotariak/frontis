import { scrapeAndSave } from "./scraper";
import type { Env } from "./types";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/scrape") {
      const league = url.searchParams.get("league");
      const competition = url.searchParams.get("competition");
      const specialty = url.searchParams.get("specialty");
      const category = url.searchParams.get("category");
      const phase = url.searchParams.get("phase");

      if (!league || !competition || !specialty || !category || !phase) {
        return new Response(
          JSON.stringify({
            error: "Bad Request",
            message:
              "Missing required query parameters: league, competition, specialty, category, and phase must be provided.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      try {
        const count = await scrapeAndSave(env, { league, competition, specialty, category, phase });
        return new Response(JSON.stringify({ saved: count }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const exampleUrl = new URL(req.url);
    exampleUrl.pathname = "/scrape";
    exampleUrl.search = "?league=lcapb&competition=20260501&specialty=2&category=1&phase=0";
    return new Response(
      `Frontis Scheduler\n\nTo manually trigger a scrape:\n  curl "${exampleUrl.toString()}"\n\nSupported leagues: lcapb, lidfpb\n`
    );
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log(`[scheduler] Cron triggered at ${event.cron}`);

    const leagues = ["lcapb", "lidfpb"];
    const tasks = leagues.map((league) =>
      scrapeAndSave(env, {
        league,
        competition: "",
        specialty: "",
        category: "",
        phase: "",
      })
        .then((count) => console.log(`[scheduler][${league}] Saved ${count} results`))
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[scheduler][${league}] Error: ${message}`);
        })
    );

    ctx.waitUntil(Promise.all(tasks));
  },
} satisfies ExportedHandler<Env>;
