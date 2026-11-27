import { load, type CheerioAPI } from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";
import { excerpt, log, upstreamError, UpstreamError } from "../log";
import type { ScrapedResult } from "../types";
import type {
  FormOption,
  FormOptions,
  LeagueScraper,
  RankingSource,
  ScrapedRankedPlayer,
  ScrapedRanking,
  ScrapeOptions,
} from "./types";

/**
 * Shared scraper for the euskalpilota.fr league sites (LCAPB, LIDFPB, CTPB all
 * run the same `resultats.php` application and emit the same markup).
 *
 * CPU budget matters here: on the Workers Free plan an invocation gets 10 ms of
 * CPU, and a full-season results page is up to ~500 KB of HTML (several MB on
 * CTPB). Three choices keep parsing cheap:
 *   - `cheerio/slim` parses with htmlparser2 instead of parse5 (5-7x faster on
 *     these pages, identical extraction).
 *   - The form dropdowns are read from the form alone (`fetchResultsForm`, a
 *     GET with `InCompet` only, about 25 KB), never from a results page, and a
 *     results fetch never parses them.
 *   - Result rows are walked on the raw DOM nodes rather than through cheerio
 *     selectors per cell, and nothing is logged per row.
 */
export abstract class EuskalpilotaScraper implements LeagueScraper {
  abstract readonly baseUrl: string;
  protected abstract readonly leagueName: string;

  protected readonly userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

  /** Headers sent with every upstream request. Subclasses may add cookies etc. */
  protected async requestHeaders(): Promise<Record<string, string>> {
    return { "User-Agent": this.userAgent };
  }

  async fetchResults(options: ScrapeOptions): Promise<ScrapedResult[]> {
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

    // The POST submits the form and returns the results; the dropdowns of the
    // page it answers are not parsed (see fetchResultsForm).
    const started = Date.now();
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    // statusText is empty over HTTP/2: the status and the body go to the logs.
    if (!response.ok) {
      throw await upstreamError(`[${this.leagueName}] Failed to fetch page: ${response.statusText}`, response);
    }

    const html = await response.text();
    const results = parseResults(load(html), this.leagueName);

    log.info({
      event: "league.results",
      league: this.leagueName.toLowerCase(),
      found: results.length,
      upstreamStatus: response.status,
      pageSize: html.length,
      durationMs: Date.now() - started,
      message: `POST ${this.baseUrl}: ${results.length} results`,
    });

    return results;
  }

  async fetchResultsForm(competition: string): Promise<FormOptions> {
    // A GET with InCompet alone returns the form only (about 25 KB), not the
    // results. A GET with every form field, InVoir included, is read as a form
    // submission and answers the full results page (several MB on CTPB). An
    // empty InCompet returns the form of the site's default competition. Cheap
    // enough to check a request before the results POST, and it is all that
    // /scrape_infos reads.
    const headers = await this.requestHeaders();
    const res = await fetch(`${this.baseUrl}?${new URLSearchParams({ InCompet: competition })}`, { headers });
    if (!res.ok) {
      throw await upstreamError(`[${this.leagueName}] Failed to fetch results form: ${res.statusText}`, res);
    }
    const html = await res.text();
    const options = parseFormOptions(load(html));
    // No competition list means no form at all (session not primed, error
    // page, markup change), not a competition missing from the list.
    if (options.competitions.length === 0) {
      throw new UpstreamError(
        `[${this.leagueName}] Results form not found on resultats.php (HTTP ${res.status})`,
        res.status,
        excerpt(html)
      );
    }
    return options;
  }

  async openRankings(competition: string): Promise<RankingSource> {
    const url = new URL("classements.php", this.baseUrl).toString();
    const leagueName = this.leagueName;

    // One set of headers for every page: CTPB primes a new PHPSESSID on each
    // requestHeaders() call, which would double the subrequests.
    const headers = await this.requestHeaders();

    // The GET lists the competitions, and the specialties and categories this
    // competition offers.
    const form = await fetch(`${url}?${new URLSearchParams({ InCompet: competition })}`, { headers });
    if (!form.ok) {
      throw await upstreamError(`[${leagueName}] Failed to fetch rankings form: ${form.statusText}`, form);
    }
    const html = await form.text();
    const options = parseFormOptions(load(html));
    // No competition list means no form at all (session not primed, error
    // page, markup change), not a competition missing from the list.
    if (options.competitions.length === 0) {
      throw new UpstreamError(
        `[${leagueName}] Rankings form not found on classements.php (HTTP ${form.status})`,
        form.status,
        excerpt(html)
      );
    }

    return {
      listed: options.competitions.some((c) => c.sourceId === competition),
      specialties: options.specialties,
      categories: options.categories,

      async fetch(specialty: string, category: string): Promise<ScrapedRanking[]> {
        const body = new URLSearchParams({
          InCompet: competition,
          InSpec: specialty,
          InCat: category,
          InGroupe: "0",
          InPoule: "0",
          InPhasePoule: "1",
          // 2 = "Classement à la fin du championnat".
          InPPoule: "2",
          InVoir: "Voir le classement",
        });
        const res = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
        if (!res.ok) {
          throw await upstreamError(
            `[${leagueName}] Failed to fetch ranking ${specialty}/${category}: ${res.statusText}`,
            res
          );
        }
        return parseRanking(load(await res.text()));
      },
    };
  }
}

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

/** "Poules 2" → 2; any other section title ("1/4 de finale", "Barrage 1er tour") → null. */
const POOL_TITLE = /^Poules?\s+(\d+)$/i;
/** "GROUPE B Poule phase 2" → 2. */
const POOL_PHASE = /\bPoule\s+phase\s+(\d+)\b/i;

