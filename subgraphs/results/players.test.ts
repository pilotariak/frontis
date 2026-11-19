import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import worker from "./index.js";
import type { Env } from "./db.js";
import { lineupPlayer, matchups, tally, type Match } from "./players.js";
import { winnerSide } from "./scores.js";

// See index.test.ts: keep the ConsoleSpanExporter quiet.
let consoleDir: ReturnType<typeof spyOn>;
beforeAll(() => {
  consoleDir = spyOn(console, "dir").mockImplementation(() => {});
});
afterAll(() => consoleDir.mockRestore());

describe("winnerSide", () => {
  test.each([
    ["15/10 15/13", "A"],
    ["10/15 15/10 12/15", "B"],
    ["15/10 10/15 15/12", "A"],
    ["40/35", "A"],
    ["30/40", "B"],
    ["15/10 10/15", null],
    ["15/15", null],
    ["forfait", null],
    [null, null],
  ] as const)("%p → %p", (scores, side) => {
    expect(winnerSide(scores)).toBe(side);
  });
});

describe("lineupPlayer", () => {
  test("drops the licence club and the marker, as result_players stores them", () => {
    expect(lineupPlayer("PRADERE Bastien (S)", "097866 - 01-641-015")).toEqual({
      licence: "097866",
      name: "PRADERE Bastien",
    });
    expect(lineupPlayer("HIRIART  D'OYHARÇABAL Iñaki", "000101")).toEqual({
      licence: "000101",
      name: "HIRIART D'OYHARÇABAL Iñaki",
    });
    expect(lineupPlayer("NOBODY Jon", null)).toBeNull();
    expect(lineupPlayer("NOBODY Jon", " ")).toBeNull();
  });
});

describe("tally", () => {
  const match = (scores: string | null, side: "A" | "B"): Match => ({
    resultId: 1, competitionId: 1, specialtyId: 1, categoryId: 1, season: "20260501", scores, side, others: [],
  });

  test("counts sets and points from the player's side, with two and three sets", () => {
    expect(tally([match("15/10 15/13", "A"), match("15/10 10/15 15/12", "B")])).toEqual({
      played: 2, won: 1, lost: 1, setsWon: 3, setsLost: 2, pointsFor: 67, pointsAgainst: 63,
    });
  });

  test("counts a match with no score, or a tied set count, as played only", () => {
    expect(tally([match(null, "A"), match("15/10 10/15", "B"), match("", "A")])).toEqual({
      played: 3, won: 0, lost: 0, setsWon: 1, setsLost: 1, pointsFor: 25, pointsAgainst: 25,
    });
  });
});

describe("matchups", () => {
  test("splits partners from opponents and keeps the latest name", () => {
    const matches: Match[] = [
      { resultId: 1, competitionId: 1, specialtyId: 1, categoryId: 1, season: null, scores: "15/10", side: "A",
        others: [{ licence: "2", name: "OLD Name", side: "A" }, { licence: "9", name: "OPP", side: "B" }] },
      { resultId: 2, competitionId: 1, specialtyId: 1, categoryId: 1, season: null, scores: "10/15", side: "B",
        others: [{ licence: "2", name: "NEW Name", side: "B" }, { licence: "9", name: null, side: "A" }] },
    ];
    expect(matchups(matches, "partners")).toEqual([{ licence: "2", name: "NEW Name", played: 2, won: 2, lost: 0 }]);
    expect(matchups(matches, "opponents")).toEqual([{ licence: "9", name: "OPP", played: 2, won: 2, lost: 0 }]);
  });
});

// ── GraphQL, on real SQLite ──────────────────────────────────────────────────
//
// A D1 adapter over bun:sqlite with every migration applied, so the resolvers'
// SQL runs for real and result_players comes from the 0013 backfill.

const MIGRATIONS = join(import.meta.dir, "../../database/migrations");

function sqliteD1(sqlite: Database) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      const make = (bindings: unknown[]) => ({
        async first() {
          statements.push(sql);
          return sqlite.query(sql).get(...(bindings as string[])) ?? null;
        },
        async all() {
          statements.push(sql);
          return { results: sqlite.query(sql).all(...(bindings as string[])) };
        },
      });
      return { bind: (...bindings: unknown[]) => make(bindings), ...make([]) };
    },
  } as unknown as D1Database;
  return { db, statements };
}

type Lineup = [string, string] | null;

