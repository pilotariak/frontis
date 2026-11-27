import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { BadRequestError } from "../params";
import {
  FfpbScraper,
  formAction,
  parseAjaxLists,
  parseCount,
  parsePageForm,
  parseRows,
  parseScore,
  parseTeam,
} from "./ffpb";

// Sanitized captures of competition.ffpb.net (site version 1.10.13): session
// tokens replaced, secured properties emptied, result rows trimmed, players
// and licences synthetic, notes replaced. No cookies.
const fixture = (name: string) => Bun.file(new URL(`./fixtures/ffpb/${name}`, import.meta.url)).text();
// The guest home page, on its default season 2027.
const HOME = await fixture("home.html");
// Answers to the home page choices: season 2026, CHAMPIONNAT DE FRANCE,
// Trinquet Paleta Pelote de Gomme Pleine Masculin, Nationale A.
const SEASON = await fixture("home-season.xml");
const TYPE = await fixture("home-type.xml");
const SPECIALTY = await fixture("home-specialty.xml");
const CATEGORY = await fixture("home-category.xml");
// The competitions page the search answers for those choices.
const RESULTS = await fixture("results.html");

const SITE = "https://competition.ffpb.net/FFPB_COMPETITION/";
const HOME_ACTION = "https://competition.ffpb.net/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/SESSION-TOKEN-HOME";

// Source ids (VALMEM) of the fixtures' options.
const CHAMPIONNAT_DE_FRANCE = "1";
const TRINQUET_PALETA_GOMME_PLEINE = "55";
const NATIONALE_A = "1";

describe("parseRows", () => {
  const results = parseRows(RESULTS, 2026);

  test("reads one result per row", () => {
    expect(results).toHaveLength(5);
  });

  test("carries the group headers to the rows that follow them", () => {
    for (const r of results) {
      expect(r.specialty).toBe("Trinquet Paleta Pelote de Gomme Pleine Masculin");
      expect(r.category).toBe("Nationale A");
      expect(r.competition).toBe("CHAMPIONNAT DE FRANCE 2026");
      expect(r.year).toBe(2026);
    }
  });

  test("names the phase by pool under POULES, by the header otherwise", () => {
    expect(results.map((r) => r.phase)).toEqual(["Poule 1", "Poule 1", "BARRAGES MAINTIEN", "1/4 DE FINALE", "FINALE"]);
  });

  test("gives the pool number under POULES only, and no pool phase", () => {
    expect(results.map((r) => r.pool)).toEqual([1, 1, null, null, null]);
    expect(results.map((r) => r.pool_phase)).toEqual([null, null, null, null, null]);
  });

  test("keeps the date without its time, the new one for a postponed match", () => {
    expect(results.map((r) => r.date_match)).toEqual(["17/01/2026", "06/02/2026", "08/03/2026", "21/02/2026", "07/03/2026"]);
  });

  test("keeps the team number on the club and splits the players, marker dropped", () => {
    expect(results[0]).toMatchObject({
      club_a: "AVIRON BAYONNAIS 01",
      club_a_player1_name: "JOUEUR01 Prenom",
      club_a_player1_number: "900001",
      club_a_player2_name: "JOUEUR02 Prenom",
      club_a_player2_number: "900002",
      club_b: "GOIZEKO IZARRA 01",
      club_b_player1_name: "JOUEUR03 Prenom",
    });
  });

  test("stores sets as scores, null for a forfeit", () => {
    expect(results.map((r) => r.scores)).toEqual(["40/13", null, "40/36", "24/40", "39/40"]);
  });
});

describe("parseScore", () => {
  test("joins the sets with spaces", () => {
    expect(parseScore("15/7 - 7/15 - 9/10")).toBe("15/7 7/15 9/10");
    expect(parseScore("40/17")).toBe("40/17");
  });

  test("is null when the cell holds no set", () => {
    expect(parseScore("40/P")).toBeNull();
    expect(parseScore("Forfait général")).toBeNull();
    expect(parseScore("")).toBeNull();
  });
});

