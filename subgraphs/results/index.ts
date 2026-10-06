import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, ResultRow } from "./db.js";
import { createRowLoader } from "./loader.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-results");

const typeDefs = parse(schema);

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

interface PageArgs {
  limit?: number | null;
  offset?: number | null;
}

interface ResultFilters extends PageArgs {
  competitionId?: string | null;
  specialtyId?: string | null;
  categoryId?: string | null;
  clubId?: string | null;
  phase?: string | null;
}

/** Parse a GraphQL ID into an integer primary key, rejecting garbage early. */
function toId(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new GraphQLError(`Invalid ${name}: ${value}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return n;
}

function page({ limit, offset }: PageArgs): { limit: number; offset: number } {
  const l = limit ?? DEFAULT_LIMIT;
  const o = offset ?? 0;
  return {
    limit: Math.min(Math.max(l, 1), MAX_LIMIT),
    offset: Math.max(o, 0),
  };
}

async function queryResults(db: D1Database, filters: ResultFilters): Promise<ResultRow[]> {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (filters.competitionId) {
    conditions.push("competition_id = ?");
    bindings.push(toId(filters.competitionId, "competitionId"));
  }
  if (filters.specialtyId) {
    conditions.push("specialty_id = ?");
    bindings.push(toId(filters.specialtyId, "specialtyId"));
  }
  if (filters.categoryId) {
    conditions.push("category_id = ?");
    bindings.push(toId(filters.categoryId, "categoryId"));
  }
  if (filters.clubId) {
    const id = toId(filters.clubId, "clubId");
    conditions.push("(club_a_id = ? OR club_b_id = ?)");
    bindings.push(id, id);
  }
  if (filters.phase) {
    conditions.push("phase = ?");
    bindings.push(filters.phase);
  }

  const { limit, offset } = page(filters);
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM results${where} ORDER BY id LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);

  const { results } = await db.prepare(sql).bind(...bindings).all<ResultRow>();
  return results;
}

// ---------------------------------------------------------------------------
// Score parsing
// ---------------------------------------------------------------------------

interface SetScore {
  a: number;
  b: number;
}

/** "15/10 15/13" → [{a:15,b:10},{a:15,b:13}]. Malformed tokens are skipped. */
function parseSets(scores: string | null): SetScore[] {
  if (!scores) return [];
  const sets: SetScore[] = [];
  for (const token of scores.trim().split(/\s+/)) {
    const m = /^(\d+)\/(\d+)$/.exec(token);
    if (!m) continue;
    sets.push({ a: Number(m[1]), b: Number(m[2]) });
  }
  return sets;
}

function winnerRef(row: ResultRow): { __typename: "Club"; id: string } | null {
  let a = 0;
  let b = 0;
  for (const set of parseSets(row.scores)) {
    if (set.a > set.b) a++;
    else if (set.b > set.a) b++;
  }
  if (a === b) return null;
  return { __typename: "Club", id: String(a > b ? row.club_a_id : row.club_b_id) };
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

const resolvers = {
  Query: {
    async result(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<ResultRow | null> {
      return db
        .prepare("SELECT * FROM results WHERE id = ?")
        .bind(toId(id, "id"))
        .first<ResultRow>();
    },

    results(_: unknown, args: ResultFilters, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, args);
    },
  },

  Result: {
    // Batched: every representation in one `_entities` query is resolved by
    // a single `WHERE id IN (...)` statement (see loader.ts).
    // `async` so an invalid id rejects this entity only, instead of throwing
    // synchronously out of the whole `_entities` list.
    async __resolveReference(
      ref: { id: string },
      { results }: Context
    ): Promise<ResultRow | null> {
      return results.load(toId(ref.id, "id"));
    },

    // snake_case DB columns → camelCase GraphQL fields
    dateMatch: (row: ResultRow) => row.date_match,

    competition: (row: ResultRow) => ({ __typename: "Competition", id: String(row.competition_id) }),
    specialty: (row: ResultRow) => ({ __typename: "Specialty", id: String(row.specialty_id) }),
    category: (row: ResultRow) =>
      row.category_id != null ? { __typename: "Category", id: String(row.category_id) } : null,
    clubA: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_a_id) }),
    clubB: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_b_id) }),

    sets: (row: ResultRow) => parseSets(row.scores),
    winner: (row: ResultRow) => winnerRef(row),

    clubALineup(row: ResultRow) {
      return {
        player1: row.club_a_player1_name
          ? { name: row.club_a_player1_name, number: row.club_a_player1_number }
          : null,
        player2: row.club_a_player2_name
          ? { name: row.club_a_player2_name, number: row.club_a_player2_number }
          : null,
      };
    },

    clubBLineup(row: ResultRow) {
      return {
        player1: row.club_b_player1_name
          ? { name: row.club_b_player1_name, number: row.club_b_player1_number }
          : null,
        player2: row.club_b_player2_name
          ? { name: row.club_b_player2_name, number: row.club_b_player2_number }
          : null,
      };
    },
  },

  // Reverse edges contributed to entities owned by other subgraphs. The
  // gateway hands us `{ id }` representations; no __resolveReference is
  // needed because @apollo/subgraph returns the representation as-is.
  Club: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, clubId: ref.id });
    },
  },

  Specialty: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, specialtyId: ref.id });
    },
  },

  Category: {
    results(ref: { id: string }, args: PageArgs, { db }: Context): Promise<ResultRow[]> {
      return queryResults(db, { ...args, categoryId: ref.id });
    },
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-results")],
  context: ({ request, env }) => {
    const league = request.headers.get("x-pilotariak-league");
    if (!league) {
      throw new GraphQLError("Missing X-Pilotariak-League header", {
        extensions: { code: "BAD_REQUEST" },
      });
    }
    const db = getDatabase(env, league);
    return {
      db,
      results: createRowLoader<ResultRow>(db, "SELECT * FROM results"),
    };
  },
});

const yogaFetch = withHttpMetrics((request: Request, env: Env, ctx: ExecutionContext) =>
  yoga.fetch(request, { env }, ctx)
);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.headers.get("x-internal-token") !== env.INTERNAL_SERVICE_TOKEN) {
      return new Response("Forbidden", { status: 403 });
    }
    return yogaFetch(request, env, ctx);
  },
};
