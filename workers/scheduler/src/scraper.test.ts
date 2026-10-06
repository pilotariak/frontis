import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { scrapeInfos, scrapeResults } from "./scraper";
import type { Env } from "./types";

// ── Fake D1 ──────────────────────────────────────────────────────────────────
//
// `rules` map a SQL pattern to the rows it should return for given bindings.
// Every prepared statement is recorded so tests can assert what was sent, and
// `batch()` reports one `meta.changes` per statement through `changesFor`.

type Rule = [RegExp, (bindings: unknown[]) => unknown[]];

interface Statement {
  sql: string;
  bindings: unknown[];
}

function fakeDb(rules: Rule[], changesFor: (s: Statement) => number = () => 1) {
  const statements: Statement[] = [];
  const batches: Statement[][] = [];

  const rowsFor = (sql: string, bindings: unknown[]): unknown[] => {
    const rule = rules.find(([re]) => re.test(sql));
    return rule ? rule[1](bindings) : [];
  };

  const db = {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => {
        const stmt: Statement = { sql, bindings };
        return {
          __stmt: stmt,
          async first() {
            statements.push(stmt);
            return rowsFor(sql, bindings)[0] ?? null;
          },
          async all() {
            statements.push(stmt);
            return { results: rowsFor(sql, bindings) };
          },
        };
      };
      return {
        bind: (...bindings: unknown[]) => make(bindings),
        ...make([]),
      };
    },
    async batch(stmts: { __stmt: Statement }[]) {
      const batch = stmts.map((s) => s.__stmt);
      batches.push(batch);
      return batch.map((s) => ({ success: true, results: [], meta: { changes: changesFor(s) } }));
    },
  } as unknown as D1Database;

  return { db, statements, batches };
}

function envWith(db: D1Database): Env {
  return {
    DB_LEAGUE_LCAPB: db,
    DB_LEAGUE_LIDFPB: db,
    DB_LEAGUE_CTPB: db,
    SELF: { fetch: async () => new Response("") } as unknown as Fetcher,
  };
}

// ── Upstream HTML ────────────────────────────────────────────────────────────

const RESULTS_HTML = `
<table class="mBloc">
  <tr><td>Résultats</td></tr>
  <tr><td>Trinquet/P.G. Pleine Masculin <span>Seniors</span></td></tr>
  <tr><td class="mTitreSmall">h</td></tr>
  <tr>
    <td><strong>Finale</strong></td><td>12/01/2026</td>
    <td>CA BEGLAIS <span class="small">(01)</span><ul><li>(1) DUPONT Jean</li></ul></td>
    <td>URRUGNE PILOTA</td>
    <td>15/10 15/13</td>
  </tr>
  <tr>
    <td><strong>Poule</strong></td><td>05/01/2026</td>
    <td>HASPARREN</td><td>ANGLET</td><td>30/25</td>
  </tr>
</table>
<table class="mBloc">
  <tr><td>Résultats</td></tr>
  <tr><td>Main Nue <span>Cadets</span></td></tr>
  <tr><td class="mTitreSmall">h</td></tr>
  <tr>
    <td><strong>Poule</strong></td><td>06/01/2026</td>
    <td>BIARRITZ</td><td>BAYONNE</td><td>22/18</td>
  </tr>
</table>`;

const FORM_HTML = `
<select name="InCompet"><option value="0">-</option><option value="20260501">Championnat 2026</option></select>
<select name="InSpec"><option value="10">Trinquet</option></select>
<select name="InClub"><option value="7">CA BEGLAIS</option></select>
<select name="InCat"><option value="3">Seniors</option></select>
<select name="InPhase"><option value="4">Finale</option></select>`;

type FetchMock = ReturnType<typeof mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>>;
let fetchMock: FetchMock;
const realFetch = globalThis.fetch;

