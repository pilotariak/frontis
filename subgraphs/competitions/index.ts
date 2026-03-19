import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { CompetitionRow, Context, Env } from "./db.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-competitions");

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async competition(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<CompetitionRow | null> {
      return db
        .prepare("SELECT id, source_id, name FROM competitions WHERE id = ?")
        .bind(Number(id))
        .first<CompetitionRow>();
    },

    async competitions(
      _: unknown,
      _args: unknown,
      { db }: Context
    ): Promise<CompetitionRow[]> {
      const { results } = await db
        .prepare("SELECT id, source_id, name FROM competitions")
        .all<CompetitionRow>();
      return results;
    },
  },

  Competition: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<CompetitionRow | null> {
      return db
        .prepare("SELECT id, source_id, name FROM competitions WHERE id = ?")
        .bind(Number(ref.id))
        .first<CompetitionRow>();
    },

    async results(
      competition: CompetitionRow | { id: string },
      _args: unknown,
      { db }: Context
    ): Promise<{ __typename: string; id: string }[]> {
      const { results } = await db
        .prepare("SELECT id FROM results WHERE competition_id = ?")
        .bind(Number(competition.id))
        .all<{ id: number }>();
      return results.map((r) => ({ __typename: "Result", id: String(r.id) }));
    },
  },
};

const schema_ = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-competitions")],
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
