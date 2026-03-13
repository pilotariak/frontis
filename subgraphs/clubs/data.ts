/**
 * In-memory seed data mirroring the SQLite schema from bildu/scheduler.
 * In production, replace these with database queries.
 */

export interface Specialty {
  id: string;
  name: string;
}

export interface Club {
  id: string;
  name: string;
  city: string | null;
}

export const specialties: Specialty[] = [
  { id: "1", name: "Place Libre" },
  { id: "2", name: "Trinquet" },
  { id: "3", name: "Mur à Gauche" },
  { id: "4", name: "Grand Chistera" },
];

export const clubs: Club[] = [
  { id: "1", name: "Denek Bat", city: "Bayonne" },
  { id: "2", name: "Noizbait", city: "Biarritz" },
  { id: "3", name: "Bixintxo", city: "Saint-Jean-de-Luz" },
  { id: "4", name: "Hazparne", city: "Hasparren" },
  { id: "5", name: "Mauleon", city: "Mauléon-Licharre" },
];
