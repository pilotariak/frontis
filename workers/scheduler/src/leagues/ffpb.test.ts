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
// tokens replaced, secured properties emptied, option lists and rows trimmed,
// players and licences synthetic, notes replaced. No cookies.
const fixture = (name: string) => Bun.file(new URL(`./fixtures/ffpb/${name}`, import.meta.url)).text();
const HOME = await fixture("home.html");
// Default season 2027.
const COMPETITIONS = await fixture("competitions.html");
// Answer to the season change to 2026.
const SEASON = await fixture("season-2026.xml");
// CHAMPIONNAT DE FRANCE 2026, Trinquet Paleta Pelote de Gomme Pleine Masculin, M16.
const RESULTS = await fixture("results.xml");

const SITE = "https://competition.ffpb.net/FFPB_COMPETITION/";
const HOME_ACTION = "https://competition.ffpb.net/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/SESSION-TOKEN-HOME";
const AJAX_ACTION = "https://competition.ffpb.net/FFPB_COMPETITION/PAGE_COMPETITION_INVITE/SESSION-TOKEN-COMPETITIONS";

// Source ids (VALMEM) of the fixtures' options.
const TRINQUET_PALETA_GOMME_PLEINE = "55";
const M16 = "7";

describe("parseRows", () => {
  const rows = parseRows(RESULTS, 2026);
  const results = rows.map((r) => r.result);

  test("reads one result per row", () => {
    expect(results).toHaveLength(4);
  });

  test("carries the group headers to the rows that follow them", () => {
    for (const r of results) {
      expect(r.specialty).toBe("Trinquet Paleta Pelote de Gomme Pleine Masculin");
      expect(r.category).toBe("M16 (moins de 16ans)");
      expect(r.competition).toBe("CHAMPIONNAT DE FRANCE 2026");
      expect(r.year).toBe(2026);
    }
  });

  test("names the phase by pool under POULES, by the header otherwise", () => {
    expect(results.map((r) => r.phase)).toEqual(["Poule 1", "Poule 1", "1/4 DE FINALE", "FINALE"]);
    expect(rows.map((r) => r.phaseHeader)).toEqual(["POULES", "POULES", "1/4 DE FINALE", "FINALE"]);
  });

  test("keeps the date without its time, empty when the match has none", () => {
    expect(results.map((r) => r.date_match)).toEqual(["18/01/2026", "18/01/2026", "", "22/02/2026"]);
  });

  test("keeps the team number on the club and splits the players", () => {
    expect(results[0]).toMatchObject({
      club_a: "AKITANIA PELOTE BASQUE 01",
      club_a_player1_name: "JOUEUR01 Prenom",
      club_a_player1_number: "900001",
      club_a_player2_name: "JOUEUR02 Prenom",
      club_a_player2_number: "900002",
      club_b: "GAZTIAK GOTEIN 02",
      club_b_player1_name: "JOUEUR03 Prenom",
    });
  });

  test("drops the player marker from the name", () => {
    expect(results[2].club_a_player2_name).toBe("JOUEUR10 Prenom");
    expect(results[2].club_a_player2_number).toBe("900010");
  });

  test("stores sets as scores, null for a forfeit", () => {
    expect(results.map((r) => r.scores)).toEqual(["5/20", null, "40/15", "40/19"]);
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
    expect(parseCount(RESULTS)).toEqual({ shown: 4, total: 4 });
    expect(parseCount(SEASON)).toEqual({ shown: 50, total: 3533 });
  });
});

describe("parsePageForm", () => {
  const form = parsePageForm(COMPETITIONS);

  test("reads each select's options with their position and id", () => {
    expect(form.lists.get("I5")?.map((c) => c.id)).toEqual(["2027", "2026", "2025", "2024", "2023"]);
    expect(form.lists.get("I10")?.[4]).toEqual({
      position: "5",
      id: TRINQUET_PALETA_GOMME_PLEINE,
      label: "Trinquet Paleta Pelote de Gomme Pleine Masculin",
    });
    expect(form.chosen.get("I5")).toBe("1");
  });

  test("lists what a browser posts: no unchecked checkbox, no empty select", () => {
    const names = form.fields.map((f) => f.name);
    expect(names.filter((n) => n === "I309")).toHaveLength(1);
    expect(names).not.toContain("I206");
    expect(names).toContain("M29");
    expect(form.fields.find((f) => f.name === "WD_JSON_PROPRIETE_")?.value).toBe("");
  });
});

