import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import worker from "./index";
import { adminLeagues } from "./admin";
import { renderAdminPage } from "./admin-page";
import { scrapers } from "./scraper";
import type { FormOptions, RankingSource } from "./leagues/types";
import type { Env } from "./types";
import { version } from "../../../package.json";

// ── Fakes ────────────────────────────────────────────────────────────────────

type Rule = [RegExp, (bindings: unknown[]) => unknown[]];

function fakeDb(rules: Rule[]) {
  const queries: { sql: string; bindings: unknown[] }[] = [];
  const rowsFor = (sql: string, bindings: unknown[]) => {
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
  } as unknown as D1Database;
  return { db, queries };
}

function envWith(parts: Partial<Env>): Env {
  const none = fakeDb([]).db;
  return {
    DB_LEAGUE_LCAPB: none,
    DB_LEAGUE_LIDFPB: none,
    DB_LEAGUE_CTPB: none,
    SELF: { fetch: mock() } as unknown as Fetcher,
    ...parts,
  };
}

const get = (path: string, env: Env) => worker.fetch(new Request(`https://scheduler.internal${path}`), env);
const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

/** Competition 502 is source_id 20260501; specialty 146 and category 1575 are known. */
function leagueDb() {
  const bySourceId = (table: Record<string, number>) => (bindings: unknown[]) =>
    bindings.filter((s) => table[s as string] !== undefined).map((s) => ({ id: table[s as string], source_id: s }));
  return fakeDb([
    [/FROM competitions WHERE id = \?/, ([id]) => (id === "502" ? [{ id: 502, source_id: "20260501", name: "Championnat 2026" }] : [])],
    [/FROM specialties WHERE source_id IN/, bySourceId({ "13": 146 })],
    [/FROM categories WHERE source_id IN/, bySourceId({ "4": 1575 })],
  ]);
}

const form = (competitions: string[]): FormOptions => ({
  competitions: competitions.map((sourceId) => ({ sourceId, name: sourceId })),
  specialties: [{ sourceId: "13", name: "Main nue" }, { sourceId: "99", name: "Xare" }],
  clubs: [],
  categories: [{ sourceId: "4", name: "1ère Série" }],
  phases: [],
});

afterEach(() => mock.restore());

// ── /admin ───────────────────────────────────────────────────────────────────

describe("/admin", () => {
  test("serves the page with the leagues and version filled in", async () => {
    const res = await get("/admin", envWith({}));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain(`<script type="application/json" id="leagues">["lcapb","lidfpb","ctpb"]</script>`);
    expect(html).toContain(`<div class="version">v${version}</div>`);
  });

  test("keeps the inline script intact through the String.raw template", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    expect(html).toContain(`var path = "/scrape_" + scriptName + "?" + params;`);
    expect(html).toContain(`parent.appendChild(new Option(item.name, String(item.id)));`);
    expect(html).not.toContain("${");
  });

  test("escapes '<' in the leagues JSON island", () => {
    expect(renderAdminPage(["</script>"], "1.0.0")).toContain(`["\\u003c/script>"]`);
  });

  test("lists only leagues with both a scraper and a D1 binding", () => {
    const env = { DB_LEAGUE_LCAPB: fakeDb([]).db } as unknown as Env;
    expect(adminLeagues(env)).toEqual(["lcapb"]);
  });
});

// ── /admin/competitions ──────────────────────────────────────────────────────

describe("/admin/competitions", () => {
  test("lists scrapable competitions newest season first, with the nightly flag", async () => {
    const { db, queries } = fakeDb([
      [/FROM competitions/, () => [
        { id: 545, name: "Championnat 2027", enabled: 1 },
        { id: 476, name: "Championnat 2013", enabled: 0 },
      ]],
    ]);
    const res = await get("/admin/competitions?league=lcapb", envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      competitions: [
        { id: 545, name: "Championnat 2027", enabled: true },
        { id: 476, name: "Championnat 2013", enabled: false },
      ],
    });
    expect(queries[0]!.sql).toMatch(/WHERE source_id IS NOT NULL\s+ORDER BY source_id DESC/);
  });

  test("requires a known league", async () => {
    let res = await get("/admin/competitions", envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "missing required parameter: league" });

    res = await get("/admin/competitions?league=ccapb", envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "Unsupported league: ccapb" });
  });
});