describe("parseTeam", () => {
  test("reads a team without players", () => {
    expect(parseTeam("<div><b>US DAX 01</b></div>")).toEqual({ club: "US DAX 01", players: [] });
  });

  test("decodes entities and keeps a player without licence", () => {
    expect(parseTeam("<b>A &amp; B 01</b><br>- DUPONT Jean (S)")).toEqual({
      club: "A & B 01",
      players: [{ name: "DUPONT Jean" }],
    });
  });
});

describe("parseCount", () => {
  test("reads the shown and total rows", () => {
    expect(parseCount(RESULTS)).toEqual({ shown: 5, total: 5 });
    expect(parseCount("<html></html>")).toBeNull();
  });
});

describe("parsePageForm", () => {
  const form = parsePageForm(HOME);

  test("reads each select's options with their position and id", () => {
    expect(form.lists.get("A34")?.map((c) => c.id)).toEqual(["2027", "2026", "2025", "2024", "2023"]);
    expect(form.lists.get("A33")?.[1]).toEqual({ position: "2", id: CHAMPIONNAT_DE_FRANCE, label: "CHAMPIONNAT DE FRANCE" });
    expect(form.chosen.get("A34")).toBe("1");
  });

  test("lists what a browser posts, in document order", () => {
    expect(form.fields.map((f) => f.name)).toEqual([
      "WD_JSON_PROPRIETE_", "WD_BUTTON_CLICK_", "WD_ACTION_",
      "A34", "A33", "A36", "A38", "A39", "A41",
      "A3", "A3_DEB", "_A3_OCC", "M20", "M21", "M29", "A21", "A22",
    ]);
  });
});

describe("parseAjaxLists", () => {
  test("reads the new lists, positions counted from 1", () => {
    const lists = parseAjaxLists(TYPE);
    expect(lists.get("A39")!.choices!.find((c) => c.id === TRINQUET_PALETA_GOMME_PLEINE)?.position).toBe("34");
    expect(lists.get("A39")!.chosen).toBe("1");
  });

  test("moves a choice without a list when the answer sends none", () => {
    const lists = parseAjaxLists(CATEGORY);
    expect(lists.get("A36")).toEqual({ chosen: "9" });
    expect(lists.get("A38")!.choices).toHaveLength(29);
    expect(lists.get("A38")!.chosen).toBe("27");
  });
});

describe("formAction", () => {
  test("reads the action path of a named form", () => {
    expect(formAction(HOME, "PAGE_ACCUEIL_INVITE")).toBe("/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/SESSION-TOKEN-HOME");
  });

  test("fails when the form is missing", () => {
    expect(() => formAction("<html></html>", "PAGE_ACCUEIL_INVITE")).toThrow("Form PAGE_ACCUEIL_INVITE not found");
  });
});

// ── The scraper against a fake site ──────────────────────────────────────────

type FetchMock = ReturnType<typeof mock<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>>;
let fetchMock: FetchMock;
const realFetch = globalThis.fetch;

/** The fake site: the home page sets two cookies, each choice answers its capture. */
function fakeSite(answers: { results?: string; home?: () => Response; category?: string } = {}) {
  fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === SITE) {
      return answers.home?.() ?? new Response(HOME, {
        headers: [
          ["Set-Cookie", "FFPB_COMPETITION_HOST=test-host; expires=Sat, 19 Dec 2026 00:00:00 GMT; path=/; secure"],
          ["Set-Cookie", "DYN_SECURITEd10=test-value; httponly; secure; samesite=Strict; path=/"],
        ],
      });
    }
    if (url === HOME_ACTION) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("WD_BUTTON_CLICK_") === "A32") return new Response(answers.results ?? RESULTS);
      const byContext: Record<string, string> = {
        A34: SEASON,
        A33: TYPE,
        A39: SPECIALTY,
        A41: answers.category ?? CATEGORY,
      };
      const answer = byContext[body.get("WD_CONTEXTE_") ?? ""];
      if (answer) return new Response(answer);
    }
    return new Response("not found", { status: 404, statusText: "Not Found" });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const bodyOf = (call: number) => String(fetchMock.mock.calls[call][1]?.body);
