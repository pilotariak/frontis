import { buildSubgraphSchema } from "@apollo/subgraph";
import { useOpenTelemetry } from "@envelop/opentelemetry";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { CompetitionRow, Context, Env } from "./db.js";
import { createRowLoader } from "./loader.js";
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
        .prepare("SELECT id, source_id, name, enabled FROM competitions WHERE id = ?")
        .bind(Number(id))
        .first<CompetitionRow>();
    },

    async competitions(
      _: unknown,
      { enabled }: { enabled?: boolean | null },
      { db }: Context
    ): Promise<CompetitionRow[]> {
      const base = "SELECT id, source_id, name, enabled FROM competitions";
      const stmt =
        enabled == null
          ? db.prepare(`${base} ORDER BY id`)
          : db.prepare(`${base} WHERE enabled = ? ORDER BY id`).bind(enabled ? 1 : 0);
      const { results } = await stmt.all<CompetitionRow>();
      return results;
    },
  },

  Competition: {
    // Column is INTEGER 0/1; expose it as a GraphQL Boolean.
    enabled(competition: CompetitionRow): boolean {
      return Boolean(competition.enabled);
    },

    // Batched: every representation in one `_entities` query is resolved by
    // a single `WHERE id IN (...)` statement (see loader.ts).
    __resolveReference(
      ref: { id: string },
      { competitions }: Context
    ): Promise<CompetitionRow | null> {
      return competitions.load(Number(ref.id));
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

const schema_ = buildSubgraphSchema([{ typeDefs, resolvers }]);

const yoga = createYoga<{ env: Env } & ExecutionContext>({
  schema: schema_,
  graphqlEndpoint: "/graphql",
  plugins: [useOpenTelemetry({}), useSubgraphMetrics("frontis-competitions")],
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
      competitions: createRowLoader<CompetitionRow>(
        db,
        "SELECT id, source_id, name, enabled FROM competitions"
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
