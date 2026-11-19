import { parseSets, winnerSide, type Side } from "./scores.js";

/**
 * Same normalisation as the scheduler applies to `result_players.name_key`
 * (workers/scheduler/src/players.ts): upper case, no accents, punctuation
 * turned into spaces.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * "(097866 - 01-641-015) PRADERE Bastien (S)": licence, optional licence club,
 * name, optional marker. The scheduler's parser for ranked players, which it
 * also applies to result lineups before writing `result_players`.
 */
const PLAYER = /^\(\s*([^\s)][^\s)]*?)\s*(?:-\s*([^)]*?)\s*)?\)\s*(.*?)\s*(?:\(([A-Z]{1,3})\))?$/;

/**
 * Licence and name of a lineup player as `result_players` stores them: the
 * licence club and the marker dropped. Null when the lineup has no number.
 */
export function lineupPlayer(
  name: string | null,
  number: string | null
): { licence: string; name: string | null } | null {
  if (!number?.trim()) return null;
  const m = PLAYER.exec(`(${number}) ${name ?? ""}`.replace(/\s+/g, " ").trim());
  if (!m) return null;
  return { licence: m[1], name: m[3] || null };
}

/**
 * One row per (match of the player, other player of that match): the
 * participations loader LEFT JOINs `result_players` onto itself.
 */
export interface ParticipationRow {
  licence: string;
  side: Side;
  result_id: number;
  competition_id: number;
  specialty_id: number;
  category_id: number | null;
  scores: string | null;
  /** `competitions.source_id`, which starts with the season's end year. */
  season: string | null;
  other_licence: string | null;
  other_name: string | null;
  other_side: Side | null;
}

export interface Match {
  resultId: number;
  competitionId: number;
  specialtyId: number;
  categoryId: number | null;
  season: string | null;
  scores: string | null;
  side: Side;
  others: { licence: string; name: string | null; side: Side }[];
}

export function toMatches(rows: ParticipationRow[]): Match[] {
  const byResult = new Map<number, Match>();
  for (const row of rows) {
    let match = byResult.get(row.result_id);
    if (!match) {
      match = {
        resultId: row.result_id,
        competitionId: row.competition_id,
        specialtyId: row.specialty_id,
        categoryId: row.category_id,
        season: row.season,
        scores: row.scores,
        side: row.side,
        others: [],
      };
      byResult.set(row.result_id, match);
    }
    if (row.other_licence !== null && row.other_side !== null) {
      match.others.push({ licence: row.other_licence, name: row.other_name, side: row.other_side });
    }
  }
  return [...byResult.values()];
}

export interface MatchFilters {
  competitionId?: number;
  specialtyId?: number;
  categoryId?: number;
}

export function filterMatches(matches: Match[], f: MatchFilters): Match[] {
  return matches.filter(
    (m) =>
      (f.competitionId === undefined || m.competitionId === f.competitionId) &&
      (f.specialtyId === undefined || m.specialtyId === f.specialtyId) &&
      (f.categoryId === undefined || m.categoryId === f.categoryId)
  );
}

export interface Tally {
  played: number;
  won: number;
  lost: number;
  setsWon: number;
  setsLost: number;
  pointsFor: number;
  pointsAgainst: number;
}

const emptyTally = (): Tally => ({
  played: 0, won: 0, lost: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0,
});

/**
 * Count one match. A match with no score, or with as many sets won by each
 * side, is played but neither won nor lost.
 */
function count(t: Tally, m: Match): void {
  t.played++;
  const winner = winnerSide(m.scores);
  if (winner === m.side) t.won++;
  else if (winner) t.lost++;
  for (const set of parseSets(m.scores)) {
    const [own, other] = m.side === "A" ? [set.a, set.b] : [set.b, set.a];
    t.pointsFor += own;
    t.pointsAgainst += other;
    if (own > other) t.setsWon++;
    else if (other > own) t.setsLost++;
  }
}

export function tally(matches: Match[]): Tally {
  const t = emptyTally();
  for (const m of matches) count(t, m);
  return t;
}

export interface StatsLine extends Tally {
  competitionId: number;
  specialtyId: number;
  categoryId: number | null;
  season: string | null;
}

/**
 * One line per competition, specialty and category, most recent season first,
 * as `playerRankings` orders rankings.
 */
export function breakdown(matches: Match[]): StatsLine[] {
  const lines = new Map<string, StatsLine>();
  for (const m of matches) {
    const key = `${m.competitionId}:${m.specialtyId}:${m.categoryId}`;
    let line = lines.get(key);
    if (!line) {
      line = {
        competitionId: m.competitionId,
        specialtyId: m.specialtyId,
        categoryId: m.categoryId,
        season: m.season,
        ...emptyTally(),
      };
      lines.set(key, line);
    }
    count(line, m);
  }
  return [...lines.values()].sort(
    (x, y) =>
      compare(y.season ?? "", x.season ?? "") ||
      x.specialtyId - y.specialtyId ||
      (x.categoryId ?? Infinity) - (y.categoryId ?? Infinity)
  );
}

export interface Matchup {
  licence: string;
  name: string | null;
  played: number;
  won: number;
  lost: number;
}

/**
 * The players met in `matches`, on the same side (partners) or on the other
 * one (opponents), most matches first. `won` and `lost` are those of the
 * player the matches belong to. The name is the one of the latest match.
 */
export function matchups(matches: Match[], relation: "partners" | "opponents"): Matchup[] {
  const byLicence = new Map<string, Matchup & { latest: number }>();
  for (const m of matches) {
    const winner = winnerSide(m.scores);
    for (const o of m.others) {
      if ((o.side === m.side) !== (relation === "partners")) continue;
      let entry = byLicence.get(o.licence);
      if (!entry) {
        entry = { licence: o.licence, name: null, played: 0, won: 0, lost: 0, latest: -1 };
        byLicence.set(o.licence, entry);
      }
      entry.played++;
      if (winner === m.side) entry.won++;
      else if (winner) entry.lost++;
      if (o.name !== null && m.resultId > entry.latest) {
        entry.name = o.name;
        entry.latest = m.resultId;
      }
    }
  }
  return [...byLicence.values()]
    .map(({ latest: _, ...entry }) => entry)
    .sort(
      (x, y) =>
        y.played - x.played ||
        y.won - x.won ||
        compare(x.name ?? "", y.name ?? "") ||
        compare(x.licence, y.licence)
    );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
