import { GraphQLError } from "graphql";
import type { Loader } from "./loader.js";

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
  DB_LEAGUE_CTPB: D1Database;
  DB_LEAGUE_LLPB: D1Database;
  DB_LEAGUE_FFPB: D1Database;
  INTERNAL_SERVICE_TOKEN: string;
}

export interface RankingRow {
  id: number;
  competition_id: number;
  specialty_id: number;
  category_id: number;
  club_id: number;
  team_number: number;
  rank: number;
  phase: string;
  /** 1 when the ranking has a "Champion" row, computed by RANKING_SELECT. */
  final: number;
}

export interface PlayerRow {
  ranking_id: number;
  position: number;
  licence: string;
  name: string | null;
}

export interface Context {
  db: D1Database;
  /** Per-request batching loader for `TeamRanking.__resolveReference`. */
  rankings: Loader<RankingRow>;
  /** Per-request batching loader for `TeamRanking.players`. */
  players: { load(rankingId: number): Promise<PlayerRow[]> };
}

/**
 * Rankings projection. `final` is derived rather than stored: a ranking is
 * final once one of its rows is "Champion". The subquery runs on the leading
 * columns of the UNIQUE(competition_id, specialty_id, category_id, …) index.
 * Callers append `WHERE …` on the `r` alias.
 */
export const RANKING_SELECT = `SELECT r.id, r.competition_id, r.specialty_id, r.category_id, r.club_id,
  r.team_number, r.rank, r.phase,
  EXISTS (SELECT 1 FROM rankings w
          WHERE w.competition_id = r.competition_id AND w.specialty_id = r.specialty_id
            AND w.category_id = r.category_id AND w.phase = 'Champion') AS final
FROM rankings r`;

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
