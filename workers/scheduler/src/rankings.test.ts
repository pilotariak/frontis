import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { nameKey, scrapeRankings } from "./rankings";
import type { Env } from "./types";

// ── Fake D1 ──────────────────────────────────────────────────────────────────

type Rule = [RegExp, (bindings: unknown[]) => unknown[]];

interface Statement {
  sql: string;
  bindings: unknown[];
}

function fakeDb(rules: Rule[]) {
  const batches: Statement[][] = [];
  const rowsFor = (sql: string, bindings: unknown[]) => rules.find(([re]) => re.test(sql))?.[1](bindings) ?? [];
  const db = {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => ({
        __stmt: { sql, bindings },
        async first() {
          return rowsFor(sql, bindings)[0] ?? null;
        },
        async all() {
          return { results: rowsFor(sql, bindings) };
        },
      });
      return { bind: (...bindings: unknown[]) => make(bindings), ...make([]) };
    },
    async batch(stmts: { __stmt: Statement }[]) {
      batches.push(stmts.map((s) => s.__stmt));
      return stmts.map(() => ({ success: true, results: [], meta: { changes: 1 } }));
    },
  } as unknown as D1Database;
  return { db, batches };
}

function envWith(db: D1Database): Env {
  return {
    DB_LEAGUE_LCAPB: db,
    DB_LEAGUE_LIDFPB: db,
    DB_LEAGUE_CTPB: db,
    SELF: { fetch: async () => new Response("") } as unknown as Fetcher,
  };
}

// ── Upstream HTML (made-up names and licences) ───────────────────────────────

const option = (value: string, label: string) => `<OPTION VALUE="${value}">${label}</OPTION>`;

function formHtml(specialties: [string, string][], categories: [string, string][]): string {
  return `<form action="classements.php" method="post">
    <SELECT NAME="InCompet">${option("20260501", "Championnat 2025-2026")}</SELECT>
    <SELECT NAME="InSpec">${specialties.map(([v, l]) => option(v, l)).join("")}</SELECT>
    <SELECT NAME="InCat">${option("0", "Toutes")}${categories.map(([v, l]) => option(v, l)).join("")}</SELECT>
  </form>`;
}

const team = (rank: number, noClub: string, club: string, equipe: number, phase: string, players: string) => `
  <tr>
    <th class="L0">${rank}<a href="./classements2.php?no_club=${noClub}&no_equipe=${equipe}"><img><a></th>
    <td class="L0">${phase}</td><td class="L0">${club}</td><td class="L0">${equipe}</td><td class="L0">${players}</td>
  </tr>`;

const RANKING_HTML = `<table class="mBloc"><tbody>
  ${team(1, "1339001", "PILOTA CLUB TEST", 1, "Champion", "<li>(000101) ETXEBERRI Ane</li><li>(000102 - 01-339-002) GARAT Beñat (E)</li>")}
  ${team(2, "1339009", "NEW CLUB", 3, "Finale", "<li>(000103) IRIGOIN Mikel</li>")}
</tbody></table>`;

// ── Upstream fetch ───────────────────────────────────────────────────────────

let posts: URLSearchParams[];
const realFetch = globalThis.fetch;

/** GET serves `form`; each POST serves `pageFor(InSpec, InCat)`. */
function serve(form: string, pageFor: (spec: string, cat: string) => string): void {
  posts = [];
  globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== "POST") return new Response(form);
    const body = new URLSearchParams(String(init.body));
    posts.push(body);
    return new Response(pageFor(body.get("InSpec")!, body.get("InCat")!));
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

// DB ids: competition 444 = 20260501, specialty 98 = "2", categories 881 = "1"
// and 882 = "2". Club 1339001 is known; 1339009 is not until it is inserted.
function lookups(knownClubs: { id: number; source_id: string; name: string }[]): Rule[] {
  return [
    [/FROM competitions WHERE id = \?/, ([id]) => (id === "444" ? [{ id: 444, source_id: "20260501", name: "Championnat 2025-2026" }] : [])],
    [/SELECT source_id FROM specialties WHERE id/, ([id]) => (id === "98" ? [{ source_id: "2" }] : [])],
    [/SELECT source_id FROM categories WHERE id/, ([id]) => (id === "881" ? [{ source_id: "1" }] : [])],
    [/FROM specialties WHERE source_id IN/, (ids) => (ids.includes("2") ? [{ id: 98, source_id: "2" }] : [])],
    [/FROM categories WHERE source_id IN/, (ids) =>
      [{ id: 881, source_id: "1" }, { id: 882, source_id: "2" }].filter((c) => ids.includes(c.source_id))],
    [/FROM clubs ORDER BY id/, () => knownClubs],
  ];
}

const FORM = formHtml([["2", "Trinquet / P.G. Pleine Masculin"]], [["1", "1ère Série"], ["2", "2ème Série"]]);
const options = (overrides: Partial<{ competition: string; specialty: string; category: string }> = {}) => ({
  league: "lcapb",
  competition: "444",
  specialty: "0",
  category: "0",
  ...overrides,
});

