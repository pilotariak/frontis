import { describe, expect, test } from "bun:test";
import { load } from "cheerio/slim";
import { parseFormOptions, parseRankedPlayer, parseRanking, parseResults } from "./euskalpilota";

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

  test("has no pool outside a \"Poules N\" section", () => {
    expect(results.map((r) => [r.pool, r.pool_phase])).toEqual([[null, null], [null, null], [null, null]]);
  });
});

// Markup modelled on the real resultats.php (names and licences made up):
// row 0 holds the CSV and share links, row 1 the block header, whose second
// span names the group and the pool phase, and each run of matches follows a
// `td.mTitreSmall` section title, the first one at row 2. CTPB repeats the
// block header inside the same table for each group and pool phase.
const blockHeader = (specialty: string, category: string, heading?: string) => `
  <tr><td colspan="7">
    ${specialty}\t\t\t<span style="padding-left:1em;">\n\t\t\t    ${category}\t\t\t</span>
    ${heading ? `<span style="padding-left:1em;">\n\t\t\t    ${heading}\t\t\t</span>` : ""}
  </td></tr>`;
const section = (title: string) => `
  <tr>
    <td class="mTitreSmall" colspan="2">${title}</td><td class="mTitreSmall">Club 1</td>
    <td class="mTitreSmall">Club 2</td><td class="mTitreSmall">Score</td><td class="mTitreSmall">Commentaire</td>
  </tr>`;
const match = (code: string, n: number) => `
  <tr>
    <td class="L0"><a href="./resultats2.php?no_renc=${n}"><img src="./images/edit.gif"></a>
      <strong>&nbsp;\n\t\t\t    ${code}  \t\t\t    ${n}\t\t\t    &nbsp;</strong></td>
    <td class="L0">18/01/2026&nbsp;</td>
    <td class="L0">PILOTA CLUB TEST&nbsp;<span class="small">(01)<br /><li>&nbsp;(000101)&nbsp;ETXEBERRI Ane </li></span></td>
    <td class="L0">ZAHARRAK PILOTARI&nbsp;<span class="small">(02)<br /><li>&nbsp;(000106)&nbsp;SALLABERRY Jon </li></span></td>
    <td class="L0">15/10<br />15/07<br /></td>
    <td class="L0 small"></td>
  </tr>`;
const resultsPage = (...blocks: string[]) => `
<html><body>
${
  blocks.map((rows) => `
<table class="mBloc">
  <tr><td colspan="7" align="right"><a href="csv.php">Télécharger <img src="./images/save.png" /><a></td></tr>
  ${rows}
</table>`).join("")
}
</body></html>`;

/** phase, pool and pool_phase of each parsed row. */
const pools = (html: string) => parseResults(load(html), "CTPB").map((r) => [r.phase, r.pool, r.pool_phase]);

