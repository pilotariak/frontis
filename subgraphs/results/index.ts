import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, ResultRow } from "./db.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-results");

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async result(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<ResultRow | null> {
      return db
        .prepare("SELECT * FROM results WHERE id = ?")
        .bind(Number(id))
        .first<ResultRow>();
    },

    async results(
      _: unknown,
      {
        competitionId,
        specialtyId,
        categoryId,
        phase,
      }: {
        competitionId?: string;
        specialtyId?: string;
        categoryId?: string;
        phase?: string;
      },
      { db }: Context
    ): Promise<ResultRow[]> {
      const conditions: string[] = [];
      const bindings: (string | number)[] = [];

      if (competitionId) {
        conditions.push("competition_id = ?");
        bindings.push(Number(competitionId));
      }
      if (specialtyId) {
        conditions.push("specialty_id = ?");
        bindings.push(Number(specialtyId));
      }
      if (categoryId) {
        conditions.push("category_id = ?");
        bindings.push(Number(categoryId));
      }
      if (phase) {
        conditions.push("phase = ?");
        bindings.push(phase);
      }

      const sql = `SELECT * FROM results${
        conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
      }`;
      const { results } = await db.prepare(sql).bind(...bindings).all<ResultRow>();
      return results;
    },
  },

  Result: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<ResultRow | null> {
      return db
        .prepare("SELECT * FROM results WHERE id = ?")
        .bind(Number(ref.id))
        .first<ResultRow>();
    },

    // snake_case DB columns → camelCase GraphQL fields
    dateMatch: (row: ResultRow) => row.date_match,

    competition: (row: ResultRow) => ({ __typename: "Competition", id: String(row.competition_id) }),
    specialty: (row: ResultRow) => ({ __typename: "Specialty", id: String(row.specialty_id) }),
    category: (row: ResultRow) => row.category_id != null ? ({ __typename: "Category", id: String(row.category_id) }) : null,
    clubA: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_a_id) }),
    clubB: (row: ResultRow) => ({ __typename: "Club", id: String(row.club_b_id) }),

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
};

const schema_ = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-results")],
  context: ({ request, env }: { request: Request; env: Env }) => {
    const league = request.headers.get("x-pilotariak-league");
    if (!league) {
      throw new GraphQLError("Missing X-Pilotariak-League header", {
        extensions: { code: "BAD_REQUEST" },
      });
    }
    return { db: getDatabase(env, league) };
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