describe("scrapeRankings", () => {
  test("replaces each ranking that lists teams in one batch and leaves empty ones alone", async () => {
    serve(FORM, (_s, cat) => (cat === "1" ? RANKING_HTML : "<p>Pas de classement</p>"));
    const clubs = [
      { id: 10, source_id: "1339001", name: "PILOTA CLUB TEST" },
      { id: 11, source_id: "1339009", name: "NEW CLUB" },
    ];
    const { db, batches } = fakeDb(lookups(clubs));

    const summary = await scrapeRankings(envWith(db), options(), false);

    expect(summary).toMatchObject({ competition: "Championnat 2025-2026", found: 2, saved: 2 });
    expect(summary.pages.map((p) => [p.category, p.teams.length, p.skipped])).toEqual([
      ["1ère Série", 2, undefined],
      ["2ème Série", 0, "no ranking"],
    ]);
    expect(posts.map((b) => [b.get("InSpec"), b.get("InCat"), b.get("InPPoule")])).toEqual([
      ["2", "1", "2"],
      ["2", "2", "2"],
    ]);

    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch[0].sql).toContain("DELETE FROM ranking_players");
    expect(batch[0].bindings).toEqual([444, 98, 881]);
    expect(batch[1].sql).toContain("DELETE FROM rankings");
    expect(batch[2].bindings).toEqual([444, 98, 881, 10, 1, 1, "Champion"]);
    expect(batch[4].bindings).toEqual([444, 98, 881, 10, 1, 2, "000102", "GARAT Beñat", "GARAT BENAT", "01-339-002", "E"]);
    expect(batch[5].bindings).toEqual([444, 98, 881, 11, 3, 2, "Finale"]);
    expect(batch).toHaveLength(7);
    // Nothing touches the second category, whose page listed no team.
    expect(batch.some((s) => s.bindings.includes(882))).toBe(false);
  });

  test("inserts a club it does not know before saving the ranking", async () => {
    serve(FORM, (_s, cat) => (cat === "1" ? RANKING_HTML : ""));
    const clubs = [{ id: 10, source_id: "1339001", name: "PILOTA CLUB TEST" }];
    // The reload after the insert sees the new club.
    let loads = 0;
    const withReload = fakeDb([
      [/FROM clubs ORDER BY id/, () => (++loads === 1 ? clubs : [...clubs, { id: 12, source_id: "1339009", name: "NEW CLUB" }])],
      ...lookups(clubs),
    ]);

    await scrapeRankings(envWith(withReload.db), options({ category: "881" }), false);

    expect(withReload.batches[0]).toEqual([
      { sql: "INSERT OR IGNORE INTO clubs (source_id, name) VALUES (?, ?)", bindings: ["1339009", "NEW CLUB"] },
    ]);
    expect(withReload.batches[1].find((s) => s.bindings.includes("Finale"))?.bindings).toEqual([444, 98, 881, 12, 3, 2, "Finale"]);
  });

  test("passes the specialty and category filters to the site as source_ids", async () => {
    serve(FORM, () => "");
    const { db } = fakeDb(lookups([]));

    await scrapeRankings(envWith(db), options({ specialty: "98", category: "881" }), true);

    expect(posts.map((b) => [b.get("InCompet"), b.get("InSpec"), b.get("InCat")])).toEqual([["20260501", "2", "1"]]);
  });

  test("a dry run writes nothing", async () => {
    serve(FORM, () => RANKING_HTML);
    const { db, batches } = fakeDb(lookups([]));

    const summary = await scrapeRankings(envWith(db), options(), true);

    expect(summary).toMatchObject({ found: 4, saved: 0 });
    expect(batches).toEqual([]);
  });

  test("a category missing from the database is reported, not saved", async () => {
    serve(formHtml([["2", "Trinquet"]], [["7", "M16"]]), () => RANKING_HTML);
    const { db, batches } = fakeDb(lookups([]));

    const summary = await scrapeRankings(envWith(db), options(), false);

    expect(summary.pages[0].skipped).toBe(
      "category source_id 7 not in database; run /scrape_infos for competition 20260501"
    );
    expect(batches).toEqual([]);
  });

  test("refuses more pages than one invocation may fetch", async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i): [string, string] => [String(i + 1), `X${i + 1}`]);
    serve(formHtml(many(21), many(10)), () => "");
    const { db } = fakeDb(lookups([]));

    await expect(scrapeRankings(envWith(db), options(), true)).rejects.toThrow(
      "210 rankings (21 specialties × 10 categories) exceed the 35 pages one call may fetch; pass a specialty"
    );
  });

  test("an unknown competition fails before any upstream request", async () => {
    serve(FORM, () => "");
    const { db } = fakeDb(lookups([]));

    await expect(scrapeRankings(envWith(db), options({ competition: "9" }), true)).rejects.toThrow(
      "Competition with id '9' not found in database. Run /scrape_infos first."
    );
    expect(posts).toEqual([]);
  });
});

describe("nameKey", () => {
  test("upper-cases and strips accents and punctuation", () => {
    expect(nameKey("SAINT-JEAN Iñaki")).toBe("SAINT JEAN INAKI");
    expect(nameKey("  OÇAFRAIN  Beñat ")).toBe("OCAFRAIN BENAT");
  });
});
