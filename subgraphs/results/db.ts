import { GraphQLError } from "graphql";
import type { Loader } from "./loader.js";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  DB_LEAGUE_CTPB: D1Database;
  INTERNAL_SERVICE_TOKEN: string;
}

export interface Context {
  db: D1Database;
  /** Per-request batching loader for `Result.__resolveReference`. */
  results: Loader<ResultRow>;
}

export interface ResultRow {
  id: number;
  competition_id: number;
  specialty_id: number;
  category_id: number | null;
  date_match: string | null;
  club_a_id: number;
  club_b_id: number;
  scores: string | null;
  phase: string | null;
  club_a_player1_name: string | null;
  club_a_player1_number: string | null;
  club_a_player2_name: string | null;
  club_a_player2_number: string | null;
  club_b_player1_name: string | null;
  club_b_player1_number: string | null;
  club_b_player2_name: string | null;
  club_b_player2_number: string | null;
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