// ── /admin/options ───────────────────────────────────────────────────────────

describe("/admin/options", () => {
  test("results: maps the results form's offer to database ids, null when unknown", async () => {
    const fetchResultsForm = spyOn(scrapers.lcapb!, "fetchResultsForm").mockResolvedValue(form(["20260501"]));
    const res = await get(
      "/admin/options?league=lcapb&competition=502&script=results",
      envWith({ DB_LEAGUE_LCAPB: leagueDb().db })
    );
    expect(res.status).toBe(200);
    expect(fetchResultsForm).toHaveBeenCalledWith("20260501");
    expect(await body(res)).toEqual({
      specialties: [{ id: 146, name: "Main nue" }, { id: null, name: "Xare" }],
      categories: [{ id: 1575, name: "1ère Série" }],
    });
  });

  test("rankings: reads the rankings page, not the results form", async () => {
    const fetchResultsForm = spyOn(scrapers.lcapb!, "fetchResultsForm");
    const source: RankingSource = {
      listed: true,
      specialties: [{ sourceId: "13", name: "Main nue" }],
      categories: [{ sourceId: "4", name: "1ère Série" }],
      fetch: mock(),
    };
    const openRankings = spyOn(scrapers.lcapb!, "openRankings").mockResolvedValue(source);
    const res = await get(
      "/admin/options?league=lcapb&competition=502&script=rankings",
      envWith({ DB_LEAGUE_LCAPB: leagueDb().db })
    );
    expect(res.status).toBe(200);
    expect(openRankings).toHaveBeenCalledWith("20260501");
    expect(fetchResultsForm).not.toHaveBeenCalled();
    expect(source.fetch).not.toHaveBeenCalled();
    expect(await body(res)).toEqual({
      specialties: [{ id: 146, name: "Main nue" }],
      categories: [{ id: 1575, name: "1ère Série" }],
    });
  });

  test("a competition the league site does not list is a 400", async () => {
    spyOn(scrapers.lcapb!, "fetchResultsForm").mockResolvedValue(form(["20250501"]));
    const res = await get(
      "/admin/options?league=lcapb&competition=502&script=results",
      envWith({ DB_LEAGUE_LCAPB: leagueDb().db })
    );
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({
      error: "The league site lists no results for competition 502 (Championnat 2026)",
    });
  });

  test.each([
    ["competition=502", "Invalid script: '' (results or rankings)"],
    ["competition=502&script=infos", "Invalid script: 'infos' (results or rankings)"],
    ["script=results", "missing required parameter: competition"],
    ["competition=abc&script=results", "Invalid competition: 'abc'"],
    ["competition=7&script=results", "Competition with id '7' not found in database. Run /scrape_infos first."],
  ])("rejects %s with a 400", async (query, error) => {
    const fetchResultsForm = spyOn(scrapers.lcapb!, "fetchResultsForm");
    const res = await get(`/admin/options?league=lcapb&${query}`, envWith({ DB_LEAGUE_LCAPB: leagueDb().db }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error });
    expect(fetchResultsForm).not.toHaveBeenCalled();
  });

  test("a league site failure is a 500", async () => {
    spyOn(scrapers.lcapb!, "fetchResultsForm").mockRejectedValue(new Error("[LCAPB] Failed to fetch results form: Bad Gateway"));
    const res = await get(
      "/admin/options?league=lcapb&competition=502&script=results",
      envWith({ DB_LEAGUE_LCAPB: leagueDb().db })
    );
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "[LCAPB] Failed to fetch results form: Bad Gateway" });
  });
});
