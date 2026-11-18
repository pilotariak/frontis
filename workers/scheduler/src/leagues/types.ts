import type { ScrapedResult } from "../types";

export interface ScrapeOptions {
  competition: string;
  specialty: string;
  category: string;
  phase: string;
}

export interface FormOption {
  sourceId: string;
  name: string;
}

export interface FormOptions {
  competitions: FormOption[];
  specialties: FormOption[];
  clubs: FormOption[];
  categories: FormOption[];
  phases: FormOption[];
}

export interface ScrapeData {
  formOptions: FormOptions;
  results: ScrapedResult[];
}

/** One player of a ranked team, as printed on classements.php:
 *  "(000102 - 01-339-002) GARAT Beñat (E)". */
export interface ScrapedRankedPlayer {
  licence: string;
  /** Absent when the site prints the licence alone. */
  name?: string;
  /** Second code after the licence: the player's licence club. */
  licenceClub?: string;
  /** Trailing marker such as "E", "S" or "ES". */
  marker?: string;
}

/** One team's line in an end-of-championship ranking. */
export interface ScrapedRanking {
  rank: number;
  phase: string;
  club: string;
  /** `no_club` of the row's classements2.php link: the club's source_id. */
  clubSourceId: string;
  teamNumber: number;
  players: ScrapedRankedPlayer[];
}

/** The ranking of one specialty and category of a competition. */
export interface RankingPage {
  specialty: FormOption;
  category: FormOption;
  rows: ScrapedRanking[];
}

export interface LeagueScraper {
  fetchData(options: ScrapeOptions, extractResults: boolean): Promise<ScrapeData>;
  /**
   * Fetch the end-of-championship rankings of a competition. `specialty` and
   * `category` are source_ids, "0" for every one the competition offers.
   */
  fetchRankings(competition: string, specialty: string, category: string): Promise<RankingPage[]>;
}