describe("parseAjaxLists", () => {
  test("reads the new lists, positions counted from 1", () => {
    const lists = parseAjaxLists(SEASON);
    const types = lists.get("I4")!;
    expect(types.choices.map((c) => c.label)).toContain("TOURNOI FEDERAL");
    expect(types.chosen).toBe("1");
    expect(lists.get("I10")!.choices.find((c) => c.id === TRINQUET_PALETA_GOMME_PLEINE)?.position).toBe("7");
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

/** The fake site: the home page sets two cookies, the season change answers SEASON. */
function fakeSite(answers: { results?: string; home?: () => Response } = {}) {
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
    if (url === HOME_ACTION) return new Response(COMPETITIONS);
    if (url === AJAX_ACTION) {
      const context = new URLSearchParams(String(init?.body)).get("WD_CONTEXTE_");
      return new Response(context === "I5" ? SEASON : (answers.results ?? RESULTS));
    }
    return new Response("not found", { status: 404, statusText: "Not Found" });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

const bodyOf = (call: number) => String(fetchMock.mock.calls[call][1]?.body);
const paramsOf = (call: number) => new URLSearchParams(bodyOf(call));
const contexts = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url) === AJAX_ACTION)
    .map(([, init]) => new URLSearchParams(String(init?.body)).get("WD_CONTEXTE_"));

const scraper = new FfpbScraper();
const results2026 = { competition: "2026-1", specialty: TRINQUET_PALETA_GOMME_PLEINE, category: M16, phase: "0" };

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

describe("FfpbScraper.fetchData (results)", () => {
  test("opens a session, shows the season, then asks for one specialty and category", async () => {
    fakeSite();
    const { results, formOptions } = await scraper.fetchData(results2026, true);

    expect(results).toHaveLength(4);
    expect(formOptions.competitions).toEqual([]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([SITE, HOME_ACTION, AJAX_ACTION, AJAX_ACTION]);

    // The competitions link is clicked with the home page's cookies.
    expect(bodyOf(1)).toBe("WD_ACTION_=&WD_BUTTON_CLICK_=A32");
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["Cookie"]).toBe("FFPB_COMPETITION_HOST=test-host; DYN_SECURITEd10=test-value");

    expect(paramsOf(2).get("WD_CONTEXTE_")).toBe("I5");
    expect(paramsOf(2).get("I5")).toBe("2");
  });

  test("posts the positions of the season's lists, in the browser's field order", async () => {
    fakeSite();
    await scraper.fetchData(results2026, true);

    // 2026 lists: CHAMPIONNAT DE FRANCE is 2nd, the specialty 7th, M16 3rd.
    expect(bodyOf(3)).toStartWith(
      "WD_ACTION_=AJAXPAGE&EXECUTE=47&WD_CONTEXTE_=I12&WD_JSON_PROPRIETE_=&WD_BUTTON_CLICK_=M24" +
        "&I5=2&I4=2&I7=3&I9=7&I10=7&I12=3&I40=-1&I40_DEB=1&_I40_OCC=0&I92=-1&I92_DEB=1&_I92_OCC=0&I309=" +
        "&I223=1&I293=1&I227=1&I228=1&I215=&I234=&I158=1&I158_DEB=1&_I158_OCC=50"
    );
    expect(bodyOf(3)).toEndWith("&M20=&M21=&M29=");
  });

  test("skips the season change for the season the page shows", async () => {
    fakeSite();
    // The fixture rows belong to 2026, so the header check fails.
    await expect(scraper.fetchData({ ...results2026, competition: "2027-1" }, true)).rejects.toThrow(
      "Asked for CHAMPIONNAT DE FRANCE 2027 / Trinquet Paleta Pelote de Gomme Pleine Masculin / M16 (moins de 16ans), " +
        "the site answered CHAMPIONNAT DE FRANCE 2026"
    );
    expect(contexts()).toEqual(["I12"]);
    // 2027 lists: the specialty is 5th, M16 4th.
    expect(paramsOf(2).get("I10")).toBe("5");
    expect(paramsOf(2).get("I12")).toBe("4");
  });

  test("keeps the rows of the requested phase", async () => {
    fakeSite();
    const quarterFinals = await scraper.fetchData({ ...results2026, phase: "10" }, true);
    expect(quarterFinals.results.map((r) => r.phase)).toEqual(["1/4 DE FINALE"]);

    const pools = await scraper.fetchData({ ...results2026, phase: "1" }, true);
    expect(pools.results.map((r) => r.phase)).toEqual(["Poule 1", "Poule 1"]);
  });

  test("refuses every specialty or every category without calling the site", async () => {
    fakeSite();
    await expect(scraper.fetchData({ ...results2026, specialty: "0" }, true)).rejects.toBeInstanceOf(BadRequestError);
    await expect(scraper.fetchData({ ...results2026, category: "0" }, true)).rejects.toThrow(
      "one specialty and one category at a time"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a competition without its type", async () => {
    fakeSite();
    await expect(scraper.fetchData({ ...results2026, competition: "2026" }, true)).rejects.toBeInstanceOf(
      BadRequestError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("refuses a specialty the season does not offer", async () => {
    fakeSite();
    await expect(scraper.fetchData({ ...results2026, specialty: "999" }, true)).rejects.toThrow(
      "Specialty '999' is not offered by the FFPB site for this season"
    );
  });

  test("fails on a table the site cut short", async () => {
    fakeSite({ results: RESULTS.replace("4 / 4 lignes", "4 / 60 lignes") });
    await expect(scraper.fetchData(results2026, true)).rejects.toThrow("lists 60 matches but sent 4");
  });

  test("fails when the site answers an error", async () => {
    fakeSite({ home: () => new Response("busy", { status: 503, statusText: "Service Unavailable" }) });
    await expect(scraper.fetchData(results2026, true)).rejects.toThrow(
      "[FFPB] Failed to fetch the home page: HTTP 503 Service Unavailable"
    );
  });

  test("fails when a change does not answer WAJAX", async () => {
    fakeSite({ results: "<html>CGI1910 ERR_BAD_URL</html>" });
    await expect(scraper.fetchData({ ...results2026, competition: "2027-1" }, true)).rejects.toThrow(
      "The I12 change did not answer WAJAX XML"
    );
  });
});

describe("FfpbScraper.fetchResultsForm", () => {
  test("lists the season's competitions, specialties, categories, phases and clubs", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("2026-1");

    expect(form.competitions).toEqual([
      { sourceId: "2026-1", name: "CHAMPIONNAT DE FRANCE 2026" },
      { sourceId: "2026-3", name: "CHALLENGE NATIONAL 2026" },
      { sourceId: "2026-4", name: "TOURNOI FEDERAL 2026" },
      { sourceId: "2026-13", name: "COUPE DE FRANCE 2026" },
      { sourceId: "2026-14", name: "TOURNOI FEDERAL CORPORATIF 2026" },
    ]);
    expect(form.specialties[0]).toEqual({ sourceId: "12", name: "Front Place Libre Chistera Joko Garbi" });
    expect(form.categories.map((c) => c.sourceId)).toEqual(["20", "7", "1", "3", "13"]);
    expect(form.phases).toContainEqual({ sourceId: "10", name: "1/4 de finale" });
    expect(form.clubs).toContainEqual({ sourceId: "382", name: "AVIRON BAYONNAIS" });
    expect(contexts()).toEqual(["I5"]);
  });

  test("offers nothing for a season the site does not list", async () => {
    fakeSite();
    const form = await scraper.fetchResultsForm("2019-1");
    expect(form.competitions).toEqual([]);
    expect(contexts()).toEqual([]);
  });
});

describe("FfpbScraper.fetchData (form options)", () => {
  test("lists every season the site offers when no competition is given", async () => {
    fakeSite();
    const { formOptions, results } = await scraper.fetchData({ competition: "", specialty: "0", category: "0", phase: "0" }, false);

    expect(results).toEqual([]);
    // One season change per season other than the one the page shows.
    expect(contexts()).toEqual(["I5", "I5", "I5", "I5"]);
    expect(["2", "3", "4", "5"]).toEqual(
      fetchMock.mock.calls.slice(2).map(([, init]) => new URLSearchParams(String(init?.body)).get("I5")!)
    );
    const ids = formOptions.competitions.map((c) => c.sourceId);
    expect(ids).toContain("2027-13");
    expect(ids).toContain("2023-4");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("lists one season for a season or competition source_id", async () => {
    fakeSite();
    const { formOptions } = await scraper.fetchData({ competition: "2026", specialty: "0", category: "0", phase: "0" }, false);
    expect(formOptions.competitions).toHaveLength(5);
    expect(contexts()).toEqual(["I5"]);
  });

  test("refuses a competition that is not a season", async () => {
    fakeSite();
    await expect(
      scraper.fetchData({ competition: "20260501", specialty: "0", category: "0", phase: "0" }, false)
    ).rejects.toBeInstanceOf(BadRequestError);
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
