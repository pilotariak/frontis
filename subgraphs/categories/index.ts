import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, CategoryRow } from "./db.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-categories");

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async category(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<CategoryRow | null> {
      return db
        .prepare("SELECT id, name FROM categories WHERE id = ?")
        .bind(Number(id))
        .first<CategoryRow>();
    },

    async categories(_: unknown, _args: unknown, { db }: Context): Promise<CategoryRow[]> {
      const { results } = await db
        .prepare("SELECT id, name FROM categories")
        .all<CategoryRow>();
      return results;
    },
  },

  Category: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<CategoryRow | null> {
      return db
        .prepare("SELECT id, name FROM categories WHERE id = ?")
        .bind(Number(ref.id))
        .first<CategoryRow>();
    },
  },
};

const schema_ = buildSubgraphSchema({ typeDefs, resolvers });

const yoga = createYoga({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-categories")],
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
