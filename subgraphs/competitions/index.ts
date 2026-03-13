import { buildSubgraphSchema } from "@apollo/subgraph";
import { GraphQLError, parse } from "graphql";
import { createYoga } from "graphql-yoga";
import { getDatabase } from "./db.js";
import type { CompetitionRow, Context, Env, ResultRow } from "./db.js";
import schema from "./schema.graphql";

const typeDefs = parse(schema);

const resolvers = {
  Query: {
    async competition(
      _: unknown,
      { id }: { id: string },
      { db }: Context
    ): Promise<CompetitionRow | null> {
      return db
        .prepare("SELECT id, year, name, level FROM competitions WHERE id = ?")
        .bind(Number(id))
        .first<CompetitionRow>();
    },

    async competitions(
      _: unknown,
      { year }: { year?: number },
      { db }: Context
    ): Promise<CompetitionRow[]> {
      if (year !== undefined) {
        const { results } = await db
          .prepare("SELECT id, year, name, level FROM competitions WHERE year = ?")
          .bind(year)
          .all<CompetitionRow>();
        return results;
      }
      const { results } = await db
        .prepare("SELECT id, year, name, level FROM competitions")
        .all<CompetitionRow>();
      return results;
    },

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
        category,
        phase,
      }: {
        competitionId?: string;
        specialtyId?: string;
        category?: string;
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
      if (category) {
        conditions.push("category = ?");
        bindings.push(category);
      }
      if (phase) {
        conditions.push("phase = ?");
        bindings.push(phase);
      }

      const sql = `SELECT * FROM results${
        conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
      }`;
      const { results } = await db
        .prepare(sql)
        .bind(...bindings)
        .all<ResultRow>();
      return results;
    },
  },

  Competition: {
    async __resolveReference(
      ref: { id: string },
      { db }: Context
    ): Promise<CompetitionRow | null> {
      return db
        .prepare("SELECT id, year, name, level FROM competitions WHERE id = ?")
        .bind(Number(ref.id))
        .first<CompetitionRow>();
    },

    async results(
      competition: CompetitionRow | { id: string },
      _args: unknown,
      { db }: Context
    ): Promise<ResultRow[]> {
      const { results } = await db
        .prepare("SELECT * FROM results WHERE competition_id = ?")
        .bind(Number(competition.id))
        .all<ResultRow>();
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

    competition(row: ResultRow) {
      return { __typename: "Competition", id: String(row.competition_id) };
    },

    specialty(row: ResultRow) {
      return { __typename: "Specialty", id: String(row.specialty_id) };
    },

    clubA(row: ResultRow) {
      return { __typename: "Club", id: String(row.club_a_id) };
    },

    clubB(row: ResultRow) {
      return { __typename: "Club", id: String(row.club_b_id) };
    },

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
