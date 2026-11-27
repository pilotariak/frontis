import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import worker from "./index";
import { UpstreamError } from "./log";
import * as rankings from "./rankings";
import * as scraper from "./scraper";
import type { Env } from "./types";
import { version } from "../../../package.json";

// ── Fakes ────────────────────────────────────────────────────────────────────

type Rule = [RegExp, (bindings: unknown[]) => unknown[]];

function fakeDb(rules: Rule[], opts: { failWith?: string } = {}) {
  const queries: { sql: string; bindings: unknown[] }[] = [];
  const rowsFor = (sql: string, bindings: unknown[]) => {
    if (opts.failWith) throw new Error(opts.failWith);
    const rule = rules.find(([re]) => re.test(sql));
    return rule ? rule[1](bindings) : [];
  };
  const db = {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => ({
        async first() {
          queries.push({ sql, bindings });
          return rowsFor(sql, bindings)[0] ?? null;
        },
        async all() {
          queries.push({ sql, bindings });
          return { results: rowsFor(sql, bindings) };
        },
      });
      return { bind: (...bindings: unknown[]) => make(bindings), ...make([]) };
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return { db, queries };
}

type SelfHandler = (url: URL) => Response | Promise<Response>;

function fakeSelf(handler: SelfHandler) {
  const calls: URL[] = [];
  const fetch = mock(async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url);
    return handler(url);
  });
  return { self: { fetch } as unknown as Fetcher, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    settled: () => Promise.all(pending),
  };
}

const event = { cron: "0 3 * * *", scheduledTime: 0, noRetry() {} } as ScheduledController;

type Line = Record<string, unknown>;
let logs: Line[];
let errors: Line[];

/** Collects the lines of a console method; each call must log one object. */
const collect = (into: () => Line[]) => (...args: unknown[]) => {
  expect(args).toHaveLength(1);
  expect(typeof args[0]).toBe("object");
  into().push(args[0] as Line);
};

beforeEach(() => {
  logs = [];
  errors = [];
  spyOn(console, "log").mockImplementation(collect(() => logs));
  spyOn(console, "error").mockImplementation(collect(() => errors));
});

afterEach(() => mock.restore());

const get = (path: string, env: Env) => worker.fetch(new Request(`https://scheduler.internal${path}`), env);
const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