function serve(html: string): void {
  fetchMock = mock(async () => new Response(html, { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
  serve(RESULTS_HTML);
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

// Lookup rows shared by the scrapeResults cases: DB ids on the left are what
// the HTTP API receives, source_ids are what the upstream form expects.
const LOOKUPS: Rule[] = [
  [/SELECT source_id FROM competitions WHERE id/, ([id]) => (id === "2" ? [{ source_id: "20260501" }] : [])],
  [/SELECT source_id FROM specialties WHERE id/, ([id]) => (id === "10" ? [{ source_id: "S10" }] : [])],
  [/SELECT source_id FROM categories WHERE id/, ([id]) => (id === "3" ? [{ source_id: "C3" }] : [])],
  [/SELECT source_id FROM phases WHERE id/, ([id]) => (id === "4" ? [{ source_id: "P4" }] : [])],
  [/SELECT name FROM specialties WHERE id/, ([id]) => (id === "10" ? [{ name: "Trinquet / P.G. pleine masculin" }] : [])],
  [/SELECT name FROM categories WHERE id/, ([id]) => (id === "3" ? [{ name: "Séniors" }] : [])],
  [/SELECT id FROM competitions WHERE source_id/, () => [{ id: 2 }]],
  [/SELECT id FROM specialties WHERE source_id/, ([sid]) => (sid === "S10" ? [{ id: 10 }] : [])],
  [/SELECT id, name FROM clubs/, () => [
    { id: 100, name: "CA BEGLAIS" },
    { id: 200, name: "URRUGNE PILOTA" },
    { id: 300, name: "HASPARREN" },
    { id: 400, name: "ANGLET" },
    { id: 500, name: "BIARRITZ" },
    { id: 600, name: "BAYONNE" },
  ]],
  [/SELECT id, name FROM categories/, () => [{ id: 3, name: "Seniors" }, { id: 5, name: "Cadets" }]],
  [/SELECT id, name FROM specialties/, () => [{ id: 10, name: "Trinquet/P.G. Pleine Masculin" }, { id: 11, name: "Main Nue" }]],
];

const ALL = { league: "lcapb", competition: "2", specialty: "0", category: "0", phase: "0" };

describe("scrapeResults", () => {
  test("rejects an unsupported league before touching the database or network", async () => {
    const { db, statements } = fakeDb(LOOKUPS);
    await expect(scrapeResults(envWith(db), { ...ALL, league: "nope" }, true)).rejects.toThrow(
      "Unsupported league: nope"
    );
    expect(statements).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails fast when the competition id is unknown", async () => {
    const { db } = fakeDb(LOOKUPS);
    await expect(scrapeResults(envWith(db), { ...ALL, competition: "99" }, true)).rejects.toThrow(
      "Competition with id '99' not found in database. Run /scrape_infos first."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fails when a requested specialty or phase has no source id", async () => {
    const { db } = fakeDb(LOOKUPS);
    await expect(scrapeResults(envWith(db), { ...ALL, specialty: "77" }, true)).rejects.toThrow(
      "Specialty with id '77' not found"
    );
    await expect(scrapeResults(envWith(db), { ...ALL, phase: "77" }, true)).rejects.toThrow(
      "Phase with id '77' not found"
    );
  });

  test("posts the form with source ids resolved from the DB ids", async () => {
    const { db } = fakeDb(LOOKUPS);
    await scrapeResults(envWith(db), { ...ALL, specialty: "10", category: "3", phase: "4" }, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://lcapb.euskalpilota.fr/resultats.php");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("InCompet")).toBe("20260501");
    expect(body.get("InSpec")).toBe("S10");
    expect(body.get("InCat")).toBe("C3");
    expect(body.get("InPhase")).toBe("P4");
  });

  test("a category without a source id is passed through unchanged", async () => {
    const { db } = fakeDb(LOOKUPS);
    await scrapeResults(envWith(db), { ...ALL, category: "42" }, true);
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("InCat")).toBe("42");
  });

  test("dry run returns every parsed row and writes nothing", async () => {
    const { db, batches } = fakeDb(LOOKUPS);
    const { results, saved } = await scrapeResults(envWith(db), ALL, true);

    expect(saved).toBe(0);
    expect(batches).toEqual([]);
    expect(results.map((r) => [r.club_a, r.club_b, r.scores])).toEqual([
      ["CA BEGLAIS 01", "URRUGNE PILOTA", "15/10 15/13"],
      ["HASPARREN", "ANGLET", "30/25"],
      ["BIARRITZ", "BAYONNE", "22/18"],
    ]);
  });

  test("keeps only rows matching the requested specialty and category, ignoring accents and punctuation", async () => {
    const { db } = fakeDb(LOOKUPS);

    const bySpecialty = await scrapeResults(envWith(db), { ...ALL, specialty: "10" }, true);
    expect(bySpecialty.results.map((r) => r.club_a)).toEqual(["CA BEGLAIS 01", "HASPARREN"]);

    const byCategory = await scrapeResults(envWith(db), { ...ALL, category: "3" }, true);
    expect(byCategory.results.map((r) => r.category)).toEqual(["Seniors", "Seniors"]);
  });

  test("persists results in two batches and reports only newly inserted rows", async () => {
    const { db, batches } = fakeDb(LOOKUPS, (s) =>
      // Pretend the HASPARREN/ANGLET row already existed.
      s.sql.startsWith("INSERT OR IGNORE INTO results") && s.bindings[4] === 300 ? 0 : 1
    );

    const { results, saved } = await scrapeResults(envWith(db), ALL, false);

    expect(results).toHaveLength(3);
    expect(saved).toBe(2);
    expect(batches).toHaveLength(2);

    // Batch 1: make sure every club (base name, no team number) and category exists.
    expect(batches[0].map((s) => [s.sql, s.bindings])).toEqual([
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["CA BEGLAIS"]],
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["URRUGNE PILOTA"]],
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["HASPARREN"]],
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["ANGLET"]],
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["BIARRITZ"]],
      ["INSERT OR IGNORE INTO clubs (name) VALUES (?)", ["BAYONNE"]],
      ["INSERT OR IGNORE INTO categories (name) VALUES (?)", ["Seniors"]],
      ["INSERT OR IGNORE INTO categories (name) VALUES (?)", ["Cadets"]],
    ]);

    // Batch 2: one INSERT per result, then the three `enabled` flips.
    const [insertA, insertB, insertC, ...flags] = batches[1];
    expect(insertA.bindings.slice(0, 8)).toEqual([2, 10, 3, "12/01/2026", 100, 200, "15/10 15/13", "Finale"]);
    expect(insertA.bindings.slice(8, 10)).toEqual(["DUPONT Jean", "1"]);
    expect(insertB.bindings.slice(0, 6)).toEqual([2, 10, 3, "05/01/2026", 300, 400]);
    expect(insertC.bindings.slice(0, 6)).toEqual([2, 11, 5, "06/01/2026", 500, 600]);
    expect(flags.map((s) => [s.sql, s.bindings])).toEqual([
      ["UPDATE competitions SET enabled = 1 WHERE id = ? AND enabled = 0", [2]],
      ["UPDATE specialties SET enabled = 1 WHERE id IN (?, ?) AND enabled = 0", [10, 11]],
      ["UPDATE categories SET enabled = 1 WHERE id IN (?, ?) AND enabled = 0", [3, 5]],
    ]);
  });

  test("uses the requested specialty for every row instead of matching by name", async () => {
    const { db, batches } = fakeDb(LOOKUPS);
    await scrapeResults(envWith(db), { ...ALL, specialty: "10" }, false);

    const inserts = batches[1].filter((s) => s.sql.startsWith("INSERT OR IGNORE INTO results"));
    expect(inserts.map((s) => s.bindings[1])).toEqual([10, 10]);
  });

  test("skips rows whose lookups are missing and writes nothing when none remain", async () => {
    const rules: Rule[] = LOOKUPS.map(([re, fn]) =>
      re.test("SELECT id, name FROM clubs") ? [re, () => []] : [re, fn]
    );
    const { db, batches } = fakeDb(rules);

    const { saved } = await scrapeResults(envWith(db), ALL, false);

    expect(saved).toBe(0);
    expect(batches).toHaveLength(1); // only the club/category upsert batch
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  test("surfaces upstream HTTP failures", async () => {
    fetchMock = mock(async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { db } = fakeDb(LOOKUPS);
    await expect(scrapeResults(envWith(db), ALL, true)).rejects.toThrow(
      "[LCAPB] Failed to fetch page: Service Unavailable"
    );
  });
});

describe("scrapeInfos", () => {
  test("fetches the form with a GET and returns the parsed dropdowns", async () => {
    serve(FORM_HTML);
    const { db, batches } = fakeDb([]);

    const options = await scrapeInfos(envWith(db), { ...ALL, competition: "20260501" }, true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toStartWith("https://lcapb.euskalpilota.fr/resultats.php?");
    expect(new URL(String(url)).searchParams.get("InCompet")).toBe("20260501");
    expect(init?.method).toBeUndefined();
    expect(options).toEqual({
      competitions: [{ sourceId: "20260501", name: "Championnat 2026" }],
      specialties: [{ sourceId: "10", name: "Trinquet" }],
      clubs: [{ sourceId: "7", name: "CA BEGLAIS" }],
      categories: [{ sourceId: "3", name: "Seniors" }],
      phases: [{ sourceId: "4", name: "Finale" }],
    });
    expect(batches).toEqual([]);
  });

  test("upserts every option in a single batch with the right conflict target", async () => {
    serve(FORM_HTML);
    const { db, batches } = fakeDb([]);

    await scrapeInfos(envWith(db), ALL, false);

    expect(batches).toHaveLength(1);
    const normalised = batches[0].map((s) => [s.sql.replace(/\s+/g, " "), s.bindings]);
    expect(normalised).toEqual([
      ["INSERT INTO specialties (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id", ["10", "Trinquet"]],
      ["INSERT INTO clubs (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id", ["7", "CA BEGLAIS"]],
      ["INSERT INTO categories (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name", ["3", "Seniors"]],
      ["INSERT INTO phases (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name", ["4", "Finale"]],
      ["INSERT INTO competitions (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name", ["20260501", "Championnat 2026"]],
    ]);
  });

  test("skips the batch entirely when the form is empty", async () => {
    serve("<html></html>");
    const { db, batches } = fakeDb([]);
    await scrapeInfos(envWith(db), ALL, false);
    expect(batches).toEqual([]);
  });

  test("rejects an unsupported league", async () => {
    const { db } = fakeDb([]);
    await expect(scrapeInfos(envWith(db), { ...ALL, league: "xyz" }, true)).rejects.toThrow(
      "Unsupported league: xyz"
    );
  });
});