const contexts = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url) === HOME_ACTION && String(init?.body).startsWith("WD_ACTION_=AJAXPAGE"))
    .map(([, init]) => new URLSearchParams(String(init?.body)).get("WD_CONTEXTE_"));
const searches = () =>
  fetchMock.mock.calls.filter(([, init]) => new URLSearchParams(String(init?.body)).get("WD_BUTTON_CLICK_") === "A32");

const scraper = new FfpbScraper();
const results2026 = {
  competition: `2026-${CHAMPIONNAT_DE_FRANCE}`,
  specialty: TRINQUET_PALETA_GOMME_PLEINE,
  category: NATIONALE_A,
  phase: "0",
};

// What the browser posted for these choices (issue #107 discussion), without
// the unnamed fields it adds at the end.
const TAIL = "&A3=1&A3_DEB=1&_A3_OCC=4&M20=&M21=&M29=&A21=&A22=";
const BROWSER = [
  "WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=A34&WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=M24&A34=2&A33=1&A36=1&A38=1&A39=1&A41=1" + TAIL,
  "WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=A33&WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=M24&A34=2&A33=2&A36=1&A38=1&A39=1&A41=1" + TAIL,
  "WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=A39&WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=M24&A34=2&A33=2&A36=1&A38=1&A39=34&A41=1" + TAIL,
  "WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=A41&WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=M24&A34=2&A33=2&A36=1&A38=34&A39=34&A41=7" + TAIL,
];

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

