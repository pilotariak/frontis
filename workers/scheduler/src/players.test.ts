import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { nameKey, resultPlayers } from "./players";
import type { ScrapedResult } from "./types";

const MIGRATIONS = join(import.meta.dir, "../../../database/migrations");

/** Apply the migrations in order, stopping before `until` when given. */
function migrate(db: Database, until?: string): void {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (until && file >= until) break;
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

function result(overrides: Partial<ScrapedResult> = {}): ScrapedResult {
  return {
    specialty: "Trinquet",
    competition: "Championnat",
    year: 2026,
    category: "Seniors",
    phase: "Finale",
    date_match: "12/01/2026",
    club_a: "CA BEGLAIS 01",
    club_b: "HASPARREN",
    scores: "40/35",
    ...overrides,
  };
}

describe("resultPlayers", () => {
  test("splits the licence club off the licence and the marker off the name", () => {
    expect(
      resultPlayers(
        result({
          club_a_player1_name: "PRADERE Bastien (S)",
          club_a_player1_number: "097866 - 01-641-015",
          club_a_player2_name: "ETXEBERRI Ane",
          club_a_player2_number: "000101",
          club_b_player1_name: "IRIGOIN Peio(ED)",
          club_b_player1_number: "1234567",
        })
      )
    ).toEqual([
      { side: "A", position: 1, licence: "097866", licenceClub: "01-641-015", name: "PRADERE Bastien", marker: "S" },
      { side: "A", position: 2, licence: "000101", name: "ETXEBERRI Ane" },
      { side: "B", position: 1, licence: "1234567", name: "IRIGOIN Peio", marker: "ED" },
    ]);
  });

  test("collapses runs of spaces and keeps lower-case parentheses in the name", () => {
    const [player] = resultPlayers(
      result({ club_b_player2_name: "HIRIART  D'OYHARÇABAL  Iñaki (s)", club_b_player2_number: " 000102 " })
    );
    expect(player).toEqual({ side: "B", position: 2, licence: "000102", name: "HIRIART D'OYHARÇABAL Iñaki (s)" });
  });

  test("leaves out players without a number, and keeps a licence without a name", () => {
    expect(
      resultPlayers(
        result({
          club_a_player1_name: "ETXEBERRI Ane",
          club_a_player2_name: "NOBODY",
          club_a_player2_number: "  ",
          club_b_player1_number: "000103",
          club_b_player2_name: "(E)",
          club_b_player2_number: "000104",
        })
      )
    ).toEqual([
      { side: "B", position: 1, licence: "000103" },
      { side: "B", position: 2, licence: "000104", marker: "E" },
    ]);
  });
});

describe("migration 0013_result_players", () => {
  test("applies on a fresh database", () => {
    const db = new Database(":memory:");
    migrate(db);
    expect(db.query("SELECT count(*) AS n FROM result_players").get()).toEqual({ n: 0 });
  });

  // Lineup values as the league sites print them: licence club suffixes,
  // markers with and without a space, accents in both cases, apostrophes,
  // dashes, doubled spaces, seven-digit licences, missing numbers and names.
  const LINEUPS: [string | null, string | null][] = [
    ["PRADERE Bastien (S)", "097866 - 01-641-015"],
    ["ETXEBERRI Ane", "000101"],
    ["DUPRÉ Mañex (E)", "000102"],
    ["LARRÉ-ÇABALETA Joël (ES)", "000103 - 01-330-005"],
    ["HIRIART  D'OYHARÇABAL Ïñaki (ED)", "000104"],
    ["BERNÔ Éloi(D)", "1234567"],
    ["IRIGOIN Peio (s)", "000105"],
    ["SAINT-JEAN  Côme", "000106"],
    ["(S)", "000107"],
    [null, "000108"],
    ["NOBODY Jon", null],
    ["ÀÁÂÃÄÅ àáâãäå ÈÉÊË èéêë ÌÍÎÏ ìíîï ÒÓÔÕÖ òóôõö ÙÚÛÜ ùúûü Çç Ññ Ýý ÿ", "000109"],
  ];

  test("backfills result_players from existing results exactly as the scheduler writes them", () => {
    const db = new Database(":memory:");
    migrate(db, "0013");
    db.exec(`
      INSERT INTO competitions (id, source_id, name) VALUES (1, '20260501', 'Championnat 2026');
      INSERT INTO specialties (id, name) VALUES (1, 'Trinquet');
      INSERT INTO categories (id, source_id, name) VALUES (1, '3', 'Seniors');
      INSERT INTO clubs (id, name) VALUES (1, 'CA BEGLAIS'), (2, 'HASPARREN');
    `);

    // Three lineups per result: A1, A2 and B1, so every slot is covered.
    const scraped: ScrapedResult[] = [];
    for (let i = 0; i < LINEUPS.length; i += 3) {
      const [a1, a2, b1] = [LINEUPS[i], LINEUPS[i + 1] ?? [null, null], LINEUPS[i + 2] ?? [null, null]];
      scraped.push(
        result({
          date_match: `0${i / 3 + 1}/01/2026`,
          club_a_player1_name: a1[0] ?? undefined,
          club_a_player1_number: a1[1] ?? undefined,
          club_a_player2_name: a2[0] ?? undefined,
          club_a_player2_number: a2[1] ?? undefined,
          club_b_player1_name: b1[0] ?? undefined,
          club_b_player1_number: b1[1] ?? undefined,
          club_b_player2_name: "LAST Player",
          club_b_player2_number: `00020${i}`,
        })
      );
    }
    const insert = db.query(
      `INSERT INTO results (competition_id, specialty_id, category_id, date_match, club_a_id, club_b_id, scores, phase,
         club_a_player1_name, club_a_player1_number, club_a_player2_name, club_a_player2_number,
         club_b_player1_name, club_b_player1_number, club_b_player2_name, club_b_player2_number)
       VALUES (1, 1, 1, ?, 1, 2, '40/35', 'Finale', ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of scraped) {
      insert.run(
        r.date_match,
        r.club_a_player1_name ?? null, r.club_a_player1_number ?? null,
        r.club_a_player2_name ?? null, r.club_a_player2_number ?? null,
        r.club_b_player1_name ?? null, r.club_b_player1_number ?? null,
        r.club_b_player2_name ?? null, r.club_b_player2_number ?? null
      );
    }

    db.exec(readFileSync(join(MIGRATIONS, "0013_result_players.sql"), "utf8"));

    const expected = scraped.flatMap((r, i) =>
      resultPlayers(r).map((p) => ({
        result_id: i + 1,
        side: p.side,
        position: p.position,
        licence: p.licence,
        licence_club: p.licenceClub ?? null,
        name: p.name ?? null,
        name_key: p.name ? nameKey(p.name) : null,
        marker: p.marker ?? null,
      }))
    );
    const actual = db
      .query("SELECT * FROM result_players ORDER BY result_id, side, position")
      .all();

    expect(actual).toEqual(expected);
    // NOBODY Jon has no number; every other lineup value is a row.
    expect(actual).toHaveLength(LINEUPS.length - 1 + scraped.length);
  });
});
