import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, CategoryRow } from "./db.js";
import { createRowLoader } from "./loader.js";
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
        .prepare("SELECT id, name, enabled FROM categories WHERE id = ?")
        .bind(Number(id))
        .first<CategoryRow>();
    },

    async categories(
      _: unknown,
      { enabled }: { enabled?: boolean | null },
      { db }: Context
    ): Promise<CategoryRow[]> {
      const base = "SELECT id, name, enabled FROM categories";
      const order = "ORDER BY CASE WHEN name LIKE '%Série' THEN 0 ELSE 1 END, name";
      const stmt =
        enabled == null
          ? db.prepare(`${base} ${order}`)
          : db.prepare(`${base} WHERE enabled = ? ${order}`).bind(enabled ? 1 : 0);
      const { results } = await stmt.all<CategoryRow>();
      return results;
    },
  },

  Category: {
    enabled(category: CategoryRow): boolean {
      return Boolean(category.enabled);
    },

    // Batched: every representation in one `_entities` query is resolved by
    // a single `WHERE id IN (...)` statement (see loader.ts).
    __resolveReference(
      ref: { id: string },
      { categories }: Context
    ): Promise<CategoryRow | null> {
      return categories.load(Number(ref.id));
    },
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-categories")],
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
      categories: createRowLoader<CategoryRow>(db, "SELECT id, name, enabled FROM categories"),
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