describe("FfpbScraper.fetchResults", () => {
  test("makes the browser's choices on the home page, then searches", async () => {
    fakeSite();
    const results = await scraper.fetchResults(results2026);

    expect(results).toHaveLength(5);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([SITE, ...Array(5).fill(HOME_ACTION)]);
    // Each choice is posted as the browser posts it, positions from the lists the previous answer sent.
    expect([1, 2, 3, 4].map(bodyOf)).toEqual(BROWSER);
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["Cookie"]).toBe("FFPB_COMPETITION_HOST=test-host; DYN_SECURITEd10=test-value");
  });

  test("searches with every field of the form, the choices the answers moved included", async () => {
    fakeSite();
    await scraper.fetchResults(results2026);
    expect(bodyOf(5)).toBe(
      "WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=A32&WD_ACTION_=&A34=2&A33=2&A36=9&A38=27&A39=34&A41=7" + TAIL
    );
  });

  test("skips the season change for the season the page shows", async () => {
    fakeSite();
    // The fixture answers belong to 2026, so the header check fails.
    await expect(scraper.fetchResults({ ...results2026, competition: "2027-1" })).rejects.toThrow(
      "Asked for CHAMPIONNAT DE FRANCE 2027 / Trinquet Paleta Pelote de Gomme Pleine Masculin / Nationale A, " +
        "the site answered CHAMPIONNAT DE FRANCE 2026"
    );
    expect(contexts()).toEqual(["A33", "A39", "A41"]);
  });

  test("refuses every specialty, every category or a phase without calling the site", async () => {
    fakeSite();
    await expect(scraper.fetchResults({ ...results2026, specialty: "0" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(scraper.fetchResults({ ...results2026, category: "0" })).rejects.toThrow(
      "one specialty and one category at a time"
    );
    await expect(scraper.fetchResults({ ...results2026, phase: "10" })).rejects.toThrow("pass phase=0");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a competition without its type", async () => {
    fakeSite();
    await expect(scraper.fetchResults({ ...results2026, competition: "2026" })).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a category the specialty does not offer, before searching", async () => {
    fakeSite();
    // Espoir (-22 ans): offered by the competition, not by this specialty.
    await expect(scraper.fetchResults({ ...results2026, category: "10" })).rejects.toThrow(
      "Category '10' is not offered by the FFPB site for CHAMPIONNAT DE FRANCE 2026, " +
        "Trinquet Paleta Pelote de Gomme Pleine Masculin"
    );
    expect(searches()).toHaveLength(0);
  });

  test("fails on a table the site cut short", async () => {
    fakeSite({ results: RESULTS.replace("5 / 5 lignes", "5 / 60 lignes") });
    await expect(scraper.fetchResults(results2026)).rejects.toThrow("lists 60 matches but sent 5");
  });

  test("fails when the search does not answer the competitions page", async () => {
    fakeSite({ results: "<html>Session expirée</html>" });
    await expect(scraper.fetchResults(results2026)).rejects.toThrow(
      "The search did not answer the competitions page"
    );
  });

  test("fails when the site answers an error", async () => {
    fakeSite({ home: () => new Response("busy", { status: 503, statusText: "Service Unavailable" }) });
    await expect(scraper.fetchResults(results2026)).rejects.toThrow(
      "[FFPB] Failed to fetch the home page: HTTP 503 Service Unavailable"
    );
  });

  test("fails when a change does not answer WAJAX", async () => {
    fakeSite({ category: "<html>CGI1910 ERR_BAD_URL</html>" });
    await expect(scraper.fetchResults(results2026)).rejects.toThrow("The A41 change did not answer WAJAX XML");
  });
});

describe("FfpbScraper.fetchResultsForm", () => {
  test("lists the season's competitions, and what the competition offers", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("2026-1");

    expect(form.competitions).toEqual([
      { sourceId: "2026-1", name: "CHAMPIONNAT DE FRANCE 2026" },
      { sourceId: "2026-3", name: "CHALLENGE NATIONAL 2026" },
      { sourceId: "2026-4", name: "TOURNOI FEDERAL 2026" },
      { sourceId: "2026-13", name: "COUPE DE FRANCE 2026" },
      { sourceId: "2026-14", name: "TOURNOI FEDERAL CORPORATIF 2026" },
    ]);
    // Narrowed to CHAMPIONNAT DE FRANCE: 35 specialties and 14 categories, not the season's 38 and 15.
    expect(form.specialties).toHaveLength(35);
    expect(form.categories).toHaveLength(14);
    expect(form.specialties).toContainEqual({ sourceId: "55", name: "Trinquet Paleta Pelote de Gomme Pleine Masculin" });
    expect(form.clubs).toEqual([]);
    expect(form.phases).toEqual([]);
    expect(contexts()).toEqual(["A34", "A33"]);
    expect(searches()).toHaveLength(0);
  });

  test("offers nothing for a season the site does not list", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("2019-1");
    expect(form.competitions).toEqual([]);
    expect(contexts()).toEqual([]);
  });

  test("lists every season the site offers when no competition is given", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("");

    // One season change per season other than the one the page shows, never a search.
    expect(contexts()).toEqual(["A34", "A34", "A34", "A34"]);
    expect(searches()).toHaveLength(0);
    const ids = form.competitions.map((c) => c.sourceId);
    expect(ids).toContain("2027-13");
    expect(ids).toContain("2023-4");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("lists the whole season for a season source_id", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("2026");
    expect(form.competitions).toHaveLength(5);
    expect(form.specialties).toHaveLength(38);
    expect(form.categories).toHaveLength(15);
    expect(contexts()).toEqual(["A34"]);
  });

  test("refuses a competition that is not a season", async () => {
    fakeSite();
    await expect(scraper.fetchResultsForm("20260501")).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FfpbScraper.openRankings", () => {
  test("lists no ranking and calls nothing", async () => {
    fakeSite();
    const source = await scraper.openRankings("2026-1");
    expect(source.listed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
