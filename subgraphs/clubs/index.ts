import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { ClubRow, Context, Env, SpecialtyRow } from "./db.js";
import schema from "./schema.graphql";

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async specialty(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<SpecialtyRow | null> {
      return db
        .prepare("SELECT id, name FROM specialties WHERE id = ?")
        .bind(Number(id))
        .first<SpecialtyRow>();
    },

    async specialties(_: unknown, _args: unknown, { db }: Context): Promise<SpecialtyRow[]> {
      const { results } = await db
        .prepare("SELECT id, name FROM specialties")
        .all<SpecialtyRow>();
      return results;
    },

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

  Specialty: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<SpecialtyRow | null> {
      return db
        .prepare("SELECT id, name FROM specialties WHERE id = ?")
        .bind(Number(ref.id))
        .first<SpecialtyRow>();
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
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return yoga.fetch(request, { env }, ctx);
  },
};
