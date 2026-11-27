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
        async run() {
          queries.push({ sql, bindings });
          return { meta: { changes: 1 } };
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
    DB_LEAGUE_LLPB: none,
    DB_LEAGUE_FFPB: none,
    SELF: { fetch: mock() } as unknown as Fetcher,
    ...parts,
  };
}

const get = (path: string, env: Env) => worker.fetch(new Request(`https://scheduler.internal${path}`), env);
const post = (path: string, payload: string, env: Env) =>
  worker.fetch(
    new Request(`https://scheduler.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
    env
  );
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
    expect(html).toContain(`<script type="application/json" id="leagues">["lcapb","lidfpb","ctpb","llpb","ffpb"]</script>`);
    expect(html).toContain(`<div class="version">v${version}</div>`);
  });

  test("keeps the inline script intact through the String.raw template", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    expect(html).toContain(`var path = "/scrape_" + scriptName + "?" + params;`);
    expect(html).toContain(`parent.appendChild(new Option(item.name, String(item.id)));`);
    expect(html).not.toContain("${");
  });

  test("offers one combination or every combination, the walk reading the counts headers", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    expect(html).toContain(`<input type="radio" name="mode" id="mode-one" value="one" checked />`);
    expect(html).toContain(`<input type="radio" name="mode" id="mode-walk" value="walk" />`);
    expect(html).toContain(`var found = answer.res ? answer.res.headers.get("X-Scrape-Found") : null;`);
    expect(html).toContain(`} else if (reply.found === 0) {`);
  });

  test("tells an expired Access session from a Cloudflare error page, and tries a failed scrape again", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(`init.redirect = "manual";`);
    expect(script).toContain(`if (res.type === "opaqueredirect" || (!ours && res.status < 500 && res.status !== 429)) {`);
    expect(script).toContain(`if (!outage(answer.status) || attempt > RETRY_PAUSES.length || (walk && walk.stopped)) break;`);

    const source = /function edgeError[\s\S]*?\n {6}}\n/.exec(script)![0];
    const edgeError = new Function(`${source}; return edgeError;`)() as (html: string) => string;
    expect(edgeError("<title>Worker exceeded resource limits | frontis-scheduler.pilotariak.com | Cloudflare</title>"))
      .toBe("Cloudflare error page: Worker exceeded resource limits (the Worker ran out of CPU time, crashed or timed out)");
    expect(edgeError("")).toBe("Cloudflare error page (the Worker ran out of CPU time, crashed or timed out)");
  });

  test("walks past combinations the competition does not offer, and stops only on outages", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;

    const source = /function outage\(status\) \{[^\n]*\}\n/.exec(script)![0];
    const outage = new Function(`${source}; return outage;`)() as (status: number) => boolean;
    for (const status of [0, 429, 500, 503]) expect(outage(status)).toBe(true);
    // A 400 is the scheduler answering: an FFPB category the specialty does not offer.
    for (const status of [200, 400, 404]) expect(outage(status)).toBe(false);

    // A 400 is tallied as not offered before any failure, and never asks.
    expect(script).toMatch(/if \(reply\.status === 400\) \{[\s\S]*?tally\.notOffered\+\+;[\s\S]*?\} else if \(!reply\.ok\) \{/);
    expect(script).toContain(`inARow = down ? inARow + 1 : 0;`);
    expect(script).toContain(`inARow = !reply.ok && outage(reply.status) ? inARow + 1 : 0;`);
    // The last combination ends the walk as finished, not as stopped.
    expect(script).toContain(`if (inARow >= MAX_FAILURES_IN_A_ROW && done < list.length) {`);
    expect(script).toContain(`if (inARow >= MAX_FAILURES_IN_A_ROW && done < competitions.length) {`);
  });

  test("walks the matching combinations for an All choice of a league that takes one at a time", () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(renderAdminPage(["ffpb"], "1.0.0"))![1]!;
    const pick = (re: RegExp) => re.exec(script)![0];
    const sources =
      pick(/function hasId\(item\) \{[^\n]*\}\n/) +
      pick(/function combinations\(\) \{[\s\S]*?\n {6}\}\n/) +
      pick(/function expanded\(\) \{[\s\S]*?\n {6}\}\n/);
    const make = new Function("offered", "specialtyEl", "categoryEl", `${sources}; return expanded;`);
    const walked = (oneAtATime: boolean, specialty: string, category: string) => {
      const offered = {
        oneAtATime,
        specialties: [{ id: 29, name: "Pala" }, { id: 30, name: "Paleta" }, { id: null, name: "Xare" }],
        categories: [{ id: 1, name: "Seniors" }, { id: 2, name: "Juniors" }],
      };
      const list = make(offered, { value: specialty }, { value: category })() as { label: string }[] | null;
      return list && list.map((combo) => combo.label);
    };

    expect(walked(true, "29", "0")).toEqual(["Pala · Seniors", "Pala · Juniors"]);
    expect(walked(true, "0", "2")).toEqual(["Pala · Juniors", "Paleta · Juniors"]);
    expect(walked(true, "0", "0")).toEqual(["Pala · Seniors", "Pala · Juniors", "Paleta · Seniors", "Paleta · Juniors"]);
    // One request does it: a single combination, a choice still missing, or a league that takes "0".
    expect(walked(true, "29", "1")).toBeNull();
    expect(walked(true, "", "0")).toBeNull();
    expect(walked(false, "29", "0")).toBeNull();
    expect(script).toContain(`var subset = mode() === "walk" ? combinations() : expanded();`);
  });

  test("offers a bootstrap card: the league row first, then /scrape_infos by source_id", () => {
    const html = renderAdminPage(["lcapb"], "1.0.0");
    expect(html).toContain(`<details class="card" id="bootstrap">`);
    expect(html).toContain(`<input type="text" id="bs-name" required disabled`);
    // The URL comes from the scraper's code, so the page shows it but never sends it.
    expect(html).toContain(`<input type="url" id="bs-url" readonly`);
    expect(html).toContain(`bsUrlEl.value = bsLeague.url;`);
    // Init writes the league row alone, like setup-league's /init.
    expect(html).toContain(`<button type="button" class="secondary push" id="bs-init" disabled`);
    expect(html).toContain(`logEl.textContent = registeredLine(await fetchJson(path, { name: name }));`);
    expect(html).toContain(`initLeague(bsLeague.acronym, bsNameEl.value.trim());`);
    expect(html).toContain(`var row = await fetchJson(path, { name: register.name });`);
    expect(html).toContain(`execute("infos", { league: bsLeague.acronym, competition: bsCompetitionEl.value }`);
    expect(html).toContain(`return new Option(c.name, c.source_id);`);
    expect(html).toContain(`var reply = await scrape("infos", { league: league, competition: competition.source_id }, false);`);
    // /admin/competitions lists newest first; the walk saves oldest first so current labels win.
    expect(html).toContain(`bootstrapAll(bsLeague.acronym, name, bsCompetitions.slice().reverse());`);
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
        { id: 545, source_id: "20270501", name: "Championnat 2027", enabled: 1 },
        { id: 476, source_id: "20130501", name: "Championnat 2013", enabled: 0 },
      ]],
    ]);
    const res = await get("/admin/competitions?league=lcapb", envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      competitions: [
        { id: 545, source_id: "20270501", name: "Championnat 2027", enabled: true },
        { id: 476, source_id: "20130501", name: "Championnat 2013", enabled: false },
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
      oneAtATime: false,
    });
  });

  test("results: tells the page FFPB takes one specialty and one category at a time", async () => {
    spyOn(scrapers.ffpb!, "fetchResultsForm").mockResolvedValue(form(["20260501"]));
    const res = await get(
      "/admin/options?league=ffpb&competition=502&script=results",
      envWith({ DB_LEAGUE_FFPB: leagueDb().db })
    );
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ oneAtATime: true });
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
      oneAtATime: false,
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

// ── /admin/league ────────────────────────────────────────────────────────────

describe("/admin/league", () => {
  const URL_LCAPB = "https://lcapb.euskalpilota.fr/resultats.php";

  test("GET reads the league's row, with the scraper's URL", async () => {
    const { db, queries } = fakeDb([[/FROM leagues WHERE acronym = \?/, () => [{ name: "Comité Côte d'Argent" }]]]);
    const res = await get("/admin/league?league=lcapb", envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ acronym: "lcapb", url: URL_LCAPB, name: "Comité Côte d'Argent" });
    expect(queries[0]!.bindings).toEqual(["lcapb"]);
  });

  test("GET answers a null name for a league not registered yet", async () => {
    const res = await get("/admin/league?league=lcapb", envWith({ DB_LEAGUE_LCAPB: fakeDb([]).db }));
    expect(await body(res)).toEqual({ acronym: "lcapb", url: URL_LCAPB, name: null });
  });

  test("POST registers the league as setup-league's /init does, the URL from the scraper", async () => {
    const { db, queries } = fakeDb([]);
    const res = await post("/admin/league?league=lcapb", `{"name":"  Comité Côte d'Argent  "}`, envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ acronym: "lcapb", url: URL_LCAPB, name: "Comité Côte d'Argent" });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toMatch(/INSERT INTO leagues \(name, acronym, url\)[\s\S]*ON CONFLICT\(acronym\) DO UPDATE/);
    expect(queries[0]!.bindings).toEqual(["Comité Côte d'Argent", "lcapb", URL_LCAPB]);
  });

  test.each([
    [`{"name":"   "}`],
    [`{}`],
    [`not json`],
  ])("POST %s is a 400 and writes nothing", async (payload) => {
    const { db, queries } = fakeDb([]);
    const res = await post("/admin/league?league=lcapb", payload, envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "missing required parameter: name" });
    expect(queries).toHaveLength(0);
  });

  test("requires a known league", async () => {
    const res = await post("/admin/league?league=ccapb", `{"name":"CCAPB"}`, envWith({}));
    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "Unsupported league: ccapb" });
  });

  test("a database without the leagues table is a 500", async () => {
    const db = {
      prepare: () => ({ bind: () => ({ run: () => Promise.reject(new Error("D1_ERROR: no such table: leagues")) }) }),
    } as unknown as D1Database;
    const res = await post("/admin/league?league=lcapb", `{"name":"LCAPB"}`, envWith({ DB_LEAGUE_LCAPB: db }));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "D1_ERROR: no such table: leagues" });
  });
});
