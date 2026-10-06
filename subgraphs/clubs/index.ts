import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { ClubRow, Context, Env } from "./db.js";
import { createRowLoader } from "./loader.js";
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
    // Batched: every representation in one `_entities` query is resolved by
    // a single `WHERE id IN (...)` statement (see loader.ts).
    __resolveReference(ref: { id: string }, { clubs }: Context): Promise<ClubRow | null> {
      return clubs.load(Number(ref.id));
    },
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-clubs")],
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
      clubs: createRowLoader<ClubRow>(db, "SELECT id, name FROM clubs"),
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
