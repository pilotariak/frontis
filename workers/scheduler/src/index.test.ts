import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import worker from "./index";
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

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
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
  });

  test("/scrape_results lists every missing parameter", async () => {
    const res = await get("/scrape_results?league=lcapb", envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      error: "missing required parameters: competition, specialty, category",
    });
  });

  test("/scrape_results reports scraper errors as JSON when format=json", async () => {
    const res = await get(
      "/scrape_results?league=lcapb&competition=9&specialty=0&category=0&format=json",
      envWith({})
    );
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({
      error: "Competition with id '9' not found in database. Run /scrape_infos first.",
    });
  });

  test("/scrape_results reports scraper errors as plain text otherwise", async () => {
    const res = await get(
      "/scrape_results?league=lcapb&competition=9&specialty=0&category=0&no_color=true",
      envWith({})
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(
      "Error: Competition with id '9' not found in database. Run /scrape_infos first."
    );
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
    expect(logs).toContain("[scheduler][lcapb] Championnat 2026 (#2): found 10, saved 2 results");
    expect(logs).toContain("[scheduler][lcapb] Saved 5 results across 2 competitions (0 failed)");
    expect(logs).toContain("[scheduler][lidfpb] Saved 7 results across 1 competitions (0 failed)");
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
      "[scheduler][lcapb] A (#1): upstream exploded",
      "[scheduler][lcapb] B (#2): self-call failed with HTTP 200",
    ]);
    expect(logs).toContain("[scheduler][lcapb] Saved 4 results across 3 competitions (2 failed)");
  });

  test("a league with no enabled competition is skipped with a hint", async () => {
    const { self, calls } = fakeSelf(() => json({ found: 0, saved: 0 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ SELF: self }), ctx);
    await settled();

    expect(calls).toEqual([]);
    expect(logs).toContain(
      "[scheduler][lcapb] No enabled competition; run /scrape_results once for a competition to enrol it"
    );
  });

  test("a league whose competition listing fails is skipped without aborting the run", async () => {
    const lcapb = fakeDb([], { failWith: "D1 unavailable" });
    const lidfpb = fakeDb(enabled([{ id: 7, name: "IDF" }]));
    const { self, calls } = fakeSelf(() => json({ found: 1, saved: 1 }));
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, envWith({ DB_LEAGUE_LCAPB: lcapb.db, DB_LEAGUE_LIDFPB: lidfpb.db, SELF: self }), ctx);
    await settled();

    expect(errors).toEqual(["[scheduler][lcapb] Failed to list enabled competitions: D1 unavailable"]);
    expect(calls.map((u) => u.searchParams.get("league"))).toEqual(["lidfpb"]);
  });

  test("a missing database binding is skipped", async () => {
    const env = envWith({ SELF: fakeSelf(() => json({})).self });
    delete (env as Partial<Env>).DB_LEAGUE_LCAPB;
    const { ctx, settled } = fakeCtx();

    await worker.scheduled(event, env, ctx);
    await settled();

    expect(errors).toEqual(["[scheduler][lcapb] No database binding, skipping"]);
  });
});
