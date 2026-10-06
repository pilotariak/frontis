import { describe, expect, test } from "bun:test";
import { load } from "cheerio/slim";
import { parseFormOptions, parseResults } from "./euskalpilota";

// Markup modelled on resultats.php: one `.mBloc` table per specialty/category
// block. Row 0 is a title, row 1 the "<specialty> <span>category</span>" header,
// row 2 the column headers, then one row per match with five cells:
// phase | date | club A | club B | score.
const RESULTS_HTML = `
<html><body>
<table class="mBloc">
  <tr><td colspan="5">Résultats</td></tr>
  <tr><td>Trinquet/P.G. Pleine Masculin <span>Seniors</span></td></tr>
  <tr><td class="mTitreSmall">Phase</td><td class="mTitreSmall">Date</td><td class="mTitreSmall">Club A</td><td class="mTitreSmall">Club B</td><td class="mTitreSmall">Score</td></tr>
  <tr>
    <td><strong>1/2&nbsp;Finale</strong></td>
    <td>12/01/2026&nbsp;</td>
    <td>CA BEGLAIS <span class="small">(01)</span><ul><li>(1234) DUPONT Jean</li><li>(5678) MARTIN Paul</li></ul></td>
    <td>URRUGNE PILOTA <span class="small">(02)</span><ul><li>(9999) ETCHEVERRY Peio</li></ul></td>
    <td>15/10 15/13</td>
  </tr>
  <tr>
    <td><strong>Finale</strong></td>
    <td>19/01/2026</td>
    <td>CA BEGLAIS <span class="small">(01)</span></td>
    <td>URRUGNE PILOTA <span class="small">(02)</span></td>
    <td>Forfait</td>
  </tr>
  <tr><td class="mTitreSmall" colspan="5">Poule A</td></tr>
  <tr><td>incomplete</td><td>row</td></tr>
</table>
<table class="mBloc">
  <tr><td colspan="5">Résultats</td></tr>
  <tr><td><span>Cadets</span></td></tr>
  <tr><td class="mTitreSmall">Phase</td><td class="mTitreSmall">Date</td><td class="mTitreSmall">Club A</td><td class="mTitreSmall">Club B</td><td class="mTitreSmall">Score</td></tr>
  <tr>
    <td><strong>Poule</strong></td>
    <td>05/02/2026</td>
    <td>HASPARREN</td>
    <td>ANGLET</td>
    <td>30 / 25   28/30 30/27</td>
  </tr>
</table>
</body></html>`;

const FORM_HTML = `
<form>
  <select name="InCompet">
    <option value="0">Choisir</option>
    <option value="20260501">Championnat 2026</option>
    <option value="20250501">Championnat 2025</option>
  </select>
  <select name="InSpec">
    <option value="">--</option>
    <option value="10"> Trinquet </option>
  </select>
  <select name="InClub"><option value="7">CA BEGLAIS</option></select>
  <select name="InCat"><option value="3">Seniors</option></select>
  <select name="InPhase"><option value="0">Toutes</option><option value="4">Finale</option></select>
</form>`;

describe("parseResults", () => {
  const results = parseResults(load(RESULTS_HTML), "LCAPB");

  test("extracts one result per data row, skipping header and short rows", () => {
    expect(results).toHaveLength(3);
  });

  test("reads the block header into specialty and category", () => {
    expect(results[0].specialty).toBe("Trinquet/P.G. Pleine Masculin");
    expect(results[0].category).toBe("Seniors");
    expect(results[2].category).toBe("Cadets");
  });

  test("falls back to the default specialty when the header has none", () => {
    expect(results[2].specialty).toBe("Trinquet/P.G. Pleine Masculin");
  });

  test("normalises phase and date whitespace", () => {
    expect(results[0].phase).toBe("1/2 Finale");
    expect(results[0].date_match).toBe("12/01/2026");
  });

  test("appends the team number to the club name and extracts players", () => {
    const r = results[0];
    expect(r.club_a).toBe("CA BEGLAIS 01");
    expect(r.club_a_player1_name).toBe("DUPONT Jean");
    expect(r.club_a_player1_number).toBe("1234");
    expect(r.club_a_player2_name).toBe("MARTIN Paul");
    expect(r.club_a_player2_number).toBe("5678");
    expect(r.club_b).toBe("URRUGNE PILOTA 02");
    expect(r.club_b_player1_name).toBe("ETCHEVERRY Peio");
    expect(r.club_b_player2_name).toBeUndefined();
  });

  test("keeps a bare club name when there is no team number", () => {
    expect(results[2].club_a).toBe("HASPARREN");
    expect(results[2].club_b).toBe("ANGLET");
    expect(results[2].club_a_player1_name).toBeUndefined();
  });

  test("joins sets with a single space and strips inner whitespace", () => {
    expect(results[0].scores).toBe("15/10 15/13");
    expect(results[2].scores).toBe("30/25 28/30 30/27");
  });

  test("scores is null when the cell holds no a/b pair", () => {
    expect(results[1].scores).toBeNull();
    expect(results[1].phase).toBe("Finale");
  });

  test("labels every row with the league competition and current year", () => {
    expect(results.every((r) => r.competition === "Championnat LCAPB")).toBe(true);
    expect(results.every((r) => r.year === new Date().getFullYear())).toBe(true);
  });

  test("returns an empty list for a page without result blocks", () => {
    expect(parseResults(load("<html><body><p>rien</p></body></html>"), "LCAPB")).toEqual([]);
  });
});

describe("parseFormOptions", () => {
  const options = parseFormOptions(load(FORM_HTML));

  test("drops placeholder options with an empty or zero value", () => {
    expect(options.competitions).toEqual([
      { sourceId: "20260501", name: "Championnat 2026" },
      { sourceId: "20250501", name: "Championnat 2025" },
    ]);
    expect(options.phases).toEqual([{ sourceId: "4", name: "Finale" }]);
  });

  test("trims labels", () => {
    expect(options.specialties).toEqual([{ sourceId: "10", name: "Trinquet" }]);
  });

  test("reads every dropdown", () => {
    expect(options.clubs).toEqual([{ sourceId: "7", name: "CA BEGLAIS" }]);
    expect(options.categories).toEqual([{ sourceId: "3", name: "Seniors" }]);
  });

  test("yields empty lists when the form is absent", () => {
    expect(parseFormOptions(load("<html></html>"))).toEqual({
      competitions: [],
      specialties: [],
      clubs: [],
      categories: [],
      phases: [],
    });
  });
});
