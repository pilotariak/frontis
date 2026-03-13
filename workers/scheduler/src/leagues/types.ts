import type { ScrapedResult } from "../types";

export interface ScrapeOptions {
  competition: string;
  specialty: string;
  category: string;
  phase: string;
}

export interface LeagueScraper {
  fetchData(options: ScrapeOptions): Promise<ScrapedResult[]>;
}
