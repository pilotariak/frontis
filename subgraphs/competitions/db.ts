import { GraphQLError } from "graphql";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  INTERNAL_SERVICE_TOKEN: string;
}

export interface Context {
  db: D1Database;
}

export interface CompetitionRow {
  id: number;
  year: number;
  name: string;
  level: string | null;
}


export function getDatabase(env: Env, league: string): D1Database {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as keyof Env;
  const db = env[key];
  if (!db) {
    throw new GraphQLError(`Unknown league: ${league}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return db;
}