function envWith(parts: Partial<Env>): Env {
  const none = fakeDb([]).db;
  return {
    DB_LEAGUE_LCAPB: none,
    DB_LEAGUE_LIDFPB: none,
    DB_LEAGUE_CTPB: none,
    DB_LEAGUE_LLPB: none,
    DB_LEAGUE_FFPB: none,
    SELF: fakeSelf(() => json({})).self,
    ...parts,
  };
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

describe("fetch", () => {
  test("/version reports the workspace version", async () => {
    const res = await get("/version", envWith({}));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ version });
  });

  test("/scrape_infos requires a league", async () => {
    const res = await get("/scrape_infos?no_color=true", envWith({}));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Error: missing required parameter: league");
    expect(errors).toEqual([
      {
        event: "route.error",
        route: "/scrape_infos",
        status: 400,
        durationMs: expect.any(Number),
        message: "missing required parameter: league",
      },
    ]);
  });

  test.each([
    ["&competition=20260501&specialty=10&category=3&phase=4", "20260501"],
    ["", ""],
  ])("/scrape_infos passes the league and competition only (query %p)", async (query, competition) => {
    const empty = { competitions: [], specialties: [], clubs: [], categories: [], phases: [] };
    const scrapeInfos = spyOn(scraper, "scrapeInfos").mockResolvedValue(empty);

    const res = await get(`/scrape_infos?league=lcapb${query}&dry_run=true&no_color=true`, envWith({}));

    expect(res.status).toBe(200);
    expect(scrapeInfos).toHaveBeenCalledTimes(1);
    expect(scrapeInfos.mock.calls[0][1]).toEqual({ league: "lcapb", competition });
    expect(scrapeInfos.mock.calls[0][2]).toBe(true);
  });

  test("/scrape_infos reports a missing results form as an error", async () => {
    spyOn(scraper, "scrapeInfos").mockRejectedValue(
      new Error("[LCAPB] Results form not found on resultats.php (HTTP 200)")
    );
    const res = await get("/scrape_infos?league=lcapb&no_color=true", envWith({}));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Error: [LCAPB] Results form not found on resultats.php (HTTP 200)");
    expect(errors).toEqual([
      expect.objectContaining({
        event: "route.error",
        route: "/scrape_infos",
        league: "lcapb",
        status: 500,
        message: "[LCAPB] Results form not found on resultats.php (HTTP 200)",
      }),
    ]);
  });

  test("/scrape_results logs the league site failure it returns, the answer unchanged", async () => {
    const message = "[FFPB] Failed to fetch the home page: HTTP 503 ";
    spyOn(scraper, "scrapeResults").mockRejectedValue(
      new UpstreamError(message, 503, "Erreur 503 Le serveur WebDev est saturé")
    );

    const res = await get(
      "/scrape_results?league=ffpb&competition=12&specialty=55&category=1&dry_run=true&format=json",
      envWith({})
    );

    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: message });
    expect(errors).toEqual([
      {
        event: "route.error",
        route: "/scrape_results",
        league: "ffpb",
        competition: "12",
        specialty: "55",
        category: "1",
        dryRun: "true",
        status: 500,
        durationMs: expect.any(Number),
        message,
        upstreamStatus: 503,
        upstreamBody: "Erreur 503 Le serveur WebDev est saturé",
      },
    ]);
  });

  test("/scrape_results lists every missing parameter", async () => {
    const res = await get("/scrape_results?league=lcapb", envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      error: "missing required parameters: competition, specialty, category",
    });
    expect(errors).toEqual([
      expect.objectContaining({
        event: "route.error",
        route: "/scrape_results",
        league: "lcapb",
        status: 400,
        message: "missing required parameters: competition, specialty, category",
      }),
    ]);
  });

  test("/scrape_results answers a parameter the caller must fix with a 400, as JSON when format=json", async () => {
    const res = await get(
      "/scrape_results?league=lcapb&competition=9&specialty=0&category=0&format=json",
      envWith({})
    );
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      error: "Competition with id '9' not found in database. Run /scrape_infos first.",
    });
  });

  test("/scrape_rankings rejects a malformed id as plain text otherwise", async () => {
    const res = await get(
      "/scrape_rankings?league=lcapb&competition=2&specialty=0&category=abc&no_color=true",
      envWith({})
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Error: Invalid category: 'abc'");
    expect(errors).toEqual([
      expect.objectContaining({
        event: "route.error",
        route: "/scrape_rankings",
        category: "abc",
        status: 400,
        message: "Invalid category: 'abc'",
      }),
    ]);
  });

  test("/scrape_results reports a bad parameter as plain text otherwise", async () => {
    const res = await get(
      "/scrape_results?league=lcapb&competition=9&specialty=0&category=0&no_color=true",
      envWith({})
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "Error: Competition with id '9' not found in database. Run /scrape_infos first."
    );
  });

  test("/scrape_results reports its counts as headers, which the admin page reads", async () => {
    spyOn(scraper, "scrapeResults").mockResolvedValue({ results: [], saved: 0 });
    const res = await get(
      "/scrape_results?league=lcapb&competition=2&specialty=10&category=1&no_color=true&dry_run=true",
      envWith({})
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Scrape-Found")).toBe("0");
    expect(res.headers.get("X-Scrape-Saved")).toBe("0");
    expect(await res.text()).toContain("(no results)");
    expect(logs).toEqual([
      {
        event: "route.done",
        route: "/scrape_results",
        league: "lcapb",
        competition: "2",
        specialty: "10",
        category: "1",
        dryRun: "true",
        status: 200,
        found: 0,
        saved: 0,
        durationMs: expect.any(Number),
        message: "found 0, saved 0 results",
      },
    ]);
    expect(errors).toEqual([]);
  });

  test("/scrape_rankings reports its counts as headers, which the admin page reads", async () => {
    spyOn(rankings, "scrapeRankings").mockResolvedValue({ competition: "Championnat", pages: [], found: 7, saved: 6 });
    const res = await get(
      "/scrape_rankings?league=lcapb&competition=2&specialty=10&category=1&no_color=true",
      envWith({})
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Scrape-Found")).toBe("7");
    expect(res.headers.get("X-Scrape-Saved")).toBe("6");
    expect(logs).toEqual([
      expect.objectContaining({ event: "route.done", route: "/scrape_rankings", status: 200, found: 7, saved: 6 }),
    ]);
  });

  test("/scrape_rankings takes the same required parameters as /scrape_results", async () => {
    const res = await get("/scrape_rankings?league=lcapb&competition=2", envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "missing required parameters: specialty, category" });
  });

  test("/scrape_rankings answers a parameter the caller must fix with a 400", async () => {
    const res = await get(
      "/scrape_rankings?league=lcapb&competition=9&specialty=0&category=0&format=json",
      envWith({})
    );
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      error: "Competition with id '9' not found in database. Run /scrape_infos first.",
    });
  });

  test("colour codes are omitted with no_color and present without it", async () => {
    const plain = await (await get("/scrape_infos?no_color=true", envWith({}))).text();
    const coloured = await (await get("/scrape_infos", envWith({}))).text();
    expect(plain).not.toContain("\x1b[");
    expect(coloured).toContain("\x1b[31m");
  });

  test("any other path serves the help text", async () => {
    const res = await get("/", envWith({}));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("/scrape_infos");
    expect(text).toContain("/scrape_results");
    expect(text).toContain("/scrape_rankings");
  });
});

