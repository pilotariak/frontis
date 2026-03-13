import { GraphQLError } from "graphql";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
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

export interface ResultRow {
  id: number;
  competition_id: number;
  specialty_id: number;
  category: string | null;
  date_match: string | null;
  club_a_id: number;
  club_b_id: number;
  score_a: number | null;
  score_b: number | null;
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