/**
 * Rows of the resultats.php results table. Each `.mBloc` table holds:
 *   - a block header row: one cell, "<specialty> <span>category</span>
 *     <span>GROUPE A Poule phase 1</span>". CTPB repeats it inside the same
 *     table for each group and pool phase of the category;
 *   - section title rows (`td.mTitreSmall`): "Poules 1", "Poules 2", then the
 *     knockout rounds ("1/4 de finale", "Finale"), each followed by its matches;
 *   - match rows with five cells or more: phase | date | club A | club B | score.
 *
 * `pool` is the N of the "Poules N" section a match sits in, and `pool_phase`
 * the N of the heading's "Poule phase N". A knockout match sits under the last
 * heading too, so both are null outside a "Poules N" section. When the page
 * names a single pool phase for a specialty and category, its `pool_phase` is
 * null: it only matters when pool numbers start again in a later phase.
 */
export function parseResults($: CheerioAPI, leagueName: string): ScrapedResult[] {
  const results: ScrapedResult[] = [];
  const year = new Date().getFullYear();
  const competition = `Championnat ${leagueName}`;
  // Pool phases named by the page, per specialty and category.
  const poolPhases = new Map<string, Set<number>>();
  const blockKey = (specialty: string, category: string) => `${specialty}\u0000${category}`;

  for (const table of $(".mBloc").toArray()) {
    let specialtyText = "";
    let categoryText = "";
    let poolPhase: number | null = null;
    let pool: number | null = null;

    for (const row of descendants(table, "tr")) {
      const cols = descendants(row, "td");

      // Block header: a single cell holding the category and heading spans.
      // The first row (CSV and share links) has a single cell but no span.
      const spans = cols.length === 1 ? descendants(cols[0], "span") : [];
      if (spans.length > 0) {
        specialtyText = cols[0].children.filter(isText).map(textOf).join("").trim();
        categoryText = textOf(spans[0]).trim();
        const phase = spans[1] ? POOL_PHASE.exec(collapse(textOf(spans[1]))) : null;
        poolPhase = phase ? Number(phase[1]) : null;
        pool = null;
        continue;
      }

      const title = cols.find((td) => hasClass(td, "mTitreSmall"));
      if (title) {
        const match = POOL_TITLE.exec(collapse(textOf(title)));
        pool = match ? Number(match[1]) : null;
        continue;
      }
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

      const specialty = specialtyText || "Trinquet/P.G. Pleine Masculin";
      if (pool !== null && poolPhase !== null) {
        const key = blockKey(specialty, categoryText);
        const phases = poolPhases.get(key) ?? new Set<number>();
        phases.add(poolPhase);
        poolPhases.set(key, phases);
      }

      results.push({
        specialty,
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
        pool,
        pool_phase: pool === null ? null : poolPhase,
      });
    }
  }

  // A single pool phase tells nothing: keep pool_phase only where the page
  // names several for the specialty and category.
  for (const r of results) {
    if (r.pool_phase !== null && (poolPhases.get(blockKey(r.specialty, r.category))?.size ?? 0) < 2) {
      r.pool_phase = null;
    }
  }

  return results;
}

// ── Rankings table ────────────────────────────────────────────────────────────

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * "(000102 - 01-339-002) GARAT Beñat (E)": licence, optional licence club
 * after a dash, optional name, optional upper-case marker in parentheses.
 */
const PLAYER = /^\(\s*([^\s)][^\s)]*?)\s*(?:-\s*([^)]*?)\s*)?\)\s*(.*?)\s*(?:\(([A-Z]{1,3})\))?$/;

export function parseRankedPlayer(text: string): ScrapedRankedPlayer | null {
  const m = PLAYER.exec(collapse(text));
  if (!m) return null;
  const player: ScrapedRankedPlayer = { licence: m[1] };
  if (m[2]) player.licenceClub = m[2];
  if (m[3]) player.name = m[3];
  if (m[4]) player.marker = m[4];
  return player;
}

/**
 * Rows of the classements.php end-of-championship ranking. Each team row has
 * five cells: rank (with a classements2.php link carrying `no_club` and
 * `no_equipe`) | phase | club | team number | players as `li`. Header rows
 * have no such link and are skipped.
 */
export function parseRanking($: CheerioAPI): ScrapedRanking[] {
  const rows: ScrapedRanking[] = [];

  for (const table of $(".mBloc").toArray()) {
    for (const tr of descendants(table, "tr")) {
      const cells = tr.children.filter(
        (c): c is Element => isElement(c) && (c.name === "td" || c.name === "th")
      );
      if (cells.length < 5) continue;

      const href = descendants(cells[0], "a")
        .map((a) => a.attribs["href"] ?? "")
        .find((h) => h.includes("no_club="));
      if (!href) continue;

      const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      const clubSourceId = params.get("no_club") ?? "";
      const rank = Number.parseInt(collapse(textOf(cells[0])), 10);
      const teamNumber = Number.parseInt(params.get("no_equipe") ?? collapse(textOf(cells[3])), 10);
      if (!clubSourceId || !Number.isInteger(rank) || !Number.isInteger(teamNumber)) continue;

      const players: ScrapedRankedPlayer[] = [];
      for (const li of descendants(cells[4], "li")) {
        const player = parseRankedPlayer(textOf(li));
        if (player) players.push(player);
      }

      rows.push({
        rank,
        phase: collapse(textOf(cells[1])),
        club: collapse(textOf(cells[2])),
        clubSourceId,
        teamNumber,
        players,
      });
    }
  }

  return rows;
}
