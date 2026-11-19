import { parseRankedPlayer } from "./leagues/euskalpilota";
import type { ScrapedRankedPlayer } from "./leagues/types";
import type { ScrapedResult } from "./types";

/**
 * Upper-case, accent- and punctuation-free form of a player name, stored as
 * `ranking_players.name_key` and `result_players.name_key` for the subgraphs'
 * name search. The subgraphs normalise the searched text the same way.
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/** A player of a result: club A or B, first or second of the lineup. */
export interface ResultPlayer extends ScrapedRankedPlayer {
  side: "A" | "B";
  position: 1 | 2;
}

/**
 * The players of a scraped result, as stored in `result_players`. A lineup
 * number is "059063" or "097866 - 01-641-015" and a name may end with a
 * marker ("PRADERE Bastien (S)"). Written "(number) name", that is the format
 * of a ranked player, so results and rankings go through the same parser.
 * Players without a number have no licence and are left out.
 *
 * Migration 0013_result_players.sql applies the same rules in SQL to the
 * results stored before it: keep the two in step.
 */
export function resultPlayers(res: ScrapedResult): ResultPlayer[] {
  const slots = [
    ["A", 1, res.club_a_player1_name, res.club_a_player1_number],
    ["A", 2, res.club_a_player2_name, res.club_a_player2_number],
    ["B", 1, res.club_b_player1_name, res.club_b_player1_number],
    ["B", 2, res.club_b_player2_name, res.club_b_player2_number],
  ] as const;

  const players: ResultPlayer[] = [];
  for (const [side, position, name, number] of slots) {
    if (!number?.trim()) continue;
    const player = parseRankedPlayer(`(${number}) ${name ?? ""}`);
    if (player) players.push({ side, position, ...player });
  }
  return players;
}
