export interface Specialty {
  id?: number;
  name: string;
}

export interface Club {
  id?: number;
  name: string;
}

export interface Competition {
  id?: number;
  year: number;
  name: string;
  level: string;
}

export interface ScrapedResult {
  specialty: string;
  competition: string;
  year: number;
  category: string;
  phase: string;
  date_match: string;
  club_a: string;
  club_a_player1_name?: string;
  club_a_player1_number?: string;
  club_a_player2_name?: string;
  club_a_player2_number?: string;
  club_b: string;
  club_b_player1_name?: string;
  club_b_player1_number?: string;
  club_b_player2_name?: string;
  club_b_player2_number?: string;
  score_a: number | null;
  score_b: number | null;
}

export interface Env {
  DB_LEAGUE_LCAPB: D1Database;
  DB_LEAGUE_LIDFPB: D1Database;
}
