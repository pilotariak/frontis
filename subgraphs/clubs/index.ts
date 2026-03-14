import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { ClubRow, Context, Env } from "./db.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-clubs");

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async club(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<ClubRow | null> {
      return db
        .prepare("SELECT id, name FROM clubs WHERE id = ?")
        .bind(Number(id))
        .first<ClubRow>();
    },

    async clubs(_: unknown, _args: unknown, { db }: Context): Promise<ClubRow[]> {
      const { results } = await db.prepare("SELECT id, name FROM clubs").all<ClubRow>();
      return results;
    },
  },

  Club: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<ClubRow | null> {
      return db
        .prepare("SELECT id, name FROM clubs WHERE id = ?")
        .bind(Number(ref.id))
        .first<ClubRow>();
    },
  },
};

const schema_ = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-clubs")],
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

export default {
  fetch: withHttpMetrics((request: Request, env: Env, ctx: ExecutionContext) =>
    yoga.fetch(request, { env }, ctx)
  ),
};
