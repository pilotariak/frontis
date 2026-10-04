import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { Context, Env, SpecialtyRow } from "./db.js";
import schema from "./schema.graphql" with { type: "text" };
import { useSubgraphMetrics, withHttpMetrics } from "./metrics.js";
import { setupTracing } from "./tracing.js";

setupTracing("frontis-specialties");

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async specialty(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<SpecialtyRow | null> {
      return db
        .prepare("SELECT id, name, enabled FROM specialties WHERE id = ?")
        .bind(Number(id))
        .first<SpecialtyRow>();
    },

    async specialties(
      _: unknown,
      { enabled }: { enabled?: boolean | null },
      { db }: Context
    ): Promise<SpecialtyRow[]> {
      const base = "SELECT id, name, enabled FROM specialties";
      const stmt =
        enabled == null
          ? db.prepare(`${base} ORDER BY id`)
          : db.prepare(`${base} WHERE enabled = ? ORDER BY id`).bind(enabled ? 1 : 0);
      const { results } = await stmt.all<SpecialtyRow>();
      return results;
    },
  },

  Specialty: {
    enabled(specialty: SpecialtyRow): boolean {
      return Boolean(specialty.enabled);
    },

    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<SpecialtyRow | null> {
      return db
        .prepare("SELECT id, name, enabled FROM specialties WHERE id = ?")
        .bind(Number(ref.id))
        .first<SpecialtyRow>();
    },
  },
};

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-specialties")],
  context: ({ request, env }) => {
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
