import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BadRequestError } from "./params";
import { scrapeInfos, scrapeResults, scrapers } from "./scraper";
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
    DB_LEAGUE_LLPB: db,
    DB_LEAGUE_FFPB: db,
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

// Two pool phases, then a final, as CTPB prints a category whose pool round
// has a second phase: the block header repeats inside the table.
const POOL_HTML = `
<table class="mBloc">
  <tr><td colspan="7"><a href="csv.php">Télécharger</a></td></tr>
  <tr><td>Trinquet/P.G. Pleine Masculin <span>Seniors</span> <span>GROUPE A Poule phase 1</span></td></tr>
  <tr><td class="mTitreSmall" colspan="2">Poules 2</td><td class="mTitreSmall">Club 1</td></tr>
  <tr>
    <td><strong>P 1</strong></td><td>05/01/2026</td>
    <td>HASPARREN</td><td>ANGLET</td><td>15/08 15/11</td>
  </tr>
  <tr><td>Trinquet/P.G. Pleine Masculin <span>Seniors</span> <span>GROUPE A Poule phase 2</span></td></tr>
  <tr><td class="mTitreSmall" colspan="2">Poules 1</td><td class="mTitreSmall">Club 1</td></tr>
  <tr>
    <td><strong>P 1</strong></td><td>12/01/2026</td>
    <td>CA BEGLAIS <span class="small">(01)</span></td><td>URRUGNE PILOTA</td><td>15/10 15/13</td>
  </tr>
  <tr><td class="mTitreSmall" colspan="2">Finale</td><td class="mTitreSmall">Club 1</td></tr>
  <tr>
    <td><strong>F 1</strong></td><td>19/01/2026</td>
    <td>HASPARREN</td><td>URRUGNE PILOTA</td><td>15/12 15/14</td>
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

// The results form of competition 20260501, as a GET with InCompet returns it:
// the source_ids match LOOKUPS below. Categories C9 and phase P9 are in the
// database but not offered here.
const SITE_FORM_HTML = `
<select name="InCompet"><option value="20260501">Championnat 2026</option></select>
<select name="InSpec"><option value="S10">Trinquet / P.G. Pleine Masculin</option><option value="S11">Main Nue</option></select>
<select name="InCat"><option value="0">Toutes</option><option value="C3">Seniors</option><option value="C5">Cadets</option></select>
<select name="InPhase"><option value="0">Toutes</option><option value="P4">Finale</option></select>`;

/** GET answers with the results form, POST with the results. */
function serveSite(form: string, results: string): void {
  fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) =>
    new Response(init?.method === "POST" ? results : form, { status: 200 })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

/** The POST calls, i.e. the results requests that went past validation. */
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  serveSite(SITE_FORM_HTML, RESULTS_HTML);
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
  [/SELECT id, source_id, name FROM competitions WHERE id/, ([id]) => ({
    "2": [{ id: 2, source_id: "20260501", name: "Championnat 2026" }],
    "7": [{ id: 7, source_id: "20230503", name: "Challenge 2023" }],
  }[String(id)] ?? [])],
  [/SELECT id, source_id, name FROM specialties WHERE id/, ([id]) =>
    id === "10" ? [{ id: 10, source_id: "S10", name: "Trinquet / P.G. pleine masculin" }] : []],
  [/SELECT id, source_id, name FROM categories WHERE id/, ([id]) => ({
    "3": [{ id: 3, source_id: "C3", name: "Séniors" }],
    "9": [{ id: 9, source_id: "C9", name: "Minimes" }],
  }[String(id)] ?? [])],
  [/SELECT id, source_id, name FROM phases WHERE id/, ([id]) => ({
    "4": [{ id: 4, source_id: "P4", name: "Finale" }],
    "9": [{ id: 9, source_id: "P9", name: "Barrage" }],
  }[String(id)] ?? [])],
  [/SELECT id, source_id FROM categories WHERE source_id IN/, (ids) => (ids.includes("C3") ? [{ id: 3, source_id: "C3" }] : [])],
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

// ── Replaying the upserts on real SQLite ─────────────────────────────────────

/** The results upserts saveResults sends for one scrape of `html`. */
async function upsertsFor(html: string): Promise<Statement[]> {
  serveSite(SITE_FORM_HTML, html);
  const { db, batches } = fakeDb(LOOKUPS);
  await scrapeResults(envWith(db), ALL, false);
  return batches[1].filter((s) => s.sql.startsWith("INSERT INTO results"));
}

/** An in-memory results table, as the migrations leave it. */
function resultsTable(): Database {
  const sqlite = new Database(":memory:");
  sqlite.run(`CREATE TABLE results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competition_id INTEGER NOT NULL, specialty_id INTEGER NOT NULL, category_id INTEGER NOT NULL,
    club_a_id INTEGER NOT NULL, club_b_id INTEGER NOT NULL, date_match TEXT, phase TEXT,
    club_a_player1_name TEXT, club_a_player1_number TEXT, club_a_player2_name TEXT, club_a_player2_number TEXT,
    club_b_player1_name TEXT, club_b_player1_number TEXT, club_b_player2_name TEXT, club_b_player2_number TEXT,
    scores TEXT, pool INTEGER, pool_phase INTEGER,
    UNIQUE(competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id, phase)
  )`);
  return sqlite;
}

/** Runs the upserts and sums their changes, as saveResults computes `saved`. */
function replay(sqlite: Database, upserts: Statement[]): number {
  return upserts.reduce(
    (sum, s) => sum + sqlite.query(s.sql).run(...(s.bindings as (string | number | null)[])).changes,
    0
  );
}

/** The stored rows, with the first player of club A. */
function stored(sqlite: Database): unknown[] {
  return sqlite
    .query(
      `SELECT phase, scores, pool, pool_phase, club_a_player1_name AS player, club_a_player1_number AS number
       FROM results ORDER BY id`
    )
    .all();
}

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

    // A GET of the competition's form first, then the results POST.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://lcapb.euskalpilota.fr/resultats.php?InCompet=20260501");
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://lcapb.euskalpilota.fr/resultats.php");
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("InCompet")).toBe("20260501");
    expect(body.get("InSpec")).toBe("S10");
    expect(body.get("InCat")).toBe("C3");
    expect(body.get("InPhase")).toBe("P4");
  });

  test("rejects a category id missing from the database instead of ignoring it", async () => {
    const { db } = fakeDb(LOOKUPS);
    const call = scrapeResults(envWith(db), { ...ALL, category: "42" }, true);
    await expect(call).rejects.toBeInstanceOf(BadRequestError);
    await expect(call).rejects.toThrow("Category with id '42' not found in database. Run /scrape_infos first.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a parameter that is not a database id", async () => {
    const { db } = fakeDb(LOOKUPS);
    const call = scrapeResults(envWith(db), { ...ALL, phase: "x1" }, true);
    await expect(call).rejects.toBeInstanceOf(BadRequestError);
    await expect(call).rejects.toThrow("Invalid phase: 'x1'");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a category the competition does not offer, listing the offered ones", async () => {
    const { db, batches } = fakeDb(LOOKUPS);
    const call = scrapeResults(envWith(db), { ...ALL, category: "9" }, false);
    await expect(call).rejects.toBeInstanceOf(BadRequestError);
    await expect(call).rejects.toThrow(
      "Category 9 (Minimes) is not offered by competition 2 (Championnat 2026). " +
        "Offered: 3 (Seniors), ? (Cadets, source_id C5 not in database)"
    );
    expect(posts()).toEqual([]);
    expect(batches).toEqual([]);
  });

  test("rejects a phase the site does not offer", async () => {
    const { db } = fakeDb(LOOKUPS);
    await expect(scrapeResults(envWith(db), { ...ALL, phase: "9" }, true)).rejects.toThrow(
      "Phase 9 (Barrage) is not offered by competition 2 (Championnat 2026)"
    );
    expect(posts()).toEqual([]);
  });

  test("refuses a competition the site does not list, since it would answer with another one", async () => {
    const { db, batches } = fakeDb(LOOKUPS);
    const call = scrapeResults(envWith(db), { ...ALL, competition: "7" }, false);
    await expect(call).rejects.toBeInstanceOf(BadRequestError);
    await expect(call).rejects.toThrow("The league site lists no results for competition 7 (Challenge 2023)");
    expect(posts()).toEqual([]);
    expect(batches).toEqual([]);
  });

  test("a page without the results form is an upstream failure, not a bad request", async () => {
    serveSite("<html><body>Erreur</body></html>", RESULTS_HTML);
    const { db } = fakeDb(LOOKUPS);
    const call = scrapeResults(envWith(db), ALL, true);
    await expect(call).rejects.toThrow("[LCAPB] Results form not found on resultats.php (HTTP 200)");
    await expect(call).rejects.not.toBeInstanceOf(BadRequestError);
    expect(posts()).toEqual([]);
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

  test("persists results in two batches and reports only new or changed rows", async () => {
    const { db, batches } = fakeDb(LOOKUPS, (s) =>
      // Pretend the HASPARREN/ANGLET row already existed, unchanged.
      s.sql.startsWith("INSERT INTO results") && s.bindings[4] === 300 ? 0 : 1
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
    expect(insertA.bindings.slice(8, 12)).toEqual([null, null, "DUPONT Jean", "1"]);
    expect(insertB.bindings.slice(0, 6)).toEqual([2, 10, 3, "05/01/2026", 300, 400]);
    expect(insertC.bindings.slice(0, 6)).toEqual([2, 11, 5, "06/01/2026", 500, 600]);
    expect(flags.map((s) => [s.sql, s.bindings])).toEqual([
      ["UPDATE competitions SET enabled = 1 WHERE id = ? AND enabled = 0", [2]],
      ["UPDATE specialties SET enabled = 1 WHERE id IN (?, ?) AND enabled = 0", [10, 11]],
      ["UPDATE categories SET enabled = 1 WHERE id IN (?, ?) AND enabled = 0", [3, 5]],
    ]);
  });

  test("binds the pool and pool phase of each match", async () => {
    serveSite(SITE_FORM_HTML, POOL_HTML);
    const { db, batches } = fakeDb(LOOKUPS);
    await scrapeResults(envWith(db), ALL, false);

    const upserts = batches[1].filter((s) => s.sql.startsWith("INSERT INTO results"));
    // phase, pool, pool_phase
    expect(upserts.map((s) => s.bindings.slice(7, 10))).toEqual([
      ["P 1", 2, 1],
      ["P 1", 1, 2],
      ["F 1", null, null],
    ]);
  });

  test("a re-scrape fills the pool and score of a stored row and keeps its stored lineup", async () => {
    const upserts = await upsertsFor(POOL_HTML);
    const sqlite = resultsTable();
    // Stored before migration 0014, and before the match was played: no score, no pool.
    sqlite.run(
      `INSERT INTO results (competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id, phase, club_a_player1_name)
       VALUES (2, 10, 3, '05/01/2026', 300, 400, 'P 1', 'DUPONT Jean')`
    );

    // Two new rows, and the stored one gets its pool and score. The site lists
    // no player for it, so the stored one stays.
    expect(replay(sqlite, upserts)).toBe(3);
    expect(stored(sqlite)).toEqual([
      { phase: "P 1", scores: "15/08 15/11", pool: 2, pool_phase: 1, player: "DUPONT Jean", number: null },
      { phase: "P 1", scores: "15/10 15/13", pool: 1, pool_phase: 2, player: null, number: null },
      { phase: "F 1", scores: "15/12 15/14", pool: null, pool_phase: null, player: null, number: null },
    ]);

    // Nothing changed on the site: nothing is reported as saved.
    expect(replay(sqlite, upserts)).toBe(0);
    expect(stored(sqlite)).toHaveLength(3);
  });

  test("a stored result saved before its match was played gets the score and counts as saved", async () => {
    const sqlite = resultsTable();
    // First save: the HASPARREN/ANGLET pool match is not played yet.
    expect(replay(sqlite, await upsertsFor(POOL_HTML.replace("15/08 15/11", "")))).toBe(3);
    expect(stored(sqlite)).toMatchObject([{ phase: "P 1", scores: null, pool: 2, pool_phase: 1 }, {}, {}]);

    // The site now gives the score: same date, phase and clubs, so the stored
    // row is updated in place. Its pool is unchanged, so only the score counts.
    const played = await upsertsFor(POOL_HTML);
    expect(replay(sqlite, played)).toBe(1);
    expect(stored(sqlite)).toEqual([
      { phase: "P 1", scores: "15/08 15/11", pool: 2, pool_phase: 1, player: null, number: null },
      { phase: "P 1", scores: "15/10 15/13", pool: 1, pool_phase: 2, player: null, number: null },
      { phase: "F 1", scores: "15/12 15/14", pool: null, pool_phase: null, player: null, number: null },
    ]);
    expect(replay(sqlite, played)).toBe(0);
  });

  test("a lineup missing at first is filled by a later scrape", async () => {
    const sqlite = resultsTable();
    expect(replay(sqlite, await upsertsFor(RESULTS_HTML.replace("<ul><li>(1) DUPONT Jean</li></ul>", "")))).toBe(3);
    expect(stored(sqlite)).toMatchObject([{ phase: "Finale", player: null, number: null }, {}, {}]);

    const withLineup = await upsertsFor(RESULTS_HTML);
    expect(replay(sqlite, withLineup)).toBe(1);
    expect(stored(sqlite)).toMatchObject([{ phase: "Finale", scores: "15/10 15/13", player: "DUPONT Jean", number: "1" }, {}, {}]);
    expect(replay(sqlite, withLineup)).toBe(0);
  });

  test("saving an unchanged page again changes nothing and counts 0", async () => {
    const upserts = await upsertsFor(RESULTS_HTML);
    const sqlite = resultsTable();
    expect(replay(sqlite, upserts)).toBe(3);
    const before = sqlite.query("SELECT * FROM results ORDER BY id").all();

    expect(replay(sqlite, upserts)).toBe(0);
    expect(sqlite.query("SELECT * FROM results ORDER BY id").all()).toEqual(before);
  });

  test("a stored score or player is kept when a later scrape gives none", async () => {
    const sqlite = resultsTable();
    expect(replay(sqlite, await upsertsFor(RESULTS_HTML))).toBe(3);

    // The site drops the score and the lineup of the final: nothing is erased,
    // and nothing counts as saved.
    const blank = RESULTS_HTML.replace("15/10 15/13", "").replace("<ul><li>(1) DUPONT Jean</li></ul>", "");
    const upserts = await upsertsFor(blank);
    expect(upserts[0].bindings[6]).toBeNull(); // scores
    expect(upserts[0].bindings.slice(10, 12)).toEqual([null, null]); // club A player 1 name, number
    expect(replay(sqlite, upserts)).toBe(0);
    expect(stored(sqlite)).toMatchObject([{ phase: "Finale", scores: "15/10 15/13", player: "DUPONT Jean", number: "1" }, {}, {}]);
  });

  test("a score corrected on the site replaces the stored one", async () => {
    const sqlite = resultsTable();
    expect(replay(sqlite, await upsertsFor(RESULTS_HTML))).toBe(3);

    expect(replay(sqlite, await upsertsFor(RESULTS_HTML.replace("15/10 15/13", "15/10 15/14")))).toBe(1);
    expect(stored(sqlite)).toMatchObject([{ phase: "Finale", scores: "15/10 15/14", player: "DUPONT Jean" }, {}, {}]);
  });

  test("uses the requested specialty for every row instead of matching by name", async () => {
    const { db, batches } = fakeDb(LOOKUPS);
    await scrapeResults(envWith(db), { ...ALL, specialty: "10" }, false);

    const inserts = batches[1].filter((s) => s.sql.startsWith("INSERT INTO results"));
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
      "[LCAPB] Failed to fetch results form: Service Unavailable"
    );
  });
});

describe("scrapeInfos", () => {
  const INFOS = { league: "lcapb", competition: "20260501" };

  // FORM_HTML parsed: what /scrape_infos returns and saves.
  const FORM_OPTIONS = {
    competitions: [{ sourceId: "20260501", name: "Championnat 2026" }],
    specialties: [{ sourceId: "10", name: "Trinquet" }],
    clubs: [{ sourceId: "7", name: "CA BEGLAIS" }],
    categories: [{ sourceId: "3", name: "Seniors" }],
    phases: [{ sourceId: "4", name: "Finale" }],
  };

  /** The URL and init of a fetch call, with the query split out. */
  const request = (call: [string | URL | Request, RequestInit?]) => {
    const url = new URL(String(call[0]));
    return { base: `${url.origin}${url.pathname}`, params: url.searchParams, init: call[1] };
  };

  // A GET with every form field (InVoir among them) made the site answer with
  // the whole results page, which blew the CPU limit (#118): InCompet must be
  // the only field.
  test.each([
    ["a competition", "20260501"],
    ["the site default competition", ""],
  ])("reads %s from a GET whose query holds InCompet only", async (_, competition) => {
    serve(FORM_HTML);
    const { db, batches } = fakeDb([]);

    const options = await scrapeInfos(envWith(db), { league: "lcapb", competition }, true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { base, params, init } = request(fetchMock.mock.calls[0]);
    expect(base).toBe(scrapers.lcapb!.baseUrl);
    expect([...params.keys()]).toEqual(["InCompet"]);
    expect(params.get("InCompet")).toBe(competition);
    for (const field of ["InVoir", "InSpec", "InCat", "InPhase"]) expect(params.has(field)).toBe(false);
    expect(init?.method).toBeUndefined();
    expect(options).toEqual(FORM_OPTIONS);
    expect(batches).toEqual([]);
  });

  test.each(["lcapb", "lidfpb", "ctpb", "llpb"])("returns and saves the same options for %s", async (league) => {
    serve(FORM_HTML);
    const { db, batches } = fakeDb([]);

    const options = await scrapeInfos(envWith(db), { league, competition: "20260501" }, false);

    // CTPB primes a session first; the form GET is always the last request.
    const { base, params } = request(fetchMock.mock.calls.at(-1)!);
    expect(base).toBe(scrapers[league]!.baseUrl);
    expect([...params.entries()]).toEqual([["InCompet", "20260501"]]);
    expect(options).toEqual(FORM_OPTIONS);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((s) => s.bindings)).toEqual([
      ["10", "Trinquet"],
      ["7", "CA BEGLAIS"],
      ["3", "Seniors"],
      ["4", "Finale"],
      ["20260501", "Championnat 2026"],
    ]);
  });

  test("primes the CTPB session before the form GET, and sends its cookie with it", async () => {
    fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.redirect === "manual"
        ? new Response(null, { status: 302, headers: { "Set-Cookie": "PHPSESSID=s3ss10n; path=/" } })
        : new Response(FORM_HTML, { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { db } = fakeDb([]);

    const options = await scrapeInfos(envWith(db), { league: "ctpb", competition: "20260104" }, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const prime = request(fetchMock.mock.calls[0]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(scrapers.ctpb!.baseUrl);
    expect(prime.init?.redirect).toBe("manual");
    const form = request(fetchMock.mock.calls[1]);
    expect(form.base).toBe(scrapers.ctpb!.baseUrl);
    expect([...form.params.entries()]).toEqual([["InCompet", "20260104"]]);
    expect((form.init?.headers as Record<string, string>)["Cookie"]).toBe("PHPSESSID=s3ss10n");
    expect(options).toEqual(FORM_OPTIONS);
  });

  test("upserts every option in a single batch with the right conflict target", async () => {
    serve(FORM_HTML);
    const { db, batches } = fakeDb([]);

    await scrapeInfos(envWith(db), INFOS, false);

    expect(batches).toHaveLength(1);
    const normalised = batches[0].map((s) => [s.sql.replace(/\s+/g, " "), s.bindings]);
    expect(normalised).toEqual([
      ["INSERT INTO specialties (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id", ["10", "Trinquet"]],
      ["INSERT INTO clubs (source_id, name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET source_id = excluded.source_id", ["7", "CA BEGLAIS"]],
      ["INSERT INTO categories (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name", ["3", "Seniors"]],
      ["INSERT INTO phases (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name", ["4", "Finale"]],
      [
        "INSERT INTO competitions (source_id, name) VALUES (?, ?) ON CONFLICT(source_id) DO UPDATE SET name = excluded.name WHERE NOT EXISTS (SELECT 1 FROM competitions WHERE name = excluded.name) ON CONFLICT(name) DO NOTHING",
        ["20260501", "Championnat 2026"],
      ],
    ]);
  });

  test("skips a competition whose name another source_id holds, so the save does not fail", async () => {
    // The LCAPB site lists one name under two ids; competitions.name is UNIQUE.
    serve(FORM_HTML.replace(
      `<option value="20260501">Championnat 2026</option>`,
      `<option value="20270503">Corpo 2025-2026</option><option value="20260503">Corpo 2025-2026</option>` +
        `<option value="20260501">Championnat 2026</option>`
    ));
    const { db, batches } = fakeDb([]);
    await scrapeInfos(envWith(db), INFOS, false);

    // Replay the batch on real SQLite, with the table as the migrations leave it.
    const sqlite = new Database(":memory:");
    sqlite.run(
      `CREATE TABLE competitions (id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT UNIQUE, name TEXT NOT NULL UNIQUE)`
    );
    sqlite.run(`INSERT INTO competitions (source_id, name) VALUES ('20250101', 'Championnat 2025')`);
    const competitionRows = () => sqlite.query("SELECT source_id, name FROM competitions ORDER BY source_id").all();
    const replay = () => {
      for (const s of batches.at(-1)!.filter((s) => s.sql.includes("INTO competitions"))) {
        sqlite.query(s.sql).run(...(s.bindings as string[]));
      }
    };

    replay();
    expect(competitionRows()).toEqual([
      { source_id: "20250101", name: "Championnat 2025" },
      { source_id: "20260501", name: "Championnat 2026" },
      { source_id: "20260503", name: "Corpo 2025-2026" },
    ]);

    // A known competition renamed onto a taken name keeps its own name.
    serve(FORM_HTML.replace("Championnat 2026", "Championnat 2025"));
    await scrapeInfos(envWith(db), INFOS, false);
    replay();
    expect(competitionRows()).toContainEqual({ source_id: "20260501", name: "Championnat 2026" });
  });

  // No competition list means no form (session not primed, error page, markup
  // change): an error, where saving nothing used to pass for success.
  test("fails on a page without a competition list, and saves nothing", async () => {
    serve("<html></html>");
    const { db, statements, batches } = fakeDb([]);
    await expect(scrapeInfos(envWith(db), INFOS, false)).rejects.toThrow(
      "[LCAPB] Results form not found on resultats.php (HTTP 200)"
    );
    expect(statements).toEqual([]);
    expect(batches).toEqual([]);
  });

  test("surfaces upstream HTTP failures", async () => {
    fetchMock = mock(async () => new Response("nope", { status: 503, statusText: "Service Unavailable" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { db, batches } = fakeDb([]);
    await expect(scrapeInfos(envWith(db), INFOS, false)).rejects.toThrow(
      "[LCAPB] Failed to fetch results form: Service Unavailable"
    );
    expect(batches).toEqual([]);
  });

  test("rejects an unsupported league", async () => {
    const { db } = fakeDb([]);
    await expect(scrapeInfos(envWith(db), { ...INFOS, league: "xyz" }, true)).rejects.toThrow(
      "Unsupported league: xyz"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