describe("parseResults pools", () => {
  test("a pool section gives its number to the matches below it, knockout rounds have none", () => {
    // lcapb 502, Trinquet / P.G. Creuse Masculin, 3ème Série: one pool phase.
    const html = resultsPage(
      blockHeader("Trinquet/P.G. Creuse Masculin", "3ème Série", "GROUPE A\t\t\t    Poule phase 1") +
        section("Poules 1") + match("P", 1) + match("P", 2) +
        section("Poules 2") + match("P", 7) +
        section("1/2 finale ") + match("D", 1) +
        section("Finale ") + match("F", 1)
    );

    expect(pools(html)).toEqual([
      ["P 1", 1, null],
      ["P 2", 1, null],
      ["P 7", 2, null],
      ["D 1", null, null],
      ["F 1", null, null],
    ]);
    expect(parseResults(load(html), "LCAPB")[0]).toMatchObject({
      specialty: "Trinquet/P.G. Creuse Masculin",
      category: "3ème Série",
      date_match: "18/01/2026",
      club_a: "PILOTA CLUB TEST 01",
      scores: "15/10 15/07",
    });
  });

  test("a page without a pool section has no pool", () => {
    const html = resultsPage(
      blockHeader("Trinquet/P.G. Pleine Masculin", "1ère Série") +
        section("Barrage 1er tour ") + match("BT", 1) +
        section("1/4 de finale ") + match("Q", 1) +
        section("Finale ") + match("F", 1)
    );

    expect(pools(html)).toEqual([
      ["BT 1", null, null],
      ["Q 1", null, null],
      ["F 1", null, null],
    ]);
  });

  test("several pool phases: each match keeps its phase, read from the repeated block header", () => {
    // ctpb 137, Mur à Gauche / Main nue Tête à Tête - Groupe B, M14: pool
    // numbers start again in each phase, and in each group.
    const specialty = "Mur à Gauche/Main nue Tête à Tête - Groupe B";
    const html = resultsPage(
      blockHeader(specialty, "M14 - Benjamins - Kimuak", "GROUPE B Poule phase 1") +
        section("Poules 1") + match("P", 1) +
        section("Poules 2") + match("P", 2) +
        blockHeader(specialty, "M14 - Benjamins - Kimuak", "GROUPE C Poule phase 1") +
        section("Poules 1") + match("P", 1) +
        blockHeader(specialty, "M14 - Benjamins - Kimuak", "GROUPE B Poule phase 2") +
        section("Poules 1") + match("P", 1) +
        section("Finale ") + match("F", 1),
      // Another category of the same page names a single phase.
      blockHeader(specialty, "M12 - Poussins - Umetxoak", "GROUPE A Poule phase 1") +
        section("Poules 1") + match("P", 1)
    );

    expect(pools(html)).toEqual([
      ["P 1", 1, 1],
      ["P 2", 2, 1],
      ["P 1", 1, 1],
      ["P 1", 1, 2],
      ["F 1", null, null],
      ["P 1", 1, null],
    ]);
    const parsed = parseResults(load(html), "CTPB");
    expect(parsed.map((r) => r.category)).toEqual([
      ...Array(5).fill("M14 - Benjamins - Kimuak"),
      "M12 - Poussins - Umetxoak",
    ]);
    expect(parsed.every((r) => r.specialty === specialty)).toBe(true);
  });

  test("two groups with a single pool phase share pool numbers and have no pool phase", () => {
    // ctpb 137, Trinquet / Main Nue - Groupe B, M16: GROUPE A and GROUPE B,
    // both "Poule phase 1". The group is not stored, so their pools collide.
    const html = resultsPage(
      blockHeader("Trinquet/Main Nue - Groupe B", "M16 - Minimes - Gaztetxoak", "GROUPE A Poule phase 1") +
        section("Poules 1") + match("P", 1) +
        blockHeader("Trinquet/Main Nue - Groupe B", "M16 - Minimes - Gaztetxoak", "GROUPE B Poule phase 1") +
        section("Poules 1") + match("P", 1)
    );

    expect(pools(html)).toEqual([
      ["P 1", 1, null],
      ["P 1", 1, null],
    ]);
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

// Markup modelled on classements.php with InPPoule=2 ("à la fin du
// championnat"). Names and licence numbers are made up. The rank cell carries
// a classements2.php link that is never closed (`<a>` instead of `</a>`), and
// players are bare `li` elements with no `ul`, as on the site.
const rankingRow = (cls: string, rank: number, club: string, noClub: string, team: number, phase: string, players: string) => `
  <tr>
    <th class="${cls}">
      ${rank}<a href="./classements2.php?no_club=${noClub}&no_compet=20260501&no_spec=2&no_equipe=${team}&no_cat=1&InCompet=20260501&InCat=1&InSpec=2&InPoule=0&InPPoule=2&InGroupe=0">
      <img src="./images/edit.gif" border="0"><a>
    </th>
    <td class="${cls}">
      ${phase}\t\t\t\t</td>
    <td class="${cls}">
      ${club}\t\t\t\t</td>
    <td class="${cls}" align="center">
      ${team}\t\t\t\t</td>
    <td class="${cls}">
      ${players}\t\t\t\t</td>
  </tr>`;

const RANKING_HTML = `
<html><body>
<form action="classements.php" method="post"><table class="cadre"><tr><td>form</td></tr></table></form>
<table  class="mBloc">
  <thead>
    <tr><td colspan="14" align="right"><a href="classements_championnat_csv.php">Télécharger <img src="./images/save.png" /><a></td></tr>
    <tr><th class="mTitreSmall">Rang</th><th class="mTitreSmall">Phase</th><th class="mTitreSmall">Club</th><th class="mTitreSmall">Equipe</th><th class="mTitreSmall">Joueurs</th></tr>
  </thead>
  <tbody>
    ${rankingRow("L0", 1, "PILOTA CLUB TEST", "1339001", 1, "Champion", "<li>(000101) ETXEBERRI Ane</li><li>(000102 - 01-339-002) GARAT Beñat (E)</li>")}
    ${rankingRow("L1", 2, "PILOTA CLUB TEST", "1339001", 2, "Finale", "<li>(000103) IRIGOIN Mikel</li><li>(000104) LARRALDE Peio</li><li>(000105) OÇAFRAIN Xabi</li>")}
    ${rankingRow("L0", 3, "ZAHARRAK PILOTARI", "1339003", 4, "1/2&nbsp;finale", "<li>(000106 - 00-000-000) (E)</li><li>(000107) SALLABERRY Jon (S)</li>")}
    ${rankingRow("forfait", 4, "BASKO ELKARTEA", "1339004", 1, "FORFAIT", "<li>(000108) URRUTY Eneko</li><li>(000109 - 01-339-001) HARAN Iker (ES)</li>")}
  </tbody>
</table>
</body></html>`;

describe("parseRanking", () => {
  const rows = parseRanking(load(RANKING_HTML));

  test("reads one row per team and skips the header rows", () => {
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  test("takes club and team from the classements2.php link", () => {
    expect(rows[1]).toMatchObject({ club: "PILOTA CLUB TEST", clubSourceId: "1339001", teamNumber: 2 });
    expect(rows[2]).toMatchObject({ club: "ZAHARRAK PILOTARI", clubSourceId: "1339003", teamNumber: 4 });
  });

  test("normalises the phase whitespace, forfeits included", () => {
    expect(rows.map((r) => r.phase)).toEqual(["Champion", "Finale", "1/2 finale", "FORFAIT"]);
  });

  test("keeps every player of two- and three-player teams, in order", () => {
    expect(rows[0].players.map((p) => p.licence)).toEqual(["000101", "000102"]);
    expect(rows[1].players.map((p) => p.name)).toEqual(["IRIGOIN Mikel", "LARRALDE Peio", "OÇAFRAIN Xabi"]);
  });

  test("returns an empty list when the page has no ranking", () => {
    expect(parseRanking(load("<html><body>Vous devez choisir une catégorie</body></html>"))).toEqual([]);
  });
});

describe("parseRankedPlayer", () => {
  test("licence and name", () => {
    expect(parseRankedPlayer("(000101) ETXEBERRI Ane")).toEqual({ licence: "000101", name: "ETXEBERRI Ane" });
  });

  test("licence club and marker", () => {
    expect(parseRankedPlayer("(000102 - 01-339-002) GARAT Beñat (E)")).toEqual({
      licence: "000102",
      licenceClub: "01-339-002",
      name: "GARAT Beñat",
      marker: "E",
    });
  });

  test("marker without a licence club", () => {
    expect(parseRankedPlayer("(000107) SALLABERRY Jon (S)")).toEqual({
      licence: "000107",
      name: "SALLABERRY Jon",
      marker: "S",
    });
  });

  test("licence with no name", () => {
    expect(parseRankedPlayer("(000106 - 00-000-000) (E)")).toEqual({
      licence: "000106",
      licenceClub: "00-000-000",
      marker: "E",
    });
  });

  test("text without a licence is rejected", () => {
    expect(parseRankedPlayer("ETXEBERRI Ane")).toBeNull();
  });
});
