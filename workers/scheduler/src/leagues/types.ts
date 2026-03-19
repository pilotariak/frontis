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

export interface LeagueScraper {
  fetchData(options: ScrapeOptions, extractResults: boolean): Promise<ScrapeData>;
}