// ── Nightly cron ─────────────────────────────────────────────────────────────

describe("scheduled", () => {
  const enabled = (rows: { id: number; name: string }[]): Rule[] => [
    [/FROM competitions WHERE enabled = 1/, () => rows],
  ];

  test("scrapes every enabled competition of each league through the SELF binding, sequentially", async () => {
    const lcapb = fakeDb(enabled([{ id: 2, name: "Championnat 2026" }, { id: 3, name: "Coupe 2026" }]));
    const lidfpb = fakeDb(enabled([{ id: 7, name: "IDF 2026" }]));
    const { self, calls } = fakeSelf((url) =>
      json({ found: 10, saved: Number(url.searchParams.get("competition")) })
    );
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_LCAPB: lcapb.db, DB_LEAGUE_LIDFPB: lidfpb.db, SELF: self }), ctx);
    await settled();

    expect(calls.map((u) => u.pathname)).toEqual(["/scrape_results", "/scrape_results", "/scrape_results"]);
    expect(calls.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { league: "lcapb", competition: "2", specialty: "0", category: "0", phase: "0", format: "json" },
      { league: "lcapb", competition: "3", specialty: "0", category: "0", phase: "0", format: "json" },
      { league: "lidfpb", competition: "7", specialty: "0", category: "0", phase: "0", format: "json" },
    ]);
    expect(lcapb.queries[0].sql).toBe("SELECT id, name FROM competitions WHERE enabled = 1 ORDER BY id");
    expect(logs[0]).toEqual({ event: "cron.start", cron: "0 3 * * *", message: "Cron triggered at 0 3 * * *" });
    expect(logs).toContainEqual({
      event: "cron.scrape",
      route: "/scrape_results",
      league: "lcapb",
      competition: "2",
      found: 10,
      saved: 2,
      durationMs: expect.any(Number),
      message: "Championnat 2026 (#2): found 10, saved 2 results",
    });
    expect(logs).toContainEqual({
      event: "cron.summary",
      route: "/scrape_results",
      league: "lcapb",
      saved: 5,
      failed: 0,
      message: "Saved 5 results across 2 competitions (0 failed)",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "cron.summary", league: "lidfpb", saved: 7, failed: 0 })
    );
    expect(errors).toEqual([]);
  });

  test("does not call CTPB, which is not part of the nightly run", async () => {
    const ctpb = fakeDb(enabled([{ id: 1, name: "CTPB" }]));
    const { self, calls } = fakeSelf(() => json({ found: 0, saved: 0 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_CTPB: ctpb.db, SELF: self }), ctx);
    await settled();

    expect(calls).toEqual([]);
    expect(ctpb.queries).toEqual([]);
  });

  test("does not call FFPB, whose results are scraped one specialty and category at a time", async () => {
    const ffpb = fakeDb(enabled([{ id: 1, name: "CHAMPIONNAT DE FRANCE 2026" }]));
    const { self, calls } = fakeSelf(() => json({ found: 0, saved: 0 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_FFPB: ffpb.db, SELF: self }), ctx);
    await settled();

    expect(calls).toEqual([]);
    expect(ffpb.queries).toEqual([]);
  });

  test("a failing competition is logged and does not stop the others", async () => {
    const lcapb = fakeDb(enabled([{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }]));
    const { self, calls } = fakeSelf((url) => {
      switch (url.searchParams.get("competition")) {
        case "1":
          return json({ error: "upstream exploded" }, 500);
        case "2":
          return new Response("<html>not json</html>", { status: 200 });
        default:
          return json({ found: 4, saved: 4 });
      }
    });
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_LCAPB: lcapb.db, SELF: self }), ctx);
    await settled();

    expect(calls).toHaveLength(3);
    expect(errors).toEqual([
      {
        event: "cron.scrape.error",
        route: "/scrape_results",
        league: "lcapb",
        competition: "1",
        status: 500,
        durationMs: expect.any(Number),
        message: "A (#1): upstream exploded",
      },
      expect.objectContaining({
        event: "cron.scrape.error",
        competition: "2",
        status: 200,
        message: "B (#2): self-call failed with HTTP 200",
      }),
    ]);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "cron.summary", saved: 4, failed: 2, message: "Saved 4 results across 3 competitions (2 failed)" })
    );
  });

  test("a league with no enabled competition is skipped with a hint", async () => {
    const { self, calls } = fakeSelf(() => json({ found: 0, saved: 0 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ SELF: self }), ctx);
    await settled();

    expect(calls).toEqual([]);
    expect(logs).toContainEqual({
      event: "cron.skip",
      league: "lcapb",
      message: "No enabled competition; run /scrape_results once for a competition to enrol it",
    });
  });

  test("a league whose competition listing fails is skipped without aborting the run", async () => {
    const lcapb = fakeDb([], { failWith: "D1 unavailable" });
    const lidfpb = fakeDb(enabled([{ id: 7, name: "IDF" }]));
    const { self, calls } = fakeSelf(() => json({ found: 1, saved: 1 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_LCAPB: lcapb.db, DB_LEAGUE_LIDFPB: lidfpb.db, SELF: self }), ctx);
    await settled();

    expect(errors).toEqual([
      { event: "cron.skip", league: "lcapb", message: "Failed to list enabled competitions: D1 unavailable" },
      { event: "cron.skip", league: "lcapb", message: "Failed to list provisional rankings: D1 unavailable" },
    ]);
    expect(calls.map((u) => u.searchParams.get("league"))).toEqual(["lidfpb"]);
  });

  test("refreshes each provisional (competition, specialty) ranking through the SELF binding", async () => {
    const lcapb = fakeDb([
      [/FROM rankings/, () => [
        { competition_id: 4, specialty_id: 98 },
        { competition_id: 4, specialty_id: 97 },
      ]],
    ]);
    const { self, calls } = fakeSelf(() => json({ found: 12, saved: 12 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_LCAPB: lcapb.db, SELF: self }), ctx);
    await settled();

    expect(lcapb.queries.map((q) => q.sql).find((s) => s.includes("FROM rankings"))).toContain(
      "HAVING SUM(phase = 'Champion') = 0"
    );
    expect(calls.map((u) => u.pathname)).toEqual(["/scrape_rankings", "/scrape_rankings"]);
    expect(calls.map((u) => Object.fromEntries(u.searchParams))).toEqual([
      { league: "lcapb", competition: "4", specialty: "98", category: "0", format: "json" },
      { league: "lcapb", competition: "4", specialty: "97", category: "0", format: "json" },
    ]);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "cron.scrape", route: "/scrape_rankings", competition: "4", specialty: "98", saved: 12 })
    );
    expect(logs).toContainEqual({
      event: "cron.summary",
      route: "/scrape_rankings",
      league: "lcapb",
      saved: 24,
      failed: 0,
      message: "Saved 24 ranked teams across 2 specialties (0 failed)",
    });
    expect(errors).toEqual([]);
  });

  test("a missing database binding is skipped", async () => {
    const env = envWith({ SELF: fakeSelf(() => json({})).self });
    delete (env as Partial<Env>).DB_LEAGUE_LCAPB;
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, env, ctx);
    await settled();

    expect(errors).toEqual([{ event: "cron.skip", league: "lcapb", message: "No database binding, skipping" }]);
  });
});
