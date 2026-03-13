/**
 * In-memory seed data mirroring the SQLite schema from bildu/scheduler.
 * In production, replace these with database queries against the scheduler DB.
 */

export interface Player {
  name: string;
  number: string | null;
}

export interface ClubLineup {
  player1: Player | null;
  player2: Player | null;
}

export interface Competition {
  id: string;
  year: number;
  name: string;
  level: string | null;
}

export interface Result {
  id: string;
  competitionId: string;
  specialtyId: string;
  category: string | null;
  dateMatch: string | null;
  clubAId: string;
  clubBId: string;
  scoreA: number | null;
  scoreB: number | null;
  phase: string | null;
  clubALineup: ClubLineup | null;
  clubBLineup: ClubLineup | null;
}

export const competitions: Competition[] = [
  {
    id: "1",
    year: 2025,
    name: "Championnat de France",
    level: "Place Libre",
  },
  {
    id: "2",
    year: 2025,
    name: "Championnat du Pays Basque",
    level: "Trinquet",
  },
  {
    id: "3",
    year: 2024,
    name: "Championnat de France",
    level: "Mur à Gauche",
  },
];

export const results: Result[] = [
  {
    id: "1",
    competitionId: "1",
    specialtyId: "1",
    category: "Seniors Grande Semaine",
    dateMatch: "2025-05-10",
    clubAId: "1",
    clubBId: "2",
    scoreA: 40,
    scoreB: 30,
    phase: "Finale",
    clubALineup: {
      player1: { name: "Etxeberri Jean", number: "12" },
      player2: { name: "Irigoyen Peio", number: "7" },
    },
    clubBLineup: {
      player1: { name: "Larralde Mixel", number: "3" },
      player2: { name: "Hiribarren Xan", number: "9" },
    },
  },
  {
    id: "2",
    competitionId: "1",
    specialtyId: "1",
    category: "Cadets",
    dateMatch: "2025-04-20",
    clubAId: "3",
    clubBId: "4",
    scoreA: 35,
    scoreB: 40,
    phase: "1/2 Finale",
    clubALineup: {
      player1: { name: "Aguerre Julen", number: "11" },
      player2: null,
    },
    clubBLineup: {
      player1: { name: "Etcheverry Txomin", number: "5" },
      player2: null,
    },
  },
  {
    id: "3",
    competitionId: "2",
    specialtyId: "2",
    category: "Seniors",
    dateMatch: "2025-06-15",
    clubAId: "1",
    clubBId: "3",
    scoreA: 45,
    scoreB: 20,
    phase: "Poule",
    clubALineup: null,
    clubBLineup: null,
  },
];
