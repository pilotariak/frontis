import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase, RANKING_SELECT } from "./db.js";
import type { Context, Env, PlayerRow, RankingRow } from "./db.js";
import { createGroupLoader, createRowLoader } from "./loader.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-rankings");

const typeDefs = parse(schema);

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

interface RankingKey {
  competitionId: string;
  specialtyId: string;
  categoryId: string;
}

interface PlayerFilters {
  licence?: string | null;
  name?: string | null;
  competitionId?: string | null;
  specialtyId?: string | null;
  categoryId?: string | null;
  limit?: number | null;
  offset?: number | null;
}

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

/** Parse a GraphQL ID into an integer primary key, rejecting garbage early. */
function toId(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw badInput(`Invalid ${name}: ${value}`);
  return n;
}

/**
 * Same normalisation as the scheduler applies to `ranking_players.name_key`:
 * upper case, no accents, punctuation turned into spaces.
 */
function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

async function queryRanking(db: D1Database, key: RankingKey): Promise<RankingRow[]> {
  const { results } = await db
    .prepare(
      `${RANKING_SELECT} WHERE r.competition_id = ? AND r.specialty_id = ? AND r.category_id = ? ORDER BY r.rank, r.id`
    )
    .bind(
      toId(key.competitionId, "competitionId"),
      toId(key.specialtyId, "specialtyId"),
      toId(key.categoryId, "categoryId")
    )
    .all<RankingRow>();
  return results;
}

async function queryPlayerRankings(db: D1Database, filters: PlayerFilters): Promise<RankingRow[]> {
  // Conditions on the player, all on the same ranking_players row.
  const playerConditions: string[] = [];
  const bindings: (string | number)[] = [];

  const licence = filters.licence?.trim();
  if (licence) {
    playerConditions.push("p.licence = ?");
    bindings.push(licence);
  }
  if (filters.name != null) {
    // Name words are [A-Z0-9]+ after normalisation, so they need no LIKE escaping.
    const words = nameKey(filters.name).split(" ").filter((w) => w.length >= 2);
    if (words.length === 0) throw badInput("name must contain a word of two characters or more");
    for (const word of words) {
      playerConditions.push("p.name_key LIKE ?");
      bindings.push(`%${word}%`);
    }
  }
  if (playerConditions.length === 0) throw badInput("Give a licence or a name");

  const conditions = [
    `r.id IN (SELECT p.ranking_id FROM ranking_players p WHERE ${playerConditions.join(" AND ")})`,
  ];
  if (filters.competitionId) {
    conditions.push("r.competition_id = ?");
    bindings.push(toId(filters.competitionId, "competitionId"));
  }
  if (filters.specialtyId) {
    conditions.push("r.specialty_id = ?");
    bindings.push(toId(filters.specialtyId, "specialtyId"));
  }
  if (filters.categoryId) {
    conditions.push("r.category_id = ?");
    bindings.push(toId(filters.categoryId, "categoryId"));
  }

  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);
  bindings.push(limit, offset);

  // Competition source_ids start with the season's end year (20260501 is
  // 2025-2026), so ordering by them puts the most recent season first.
  const sql = `${RANKING_SELECT}
    JOIN competitions c ON c.id = r.competition_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.source_id DESC, r.specialty_id, r.category_id, r.rank
    LIMIT ? OFFSET ?`;

  const { results } = await db.prepare(sql).bind(...bindings).all<RankingRow>();
  return results;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

const resolvers = {
  Query: {
    async teamRanking(_: unknown, { id }: { id: string }, { rankings }: Context): Promise<RankingRow | null> {
      return rankings.load(toId(id, "id"));
    },

    rankings(_: unknown, args: RankingKey, { db }: Context): Promise<RankingRow[]> {
      return queryRanking(db, args);
    },

    playerRankings(_: unknown, args: PlayerFilters, { db }: Context): Promise<RankingRow[]> {
      return queryPlayerRankings(db, args);
    },
  },

  TeamRanking: {
    // `async` so an invalid id rejects this entity only, instead of throwing
    // synchronously out of the whole `_entities` list.
    async __resolveReference(ref: { id: string }, { rankings }: Context): Promise<RankingRow | null> {
      return rankings.load(toId(ref.id, "id"));
    },

    competition: (row: RankingRow) => ({ __typename: "Competition", id: String(row.competition_id) }),
    specialty: (row: RankingRow) => ({ __typename: "Specialty", id: String(row.specialty_id) }),
    category: (row: RankingRow) => ({ __typename: "Category", id: String(row.category_id) }),
    club: (row: RankingRow) => ({ __typename: "Club", id: String(row.club_id) }),
    teamNumber: (row: RankingRow) => row.team_number,
    final: (row: RankingRow) => Boolean(row.final),
    players: (row: RankingRow, _: unknown, { players }: Context): Promise<PlayerRow[]> => players.load(row.id),
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-rankings")],
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
      rankings: createRowLoader<RankingRow>(db, RANKING_SELECT),
      players: createGroupLoader<PlayerRow>(
        db,
        "SELECT ranking_id, position, licence, name FROM ranking_players",
        "ranking_id",
        "ranking_id, position"
      ),
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
