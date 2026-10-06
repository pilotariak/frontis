import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import worker from "./index.js";
import type { Env, ResultRow } from "./db.js";

// Without OTEL_EXPORTER_OTLP_ENDPOINT, setupTracing() registers nothing and
// @envelop/opentelemetry falls back to a ConsoleSpanExporter that console.dir()s
// every span. Keep the test output readable.
let consoleDir: ReturnType<typeof spyOn>;
beforeAll(() => {
  consoleDir = spyOn(console, "dir").mockImplementation(() => {});
});
afterAll(() => consoleDir.mockRestore());

// ── Fake D1 ──────────────────────────────────────────────────────────────────
//
// Records every (sql, bindings) pair and answers from a fixed row set, so the
// tests can assert both the SQL the resolvers build and the GraphQL output.

interface Statement {
  sql: string;
  bindings: unknown[];
}

function fakeDb(rows: ResultRow[]) {
  const statements: Statement[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...bindings: unknown[]) {
          statements.push({ sql, bindings });
          const matches = sql.includes("WHERE id IN")
            ? rows.filter((r) => bindings.includes(r.id))
            : sql.includes("WHERE id = ?")
            ? rows.filter((r) => r.id === bindings[0])
            : rows;
          return {
            async first() {
              return matches[0] ?? null;
            },
            async all() {
              return { results: matches };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, statements };
}

function row(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    id: 1,
    competition_id: 10,
    specialty_id: 20,
    category_id: 30,
    date_match: "12/01/2026",
    club_a_id: 100,
    club_b_id: 200,
    scores: "15/10 15/13",
    phase: "Finale",
    club_a_player1_name: "A1",
    club_a_player1_number: "11",
    club_a_player2_name: null,
    club_a_player2_number: null,
    club_b_player1_name: "B1",
    club_b_player1_number: "21",
    club_b_player2_name: "B2",
    club_b_player2_number: "22",
    ...overrides,
  };
}

const TOKEN = "internal-secret";

function envWith(db: D1Database): Env {
  return {
    DB_LEAGUE_LCAPB: db,
    DB_LEAGUE_LIDFPB: db,
    DB_LEAGUE_CTPB: db,
    INTERNAL_SERVICE_TOKEN: TOKEN,
  };
}

async function graphql(
  env: Env,
  query: string,
  variables: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  const request = new Request("http://results.internal/graphql", {
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
      new Request("http://results.internal/graphql", { method: "POST" }),
      envWith(db),
      {} as ExecutionContext
    );
    expect(res.status).toBe(403);
  });

  test("rejects requests with a wrong internal token", async () => {
    const { db } = fakeDb([]);
    const { status, body } = await graphql(envWith(db), "{ __typename }", {}, {
      "x-internal-token": "nope",
    }).catch(() => ({ status: 403, body: null }));
    expect(status).toBe(403);
    expect(body).toBeNull();
  });

  test("errors when the league header is missing", async () => {
    const { db } = fakeDb([]);
    const { body } = await graphql(envWith(db), "{ results { id } }", {}, {
      "x-pilotariak-league": "",
    });
    expect(body.errors?.[0]?.message).toBe("Missing X-Pilotariak-League header");
    expect(body.errors?.[0]?.extensions?.code).toBe("BAD_REQUEST");
  });

  test("errors on an unknown league", async () => {
    const { db } = fakeDb([]);
    const { body } = await graphql(envWith(db), "{ results { id } }", {}, {
      "x-pilotariak-league": "nope",
    });
    expect(body.errors?.[0]?.message).toBe("Unknown league: nope");
    expect(body.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});

describe("Query.result", () => {
  test("maps a row to the GraphQL shape, including derived fields", async () => {
    const { db } = fakeDb([row()]);
    const { body } = await graphql(
      envWith(db),
      `query ($id: ID!) {
        result(id: $id) {
          id dateMatch scores phase
          competition { id } specialty { id } category { id }
          clubA { id } clubB { id }
          sets { a b }
          winner { id }
          clubALineup { player1 { name number } player2 { name number } }
          clubBLineup { player1 { name number } player2 { name number } }
        }
      }`,
      { id: "1" }
    );

    expect(body.errors).toBeUndefined();
    expect(body.data.result).toEqual({
      id: "1",
      dateMatch: "12/01/2026",
      scores: "15/10 15/13",
      phase: "Finale",
      competition: { id: "10" },
      specialty: { id: "20" },
      category: { id: "30" },
      clubA: { id: "100" },
      clubB: { id: "200" },
      sets: [{ a: 15, b: 10 }, { a: 15, b: 13 }],
      winner: { id: "100" },
      clubALineup: { player1: { name: "A1", number: "11" }, player2: null },
      clubBLineup: { player1: { name: "B1", number: "21" }, player2: { name: "B2", number: "22" } },
    });
  });

  test("returns null for an unknown id", async () => {
    const { db } = fakeDb([row()]);
    const { body } = await graphql(envWith(db), `{ result(id: "99") { id } }`);
    expect(body.errors).toBeUndefined();
    expect(body.data.result).toBeNull();
  });

  test("category is null when the row has no category", async () => {
    const { db } = fakeDb([row({ category_id: null })]);
    const { body } = await graphql(envWith(db), `{ result(id: "1") { category { id } } }`);
    expect(body.data.result.category).toBeNull();
  });

  test("rejects a non-integer id with BAD_USER_INPUT before touching the database", async () => {
    const { db, statements } = fakeDb([row()]);
    const { body } = await graphql(envWith(db), `{ result(id: "abc") { id } }`);
    expect(body.errors?.[0]?.message).toBe("Invalid id: abc");
    expect(body.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(statements).toEqual([]);
  });
});

describe("Result.sets and Result.winner", () => {
  const cases: [string, string | null, { a: number; b: number }[], string | null][] = [
    ["club A wins 2-0", "15/10 15/13", [{ a: 15, b: 10 }, { a: 15, b: 13 }], "100"],
    ["club B wins 2-1", "15/10 10/15 12/15", [{ a: 15, b: 10 }, { a: 10, b: 15 }, { a: 12, b: 15 }], "200"],
    ["tie yields no winner", "15/10 10/15", [{ a: 15, b: 10 }, { a: 10, b: 15 }], null],
    ["null scores", null, [], null],
    ["malformed tokens are skipped", "15/10 forfait 1/", [{ a: 15, b: 10 }], "100"],
    ["drawn set counts for nobody", "10/10", [{ a: 10, b: 10 }], null],
    ["extra whitespace is tolerated", "  15/10   15/9 ", [{ a: 15, b: 10 }, { a: 15, b: 9 }], "100"],
  ];

  for (const [label, scores, sets, winnerId] of cases) {
    test(label, async () => {
      const { db } = fakeDb([row({ scores })]);
      const { body } = await graphql(envWith(db), `{ result(id: "1") { sets { a b } winner { id } } }`);
      expect(body.errors).toBeUndefined();
      expect(body.data.result.sets).toEqual(sets);
      expect(body.data.result.winner).toEqual(winnerId ? { id: winnerId } : null);
    });
  }
});

describe("Query.results", () => {
  test("builds an unfiltered query with default paging", async () => {
    const { db, statements } = fakeDb([row({ id: 1 }), row({ id: 2 })]);
    const { body } = await graphql(envWith(db), `{ results { id } }`);

    expect(body.data.results).toEqual([{ id: "1" }, { id: "2" }]);
    expect(statements).toEqual([
      { sql: "SELECT * FROM results ORDER BY id LIMIT ? OFFSET ?", bindings: [100, 0] },
    ]);
  });

  test("combines every filter with AND and binds ids as integers", async () => {
    const { db, statements } = fakeDb([]);
    await graphql(
      envWith(db),
      `{ results(competitionId: "10", specialtyId: "20", categoryId: "30", clubId: "100", phase: "Finale", limit: 5, offset: 7) { id } }`
    );

    expect(statements).toEqual([
      {
        sql:
          "SELECT * FROM results WHERE competition_id = ? AND specialty_id = ? AND category_id = ? AND (club_a_id = ? OR club_b_id = ?) AND phase = ? ORDER BY id LIMIT ? OFFSET ?",
        bindings: [10, 20, 30, 100, 100, "Finale", 5, 7],
      },
    ]);
  });

  test("clamps limit to 1..500 and offset to >= 0", async () => {
    const { db, statements } = fakeDb([]);
    await graphql(envWith(db), `{ results(limit: 9999, offset: -3) { id } }`);
    await graphql(envWith(db), `{ results(limit: 0) { id } }`);

    expect(statements.map((s) => s.bindings)).toEqual([
      [500, 0],
      [1, 0],
    ]);
  });

  test("rejects a garbage filter id", async () => {
    const { db, statements } = fakeDb([]);
    const { body } = await graphql(envWith(db), `{ results(clubId: "-1") { id } }`);
    expect(body.errors?.[0]?.message).toBe("Invalid clubId: -1");
    expect(statements).toEqual([]);
  });
});

describe("entity resolution", () => {
  test("resolves several Result representations with one IN query", async () => {
    const { db, statements } = fakeDb([row({ id: 1 }), row({ id: 2 }), row({ id: 3 })]);
    const { body } = await graphql(
      envWith(db),
      `query ($reps: [_Any!]!) { _entities(representations: $reps) { ... on Result { id phase } } }`,
      {
        reps: [
          { __typename: "Result", id: "3" },
          { __typename: "Result", id: "1" },
          { __typename: "Result", id: "42" },
        ],
      }
    );

    expect(body.errors).toBeUndefined();
    expect(body.data._entities).toEqual([
      { id: "3", phase: "Finale" },
      { id: "1", phase: "Finale" },
      null,
    ]);
    expect(statements).toEqual([
      { sql: "SELECT * FROM results WHERE id IN (?, ?, ?)", bindings: [3, 1, 42] },
    ]);
  });

  test("an invalid representation id fails only that entity", async () => {
    const { db } = fakeDb([row({ id: 1 })]);
    const { body } = await graphql(
      envWith(db),
      `query ($reps: [_Any!]!) { _entities(representations: $reps) { ... on Result { id } } }`,
      { reps: [{ __typename: "Result", id: "1" }, { __typename: "Result", id: "x" }] }
    );

    expect(body.data._entities).toEqual([{ id: "1" }, null]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBe("Invalid id: x");
  });

  test("reverse edges query results for the owning entity", async () => {
    const { db, statements } = fakeDb([row({ id: 7 })]);
    const { body } = await graphql(
      envWith(db),
      `query ($reps: [_Any!]!) {
        _entities(representations: $reps) {
          ... on Club { results(limit: 2) { id } }
          ... on Specialty { results { id } }
          ... on Category { results { id } }
        }
      }`,
      {
        reps: [
          { __typename: "Club", id: "100" },
          { __typename: "Specialty", id: "20" },
          { __typename: "Category", id: "30" },
        ],
      }
    );

    expect(body.errors).toBeUndefined();
    expect(body.data._entities).toEqual([
      { results: [{ id: "7" }] },
      { results: [{ id: "7" }] },
      { results: [{ id: "7" }] },
    ]);
    expect(statements.map((s) => [s.sql, s.bindings])).toEqual([
      ["SELECT * FROM results WHERE (club_a_id = ? OR club_b_id = ?) ORDER BY id LIMIT ? OFFSET ?", [100, 100, 2, 0]],
      ["SELECT * FROM results WHERE specialty_id = ? ORDER BY id LIMIT ? OFFSET ?", [20, 100, 0]],
      ["SELECT * FROM results WHERE category_id = ? ORDER BY id LIMIT ? OFFSET ?", [30, 100, 0]],
    ]);
  });
});
