import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import worker from "./index.js";
import type { Env, PlayerRow, RankingRow } from "./db.js";

// Without OTEL_EXPORTER_OTLP_ENDPOINT, @envelop/opentelemetry falls back to a
// ConsoleSpanExporter that console.dir()s every span. Keep the output readable.
let consoleDir: ReturnType<typeof spyOn>;
beforeAll(() => {
  consoleDir = spyOn(console, "dir").mockImplementation(() => {});
});
afterAll(() => consoleDir.mockRestore());

// ── Fake D1 ──────────────────────────────────────────────────────────────────
//
// Records every (sql, bindings) pair. Statements on ranking_players answer
// with the players of the ranking ids bound; every other statement answers
// with the ranking rows (filtered by id for the loader's `WHERE id IN`).

interface Statement {
  sql: string;
  bindings: unknown[];
}

function fakeDb(rankings: RankingRow[], players: PlayerRow[] = []) {
  const statements: Statement[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          statements.push({ sql, bindings });
          const rows = sql.includes("FROM ranking_players WHERE ranking_id IN")
            ? players.filter((p) => bindings.includes(p.ranking_id))
            : sql.includes("WHERE id IN")
            ? rankings.filter((r) => bindings.includes(r.id))
            : rankings;
          return {
            async all() {
              return { results: rows };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements };
}

function ranking(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    id: 1,
    competition_id: 444,
    specialty_id: 98,
    category_id: 881,
    club_id: 10,
    team_number: 1,
    rank: 1,
    phase: "Champion",
    final: 1,
    ...overrides,
  };
}

const PLAYERS: PlayerRow[] = [
  { ranking_id: 1, position: 1, licence: "000101", name: "ETXEBERRI Ane" },
  { ranking_id: 1, position: 2, licence: "000102", name: null },
  { ranking_id: 2, position: 1, licence: "000103", name: "IRIGOIN Mikel" },
];

const TOKEN = "internal-secret";

function envWith(db: D1Database): Env {
  return { DB_LEAGUE_LCAPB: db, DB_LEAGUE_LIDFPB: db, DB_LEAGUE_CTPB: db, DB_LEAGUE_LLPB: db, DB_LEAGUE_FFPB: db, INTERNAL_SERVICE_TOKEN: TOKEN };
}

async function graphql(env: Env, query: string, variables: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const request = new Request("http://rankings.internal/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": TOKEN,
      "x-pilotariak-league": "lcapb",
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const response = await worker.fetch(request, env, {} as ExecutionContext);
  return { status: response.status, body: (await response.json()) as any };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("worker gate", () => {
  test("rejects requests without the internal token", async () => {
    const { db } = fakeDb([]);
    const res = await worker.fetch(
      new Request("http://rankings.internal/graphql", { method: "POST" }),
      envWith(db),
      {} as ExecutionContext
    );
    expect(res.status).toBe(403);
  });

  test("errors when the league header is missing", async () => {
    const { db } = fakeDb([]);
    const { body } = await graphql(envWith(db), "{ teamRanking(id: 1) { id } }", {}, { "x-pilotariak-league": "" });
    expect(body.errors?.[0]?.message).toBe("Missing X-Pilotariak-League header");
  });
});

describe("Query.rankings", () => {
  const QUERY = `{
    rankings(competitionId: 444, specialtyId: 98, categoryId: 881) {
      id rank phase final teamNumber
      club { id } competition { id } specialty { id } category { id }
      players { licence name }
    }
  }`;

  test("reads one ranking ordered by rank, with its players in one statement", async () => {
    const { db, statements } = fakeDb(
      [ranking(), ranking({ id: 2, club_id: 11, team_number: 3, rank: 2, phase: "Finale" })],
      PLAYERS
    );
    const { body } = await graphql(envWith(db), QUERY);

    expect(body.errors).toBeUndefined();
    expect(body.data.rankings).toEqual([
      {
        id: "1", rank: 1, phase: "Champion", final: true, teamNumber: 1,
        club: { id: "10" }, competition: { id: "444" }, specialty: { id: "98" }, category: { id: "881" },
        players: [{ licence: "000101", name: "ETXEBERRI Ane" }, { licence: "000102", name: null }],
      },
      {
        id: "2", rank: 2, phase: "Finale", final: true, teamNumber: 3,
        club: { id: "11" }, competition: { id: "444" }, specialty: { id: "98" }, category: { id: "881" },
        players: [{ licence: "000103", name: "IRIGOIN Mikel" }],
      },
    ]);

    expect(statements[0].sql).toContain("WHERE r.competition_id = ? AND r.specialty_id = ? AND r.category_id = ? ORDER BY r.rank");
    expect(statements[0].bindings).toEqual([444, 98, 881]);
    expect(statements).toHaveLength(2);
    expect(statements[1].sql).toBe(
      "SELECT ranking_id, position, licence, name FROM ranking_players WHERE ranking_id IN (?, ?) ORDER BY ranking_id, position"
    );
    expect(statements[1].bindings).toEqual([1, 2]);
  });

  test("reports a provisional ranking as not final", async () => {
    const { db } = fakeDb([ranking({ phase: "1/2 finale", final: 0 })]);
    const { body } = await graphql(envWith(db), QUERY);
    expect(body.data.rankings[0]).toMatchObject({ phase: "1/2 finale", final: false, players: [] });
  });

  test("rejects a malformed id", async () => {
    const { db } = fakeDb([]);
    const { body } = await graphql(envWith(db), `{ rankings(competitionId: "x", specialtyId: 1, categoryId: 1) { id } }`);
    expect(body.errors?.[0]?.message).toBe("Invalid competitionId: x");
  });
});

describe("Query.playerRankings", () => {
  test("finds a player by exact licence, most recent season first", async () => {
    const { db, statements } = fakeDb([ranking()]);
    const { body } = await graphql(envWith(db), `{ playerRankings(licence: " 000101 ") { id } }`);

    expect(body.data.playerRankings).toEqual([{ id: "1" }]);
    const { sql, bindings } = statements[0];
    expect(sql).toContain("r.id IN (SELECT p.ranking_id FROM ranking_players p WHERE p.licence = ?)");
    expect(sql).toContain("ORDER BY c.source_id DESC");
    expect(bindings).toEqual(["000101", 100, 0]);
  });

  test("matches every name word, ignoring case, accents, order and one-letter words", async () => {
    const { db, statements } = fakeDb([]);
    await graphql(envWith(db), `{ playerRankings(name: "beñat  d'garat") { id } }`);

    expect(statements[0].sql).toContain("WHERE p.name_key LIKE ? AND p.name_key LIKE ?)");
    expect(statements[0].bindings).toEqual(["%BENAT%", "%GARAT%", 100, 0]);
  });

  test("combines the player with ranking filters and clamps the page", async () => {
    const { db, statements } = fakeDb([]);
    await graphql(
      envWith(db),
      `{ playerRankings(licence: "000101", name: "Ane", competitionId: 444, specialtyId: 98, categoryId: 881, limit: 9999, offset: -3) { id } }`
    );

    expect(statements[0].sql).toContain("p.licence = ? AND p.name_key LIKE ?)");
    expect(statements[0].sql).toContain("AND r.competition_id = ? AND r.specialty_id = ? AND r.category_id = ?");
    expect(statements[0].bindings).toEqual(["000101", "%ANE%", 444, 98, 881, 500, 0]);
  });

  test("requires a licence or a name", async () => {
    const { db, statements } = fakeDb([]);
    const { body } = await graphql(envWith(db), `{ playerRankings { id } }`);
    expect(body.errors?.[0]?.message).toBe("Give a licence or a name");
    expect(body.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(statements).toEqual([]);
  });

  test("rejects a name with no word of two characters", async () => {
    const { db } = fakeDb([]);
    const { body } = await graphql(envWith(db), `{ playerRankings(name: " - a ") { id } }`);
    expect(body.errors?.[0]?.message).toBe("name must contain a word of two characters or more");
  });
});

describe("TeamRanking entity", () => {
  test("resolves representations in one batched statement", async () => {
    const { db, statements } = fakeDb([ranking(), ranking({ id: 2, rank: 2 })]);
    const { body } = await graphql(
      envWith(db),
      `query ($r: [_Any!]!) { _entities(representations: $r) { ... on TeamRanking { id rank } } }`,
      { r: [{ __typename: "TeamRanking", id: "2" }, { __typename: "TeamRanking", id: "1" }] }
    );

    expect(body.data._entities).toEqual([{ id: "2", rank: 2 }, { id: "1", rank: 1 }]);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toEndWith("FROM rankings r WHERE id IN (?, ?)");
  });
});
