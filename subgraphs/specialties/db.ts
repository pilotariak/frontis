import { GraphQLError } from "graphql";
import type { Loader } from "./loader.js";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  DB_LEAGUE_CTPB: D1Database;
  INTERNAL_SERVICE_TOKEN: string;
}

export interface SpecialtyRow {
  id: number;
  name: string;
  /** SQLite has no boolean: 0 = disabled, 1 = enabled. */
  enabled: number;
}

export interface Context {
  db: D1Database;
  /** Per-request batching loader for `Specialty.__resolveReference`. */
  specialties: Loader<SpecialtyRow>;
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
