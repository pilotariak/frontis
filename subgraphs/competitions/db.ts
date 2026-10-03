import { GraphQLError } from "graphql";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  DB_LEAGUE_CTPB: D1Database;
  INTERNAL_SERVICE_TOKEN: string;
}

export interface Context {
  db: D1Database;
}

export interface CompetitionRow {
  id: number;
  source_id: string | null;
  name: string;
  // Stored as INTEGER 0/1; the GraphQL Boolean scalar coerces it.
  enabled: number;
}


type LeagueDbKey = Extract<keyof Env, `DB_LEAGUE_${string}`>;

export function getDatabase(env: Env, league: string): D1Database {
  const key = `DB_LEAGUE_${league.toUpperCase()}` as LeagueDbKey;
  const db: D1Database | undefined = env[key];
  if (!db) {
    throw new GraphQLError(`Unknown league: ${league}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return db;
}
