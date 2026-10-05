import { load, type CheerioAPI } from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";
import type { ScrapedResult } from "../types";
import type { FormOption, FormOptions, LeagueScraper, ScrapeData, ScrapeOptions } from "./types";

/**
 * Shared scraper for the euskalpilota.fr league sites (LCAPB, LIDFPB, CTPB all
 * run the same `resultats.php` application and emit the same markup).
 *
 * CPU budget matters here: on the Workers Free plan an invocation gets 10 ms of
 * CPU, and a full-season results page is up to ~500 KB of HTML. Three choices
 * keep parsing cheap:
 *   - `cheerio/slim` parses with htmlparser2 instead of parse5 (5-7x faster on
 *     these pages, identical extraction).
 *   - The form dropdowns are only parsed when the caller asked for them; a
 *     results fetch skips them entirely.
 *   - Result rows are walked on the raw DOM nodes rather than through cheerio
 *     selectors per cell, and nothing is logged per row.
 */
export abstract class EuskalpilotaScraper implements LeagueScraper {
  protected abstract readonly baseUrl: string;
  protected abstract readonly leagueName: string;

  protected readonly userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

  /** Headers sent with every upstream request. Subclasses may add cookies etc. */
  protected async requestHeaders(): Promise<Record<string, string>> {
    return { "User-Agent": this.userAgent };
  }

  async fetchData(options: ScrapeOptions, extractResults: boolean): Promise<ScrapeData> {
    const body = new URLSearchParams({
      InSel: "",
      InCompet: options.competition,
      InSpec: options.specialty,
      InVille: "",
      InClub: "",
      InDate: "",
      InDatef: "",
      InCat: options.category,
      InPhase: options.phase,
      InVoir: "Voir les résultats",
    });

    const headers = await this.requestHeaders();

    // GET populates the SELECT dropdowns; POST submits the form and returns results.
    const response = extractResults
      ? await fetch(this.baseUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        })
      : await fetch(`${this.baseUrl}?${body.toString()}`, { headers });

    if (!response.ok) {
      throw new Error(`[${this.leagueName}] Failed to fetch page: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = load(html);

    // Callers of a results fetch (`scrapeResults`) discard the form options, so
    // parsing the dropdowns there would only burn CPU.
    const formOptions = extractResults ? EMPTY_FORM_OPTIONS : parseFormOptions($);
    const results = extractResults ? parseResults($, this.leagueName) : [];

    console.log(
      `[${this.leagueName}] ${extractResults ? "POST" : "GET"} ${this.baseUrl} status=${response.status} html=${html.length}B results=${results.length}`
    );

    return { formOptions, results };
  }
}

const EMPTY_FORM_OPTIONS: FormOptions = {
  competitions: [],
  specialties: [],
  clubs: [],
  categories: [],
  phases: [],
};

export function parseFormOptions($: CheerioAPI): FormOptions {
  const parseSelect = (name: string): FormOption[] => {
    const options: FormOption[] = [];
    for (const el of $(`select[name="${name}"] option`).toArray()) {
      const value = el.attribs["value"] ?? "";
      if (value !== "" && value !== "0") {
        options.push({ sourceId: value, name: textOf(el).trim() });
      }
    }
    return options;
  };

  return {
    competitions: parseSelect("InCompet"),
    specialties: parseSelect("InSpec"),
    clubs: parseSelect("InClub"),
    categories: parseSelect("InCat"),
    phases: parseSelect("InPhase"),
  };
}

// ── DOM helpers (raw htmlparser2 nodes, no cheerio wrappers) ─────────────────

const isElement = (n: AnyNode): n is Element => n.type === "tag";
const isText = (n: AnyNode): boolean => n.type === "text";

/** Text content of a node: concatenation of every descendant text node. */
function textOf(node: AnyNode): string {
  if (isText(node)) return (node as { data: string }).data;
  if (!("children" in node)) return "";
  let out = "";
  for (const child of (node as Element).children) out += textOf(child);
  return out;
}

/** All descendant elements with the given tag name, in document order. */
function descendants(root: Element, tag: string, out: Element[] = []): Element[] {
  for (const child of root.children) {
    if (!isElement(child)) continue;
    if (child.name === tag) out.push(child);
    descendants(child, tag, out);
  }
  return out;
}

function hasClass(el: Element, cls: string): boolean {
  const attr = el.attribs["class"];
  return attr !== undefined && attr.split(/\s+/).includes(cls);
}

// ── Results table ─────────────────────────────────────────────────────────────

/** Club cell: club name on the first node, team number in `span.small`, players as `li`. */
function extractClubData(col: Element): { name: string; players: { name: string; number: string }[] } {
  const first = col.children[0];
  const fullText = first ? textOf(first).trim() : "";

  let teamNumber = "";
  for (const span of descendants(col, "span")) {
    if (!hasClass(span, "small") || span.children.length === 0) continue;
    teamNumber = textOf(span.children[0]).trim().replace(/[()]/g, "");
    break;
  }

  const players: { name: string; number: string }[] = [];
  for (const li of descendants(col, "li")) {
    const match = textOf(li).trim().match(/\(([^)]+)\)\s*(.*)/);
    if (match) players.push({ number: match[1].trim(), name: match[2].trim() });
  }

  return { name: `${fullText} ${teamNumber}`.trim(), players };
}

export function parseResults($: CheerioAPI, leagueName: string): ScrapedResult[] {
  const results: ScrapedResult[] = [];
  const year = new Date().getFullYear();
  const competition = `Championnat ${leagueName}`;

  for (const table of $(".mBloc").toArray()) {
    const rows = descendants(table, "tr");

    // Row 1 carries the block header: "<specialty> <span>category</span>".
    const infoRow = rows[1];
    let specialtyText = "";
    let categoryText = "";
    if (infoRow) {
      const firstTd = descendants(infoRow, "td")[0];
      if (firstTd) {
        specialtyText = firstTd.children.filter(isText).map(textOf).join("").trim();
      }
      const firstSpan = descendants(infoRow, "span")[0];
      if (firstSpan) categoryText = textOf(firstSpan).trim();
    }

    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      const cols = descendants(row, "td");
      if (cols.some((td) => hasClass(td, "mTitreSmall"))) continue;
      if (cols.length < 5) continue;

      const phase = descendants(cols[0], "strong")
        .map(textOf)
        .join("")
        .replace(/ /g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const date = textOf(cols[1]).trim().replace(/&nbsp;/g, "").trim();
      const sets = textOf(cols[4]).replace(/[\s ]/g, "").match(/\d{1,2}\/\d{1,2}/g) ?? [];
      const scores = sets.length > 0 ? sets.join(" ") : null;

      const clubAData = extractClubData(cols[2]);
      const clubBData = extractClubData(cols[3]);

      results.push({
        specialty: specialtyText || "Trinquet/P.G. Pleine Masculin",
        competition,
        year,
        category: categoryText,
        phase,
        date_match: date,
        club_a: clubAData.name,
        club_a_player1_name: clubAData.players[0]?.name,
        club_a_player1_number: clubAData.players[0]?.number,
        club_a_player2_name: clubAData.players[1]?.name,
        club_a_player2_number: clubAData.players[1]?.number,
        club_b: clubBData.name,
        club_b_player1_name: clubBData.players[0]?.name,
        club_b_player1_number: clubBData.players[0]?.number,
        club_b_player2_name: clubBData.players[1]?.name,
        club_b_player2_number: clubBData.players[1]?.number,
        scores,
      });
    }
  }

  return results;
}
