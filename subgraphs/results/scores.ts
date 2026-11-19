export type Side = "A" | "B";

export interface SetScore {
  a: number;
  b: number;
}

/** "15/10 15/13" → [{a:15,b:10},{a:15,b:13}]. Malformed tokens are skipped. */
export function parseSets(scores: string | null): SetScore[] {
  if (!scores) return [];
  const sets: SetScore[] = [];
  for (const token of scores.trim().split(/\s+/)) {
    const m = /^(\d+)\/(\d+)$/.exec(token);
    if (!m) continue;
    sets.push({ a: Number(m[1]), b: Number(m[2]) });
  }
  return sets;
}

/**
 * Side that won the most sets, or null when there is no score or the set
 * count is tied. By side rather than by club: two teams of the same club
 * ("CA BEGLAIS 01" and "CA BEGLAIS 02") share one club id.
 */
export function winnerSide(scores: string | null): Side | null {
  let a = 0;
  let b = 0;
  for (const set of parseSets(scores)) {
    if (set.a > set.b) a++;
    else if (set.b > set.a) b++;
  }
  if (a === b) return null;
  return a > b ? "A" : "B";
}