function seed(): Database {
  const sqlite = new Database(":memory:");
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files.filter((f) => f < "0013")) sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  sqlite.exec(`
    INSERT INTO competitions (id, source_id, name) VALUES (1, '20250501', 'Championnat 2025'), (2, '20260501', 'Championnat 2026');
    INSERT INTO specialties (id, name) VALUES (1, 'Trinquet'), (2, 'Main Nue');
    INSERT INTO categories (id, source_id, name) VALUES (1, 'C1', 'Seniors'), (2, 'C2', 'Cadets');
    INSERT INTO clubs (id, name) VALUES (100, 'CA BEGLAIS'), (200, 'HASPARREN');
  `);
  const insert = sqlite.query(
    `INSERT INTO results (id, competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id, scores, phase,
       club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
       club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Poule', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const add = (
    id: number, competition: number, specialty: number, category: number, date: string,
    clubs: [number, number], scores: string | null, lineups: [Lineup, Lineup, Lineup, Lineup]
  ) => insert.run(id, competition, specialty, category, date, clubs[0], clubs[1], scores, ...lineups.flatMap((l) => l ?? [null, null]));

  const ane: Lineup = ["ETXEBERRI Ane (S)", "000101"];
  const manex: Lineup = ["DUPRÉ Mañex", "000102 - 01-330-005"];
  const opp1: Lineup = ["OPPOSANT Un", "000201"];
  const opp2: Lineup = ["OPPOSANT Deux", "000202"];
  add(1, 2, 1, 1, "12/01/2026", [100, 200], "15/10 15/13", [ane, manex, opp1, opp2]);
  add(2, 2, 1, 1, "05/02/2026", [200, 100], "15/10 10/15 15/12", [["AUTRE Un", "000301"], ["AUTRE Deux", "000302"], ane, manex]);
  add(3, 1, 2, 2, "20/03/2025", [100, 200], null, [ane, ["BAT Peio", "000103"], opp1, null]);
  add(4, 2, 1, 1, "01/12/2025", [100, 200], "40/35", [ane, manex, opp1, opp2]);
  // Two teams of the same club: the winner is the side, not the club.
  add(5, 2, 1, 1, "10/02/2026", [100, 100], "30/40", [["ETXEBERRI Ane (E)", "000101"], null, ["SOLO Jon", "000401"], null]);

  sqlite.exec(readFileSync(join(MIGRATIONS, "0013_result_players.sql"), "utf8"));
  for (const file of files.filter((f) => f > "0013")) sqlite.exec(readFileSync(join(MIGRATIONS, file), "utf8"));

  // A player found in a ranking only.
  sqlite.exec(`
    INSERT INTO rankings (id, competition_id, specialty_id, category_id, club_id, team_number, rank, phase)
      VALUES (1, 2, 1, 1, 100, 1, 1, 'Champion');
    INSERT INTO ranking_players (ranking_id, position, licence, name, name_key) VALUES (1, 1, '999999', 'CLASSE Seul', 'CLASSE SEUL');
  `);
  return sqlite;
}

const TOKEN = "internal-secret";

async function graphql(db: D1Database, query: string, variables: Record<string, unknown> = {}) {
  const env: Env = {
    DB_LEAGUE_LCAPB: db, DB_LEAGUE_LIDFPB: db, DB_LEAGUE_CTPB: db, DB_LEAGUE_LLPB: db,
    INTERNAL_SERVICE_TOKEN: TOKEN,
  };
  const request = new Request("http://results.internal/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-token": TOKEN, "x-pilotariak-league": "lcapb" },
    body: JSON.stringify({ query, variables }),
  });
  const response = await worker.fetch(request, env, {} as ExecutionContext);
  return (await response.json()) as any;
}

describe("Player", () => {
  const sqlite = seed();

  test("player(licence) returns the statistics of every match", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      player(licence: "000101") {
        licence name
        stats {
          played won lost setsWon setsLost pointsFor pointsAgainst
          breakdown { competition { id } specialty { id } category { id } played won lost }
        }
      }
    }`);
    expect(body.errors).toBeUndefined();
    expect(body.data.player).toEqual({
      licence: "000101",
      name: "ETXEBERRI Ane",
      stats: {
        played: 5, won: 2, lost: 2, setsWon: 4, setsLost: 3, pointsFor: 137, pointsAgainst: 138,
        breakdown: [
          { competition: { id: "2" }, specialty: { id: "1" }, category: { id: "1" }, played: 4, won: 2, lost: 2 },
          { competition: { id: "1" }, specialty: { id: "2" }, category: { id: "2" }, played: 1, won: 0, lost: 0 },
        ],
      },
    });
  });

  test("filters statistics, partners and opponents by competition, specialty and category", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      player(licence: "000101") {
        stats(competitionId: "1") { played }
        partners(specialtyId: "2") { player { licence } }
        opponents(categoryId: "2") { player { licence } }
      }
    }`);
    expect(body.data.player).toEqual({
      stats: { played: 1 },
      partners: [{ player: { licence: "000103" } }],
      opponents: [{ player: { licence: "000201" } }],
    });
  });

  test("partners and opponents count the matches played together or against", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      player(licence: "000101") {
        partners { player { licence name } played won lost }
        opponents { player { licence } played won lost }
      }
    }`);
    expect(body.data.player.partners).toEqual([
      { player: { licence: "000102", name: "DUPRÉ Mañex" }, played: 3, won: 2, lost: 1 },
      { player: { licence: "000103", name: "BAT Peio" }, played: 1, won: 0, lost: 0 },
    ]);
    expect(body.data.player.opponents).toEqual([
      { player: { licence: "000201" }, played: 3, won: 2, lost: 0 },
      { player: { licence: "000202" }, played: 2, won: 2, lost: 0 },
      { player: { licence: "000302" }, played: 1, won: 0, lost: 1 },
      { player: { licence: "000301" }, played: 1, won: 0, lost: 1 },
      { player: { licence: "000401" }, played: 1, won: 0, lost: 1 },
    ]);
  });

  test("results lists the player's matches, most recent first", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      player(licence: "000101") {
        all: results { id }
        page: results(limit: 2, offset: 1) { id }
        season2025: results(competitionId: "1") { id }
      }
    }`);
    expect(body.data.player).toEqual({
      all: [{ id: "5" }, { id: "2" }, { id: "1" }, { id: "4" }, { id: "3" }],
      page: [{ id: "2" }, { id: "1" }],
      season2025: [{ id: "3" }],
    });
  });

  test("player(licence) finds a player known from a ranking only, and nobody else", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      ranked: player(licence: "999999") { licence name stats { played } partners { played } }
      unknown: player(licence: "000000") { licence }
    }`);
    expect(body.data).toEqual({
      ranked: { licence: "999999", name: "CLASSE Seul", stats: { played: 0 }, partners: [] },
      unknown: null,
    });
  });

  test("players(name) matches regardless of case, accents and word order", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      ane: players(name: "ane ETXEBERRI") { licence name }
      dupre: players(name: "dupre") { licence name }
      opposants: players(name: "Opposant") { licence name }
    }`);
    expect(body.data).toEqual({
      ane: [{ licence: "000101", name: "ETXEBERRI Ane" }],
      dupre: [{ licence: "000102", name: "DUPRÉ Mañex" }],
      opposants: [
        { licence: "000202", name: "OPPOSANT Deux" },
        { licence: "000201", name: "OPPOSANT Un" },
      ],
    });
  });

  test("players(name) rejects a name without a word of two characters", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{ players(name: "a -") { licence } }`);
    expect(body.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });

  test("loads the matches of every player of a list in one statement", async () => {
    const { db, statements } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      players(name: "opposant") { licence stats { played } partners { played } opponents { played } }
    }`);
    expect(body.data.players.map((p: any) => [p.licence, p.stats.played])).toEqual([["000202", 2], ["000201", 3]]);
    expect(statements.filter((s) => s.includes("FROM result_players me"))).toHaveLength(1);
  });

  test("a lineup player links to the Player of its licence", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      result(id: "1") {
        clubALineup {
          player1 { name number player { licence name } }
          player2 { number player { licence } }
        }
      }
    }`);
    expect(body.data.result.clubALineup).toEqual({
      player1: { name: "ETXEBERRI Ane (S)", number: "000101", player: { licence: "000101", name: "ETXEBERRI Ane" } },
      player2: { number: "000102 - 01-330-005", player: { licence: "000102" } },
    });
  });

  test("resolves Player representations sent by the gateway", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{
      _entities(representations: [
        { __typename: "Player", licence: "000102" },
        { __typename: "Player", licence: "000000" }
      ]) { ... on Player { licence name stats { played } } }
    }`);
    expect(body.data._entities).toEqual([
      { licence: "000102", name: "DUPRÉ Mañex", stats: { played: 3 } },
      null,
    ]);
  });

  test("Result.winner is the club of the winning side, for two teams of one club too", async () => {
    const { db } = sqliteD1(sqlite);
    const body = await graphql(db, `{ a: result(id: "2") { winner { id } } b: result(id: "5") { winner { id } } }`);
    expect(body.data).toEqual({ a: { winner: { id: "200" } }, b: { winner: { id: "100" } } });
  });
});
