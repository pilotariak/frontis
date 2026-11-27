import { excerpt, log, upstreamError, UpstreamError } from "../log";
import { BadRequestError } from "../params";
import type { ScrapedResult } from "../types";
import { socketConnect, socketFetch } from "./socket-fetch";
import type { FormOption, FormOptions, LeagueScraper, RankingSource, ScrapeOptions } from "./types";

/**
 * Scraper for competition.ffpb.net, the national competitions of the
 * Fédération Française de Pelote Basque. The site is a PC SOFT WebDev
 * application, not the euskalpilota.fr `resultats.php` of the other leagues.
 *
 * It follows what a browser does on the guest home page:
 *   1. GET /FFPB_COMPETITION/ sets the session cookies and returns the home
 *      page. Its search form holds the season, competition type, specialty and
 *      category selects, and its action carries a session token.
 *   2. Each choice is an AJAX POST to that action. It answers WAJAX XML with
 *      the narrowed option lists only, in about 0.1 s: the season gives its
 *      competition types, the type its specialties and categories, the
 *      specialty its categories.
 *   3. The search button (A32) posts the form and answers the competitions
 *      page with the results table already filtered. That page takes about
 *      11 s to build, whatever the filters.
 * A token from another session fails with HTTP 400 (CGI1910 ERR_BAD_URL), so
 * tokens are always read from the form action, never stored.
 *
 * A `<select>` is posted as the 1-based position of the chosen option in the
 * list the server holds for the session, and the lists change with every
 * choice. Each option also carries `data-wb-valmem` (VALMEM in the XML), the
 * site's own id, which does not change: source_ids are these ids, and the
 * scraper maps them to positions in the list it last received.
 *
 * A competition is a season and a competition type: source_id
 * `<season>-<type id>`, for example `2026-1`, named `CHAMPIONNAT DE FRANCE 2026`
 * as the results table heads it.
 *
 * Results are always asked for one specialty and one category: TOUTES makes
 * the competitions page list every match of the competition.
 *
 * CPU budget: the pages are sliced with string searches and small regexes,
 * never loaded into a DOM.
 */

const ORIGIN = "https://competition.ffpb.net";
const LEAGUE = "FFPB";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

/**
 * WebDev ids of the guest pages, as published in site version 1.10.13. WebDev
 * numbers the controls when it generates the site, so a new release can
 * renumber them: every id the scraper relies on is here.
 */
export const WEBDEV = {
  homeForm: "PAGE_ACCUEIL_INVITE",
  competitionsForm: "PAGE_COMPETITION_INVITE",
  /** The home page's "Chercher rencontres / résultats" button. */
  search: "A32",
  /** The AJAX event a select runs on change: `_JAEE(_PAGE_, "<id>", 47, …)`. */
  changeEvent: "47",
  /** Home page selects. */
  season: "A34",
  type: "A33",
  /**
   * The home page holds two specialty selects (A38, A39) and two category
   * selects (A36, A41). The browser changes the second of each pair and the
   * server keeps the first in sync.
   */
  specialty: "A39",
  category: "A41",
  /** The competitions page's results table and its "<shown> / <total> lignes" counter. */
  table: "I158",
  tableCount: "I164",
} as const;

/**
 * Cells of a results row, `zrl_<row>_ATT_<id>_1`. The first four head a group
 * of rows and appear only on the group's first row.
 */
export const CELL = {
  specialty: "I160",
  category: "I161",
  competition: "I159",
  phase: "I162",
  date: "I163",
  pool: "I220",
  team1: "I165",
  team2: "I167",
  score: "I168",
} as const;

/** One option of a WebDev select. */
export interface Choice {
  /** 1-based position: what the form posts. */
  position: string;
  /** `data-wb-valmem`: the site's id. "0" (or "") for TOUTES. */
  id: string;
  label: string;
}

// ── Text helpers ──────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const textOf = (html: string): string => collapse(decode(html.replace(/<[^>]*>/g, " ")));

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}=(?:"([^"]*)"|'([^']*)'|([^\\s>"']*))`, "i").exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3]) : undefined;
}

const isReal = (c: Choice): boolean => c.id !== "" && c.id !== "0";

// ── Page parsing ──────────────────────────────────────────────────────────────

/** The action of a named form: a path that carries the session token. */
export function formAction(page: string, form: string): string {
  const m = new RegExp(`<form\\s+name="${form}"\\s+action="([^"]+)"`, "i").exec(page);
  if (!m) throw new Error(`[${LEAGUE}] Form ${form} not found`);
  return decode(m[1]);
}

/** A form control the browser posts, in document order. */
interface Field {
  name: string;
  /** Unset for a select: its value is the position of its chosen option. */
  value?: string;
}

interface PageForm {
  fields: Field[];
  lists: Map<string, Choice[]>;
  /** Position of each select's chosen option. */
  chosen: Map<string, string>;
}

/** The controls of a page's form, as a browser would post them. */
export function parsePageForm(page: string): PageForm {
  const fields: Field[] = [];
  const lists = new Map<string, Choice[]>();
  const chosen = new Map<string, string>();

  // Quote-aware: WebDev puts scripts with ">" in attributes such as onfocus.
  for (const m of page.matchAll(/<(input|select|textarea)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const tag = m[2];
    const name = attr(tag, "name");
    if (!name) continue;
    const start = m.index + m[0].length;
    const kind = m[1].toLowerCase();

    if (kind === "select") {
      const choices: Choice[] = [];
      let selected: string | undefined;
      for (const o of page.slice(start, page.indexOf("</select>", start)).matchAll(/<option\b([^>]*)>([^<]*)/gi)) {
        const position = attr(o[1], "value");
        // Options without a value (the font menus of the comment editor) are not posted.
        if (position === undefined) continue;
        choices.push({ position, id: attr(o[1], "data-wb-valmem") ?? "", label: collapse(decode(o[2])) });
        if (/\bselected\b/i.test(o[1])) selected = position;
      }
      if (choices.length === 0) continue;
      lists.set(name, choices);
      chosen.set(name, selected ?? choices[0].position);
      fields.push({ name });
    } else if (kind === "textarea") {
      fields.push({ name, value: decode(page.slice(start, page.indexOf("</textarea>", start))) });
    } else {
      const type = (attr(tag, "type") ?? "text").toLowerCase();
      if (["button", "submit", "image", "reset", "file"].includes(type)) continue;
      if ((type === "checkbox" || type === "radio") && !/\bchecked\b/i.test(tag)) continue;
      fields.push({ name, value: attr(tag, "value") ?? "" });
    }
  }
  return { fields, lists, chosen };
}

// ── WAJAX parsing ─────────────────────────────────────────────────────────────

/**
 * What a WAJAX answer changes in each select: a new option list, a new chosen
 * position, or both. An answer can move a select's choice without sending its
 * list again.
 */
export function parseAjaxLists(xml: string): Map<string, { choices?: Choice[]; chosen?: string }> {
  const out = new Map<string, { choices?: Choice[]; chosen?: string }>();
  for (const m of xml.matchAll(/<CHAMP ALIAS="([^"]+)" TYPE="14">([\s\S]*?)<\/CHAMP>/g)) {
    const body = m[2];
    const change: { choices?: Choice[]; chosen?: string } = {};
    if (body.includes("<OPTIONS>")) {
      change.choices = [...body.matchAll(/<OPTION\b([^>]*)>([^<]*)<\/OPTION>/g)].map((o, i) => ({
        position: String(i + 1),
        id: attr(o[1], "VALMEM") ?? "",
        label: collapse(decode(o[2])),
      }));
    }
    // `.options[<0-based index>].selected=true`
    const selected = [...body.matchAll(/\.options\[(\d+)\]\.selected=true/g)].pop();
    if (selected) change.chosen = String(Number(selected[1]) + 1);
    out.set(m[1], change);
  }
  return out;
}

/** "<shown> / <total> lignes" of the results table, when the page has it. */
export function parseCount(page: string): { shown: number; total: number } | null {
  const m = /(\d+)\s*\/\s*(\d+)\s*lignes/.exec(page);
  return m ? { shown: Number(m[1]), total: Number(m[2]) } : null;
}

interface Team {
  club: string;
  players: { name: string; number?: string }[];
}

/** "- DOUAT Nathan (094063) (S)": name, licence, optional marker. */
const PLAYER = /^-?\s*(.+?)(?:\s*\(([^()]*\d[^()]*)\))?(?:\s*\(([A-Z]{1,3})\))?$/;

/** "<b>AVIRON BAYONNAIS 02</b><br>- NAME Firstname (licence)<br>…" */
export function parseTeam(html: string): Team {
  const [head = "", ...lines] = html.split(/<br\s*\/?>/i);
  const players: Team["players"] = [];
  for (const line of lines) {
    const m = PLAYER.exec(textOf(line));
    if (m) players.push(m[2] ? { name: m[1], number: m[2] } : { name: m[1] });
  }
  return { club: textOf(head), players };
}

/**
 * Sets of a score cell, space-separated, as the other leagues store them:
 * "15/7 - 7/15 - 9/10" → "15/7 7/15 9/10". Null when the cell has none, such
 * as "40/P" or "Forfait général".
 */
export function parseScore(text: string): string | null {
  const sets = text.replace(/\s+/g, "").match(/\d+\/\d+/g);
  return sets ? sets.join(" ") : null;
}

/**
 * Rows of the results table of the competitions page. Cells are read in
 * document order and grouped by their row number. Group headers (specialty,
 * category, competition, phase) are carried to the rows that follow them.
 * Under a POULES header the phase is the row's pool ("Poule 1"), otherwise
 * the header ("1/4 DE FINALE").
 */
export function parseRows(page: string, year: number): ScrapedResult[] {
  const rows: Map<string, string>[] = [];
  let row = "";
  for (const m of page.matchAll(/id="zrl_(\d+)_ATT_(I\d+)_1"[^>]*>([\s\S]*?)<\/td>/g)) {
    if (m[1] !== row) {
      row = m[1];
      rows.push(new Map());
    }
    rows[rows.length - 1].set(m[2], m[3]);
  }

  const results: ScrapedResult[] = [];
  const head = { specialty: "", category: "", competition: "", phase: "" };
  for (const cells of rows) {
    const header = (id: string) => (cells.has(id) ? textOf(cells.get(id)!) : undefined);
    head.specialty = header(CELL.specialty) ?? head.specialty;
    head.category = header(CELL.category) ?? head.category;
    head.competition = header(CELL.competition) ?? head.competition;
    head.phase = header(CELL.phase) ?? head.phase;

    const team1 = cells.get(CELL.team1);
    const team2 = cells.get(CELL.team2);
    if (team1 === undefined || team2 === undefined) continue;
    const a = parseTeam(team1);
    const b = parseTeam(team2);
    if (!a.club || !b.club) continue;

    const pool = textOf(cells.get(CELL.pool) ?? "");
    // Under a POULES header, the row's own pool ("Poule 1") names its phase and gives its pool number.
    const poolNumber = head.phase.toUpperCase() === "POULES" ? Number(/^Poule (\d+)$/i.exec(pool)?.[1] ?? 0) : 0;
    // "24/01/2026 reportée au 06/02/2026 à 18:30": a postponed match keeps its new date.
    const dates = textOf(cells.get(CELL.date) ?? "").match(/\b\d{2}\/\d{2}\/\d{4}\b/g);
    results.push({
      specialty: head.specialty,
      competition: head.competition,
      year,
      category: head.category,
      phase: head.phase.toUpperCase() === "POULES" && pool && pool !== "Poule 0" ? pool : head.phase,
      pool: poolNumber > 0 ? poolNumber : null,
      // The site has no pool phases.
      pool_phase: null,
      date_match: dates ? dates[dates.length - 1] : "",
      club_a: a.club,
      club_a_player1_name: a.players[0]?.name,
      club_a_player1_number: a.players[0]?.number,
      club_a_player2_name: a.players[1]?.name,
      club_a_player2_number: a.players[1]?.number,
      club_b: b.club,
      club_b_player1_name: b.players[0]?.name,
      club_b_player1_number: b.players[0]?.number,
      club_b_player2_name: b.players[1]?.name,
      club_b_player2_number: b.players[1]?.number,
      scores: parseScore(textOf(cells.get(CELL.score) ?? "")),
    });
  }
  return results;
}

// ── Session ───────────────────────────────────────────────────────────────────

/** One anonymous session on the guest home page. */
class Session {
  private constructor(
    private readonly url: string,
    private readonly jar: Map<string, string>,
    private readonly form: PageForm
  ) {}

  static async open(): Promise<Session> {
    const jar = new Map<string, string>();
    const home = await text(await send(`${ORIGIN}/FFPB_COMPETITION/`, jar), "home page");
    return new Session(ORIGIN + formAction(home, WEBDEV.homeForm), jar, parsePageForm(home));
  }

  list(control: string): Choice[] {
    return this.form.lists.get(control) ?? [];
  }

  chosen(control: string): Choice | undefined {
    const position = this.form.chosen.get(control);
    return this.list(control).find((c) => c.position === position);
  }

  /** The form fields in document order, with the given overrides. */
  private body(head: Record<string, string>, overrides: Record<string, string>): URLSearchParams {
    const body = new URLSearchParams(head);
    for (const field of this.form.fields) {
      if (field.name in head) continue;
      // Posted empty, as in the browser's requests.
      const value = field.name === "WD_JSON_PROPRIETE_" ? "" : field.value ?? this.form.chosen.get(field.name) ?? "";
      body.append(field.name, overrides[field.name] ?? value);
    }
    return body;
  }

  /**
   * Choose an option, as a browser does: fire the select's change event and
   * apply the lists and choices the answer carries.
   */
  async choose(control: string, choice: Choice): Promise<void> {
    this.form.chosen.set(control, choice.position);
    const head = { WD_ACTION_: "AJAXPAGE", EXECUTE: WEBDEV.changeEvent, WD_CONTEXTE_: control };
    const res = await send(this.url, this.jar, this.body(head, {}));
    const xml = await text(res, `${control} change`);
    if (!xml.includes("<WAJAX>")) {
      throw new UpstreamError(`[${LEAGUE}] The ${control} change did not answer WAJAX XML`, res.status, excerpt(xml));
    }
    for (const [alias, change] of parseAjaxLists(xml)) {
      if (change.choices) this.form.lists.set(alias, change.choices);
      if (change.chosen) this.form.chosen.set(alias, change.chosen);
    }
  }

  /** Show a season (VALMEM of the season select). False when the site does not list it. */
  async showSeason(season: string): Promise<boolean> {
    if (this.chosen(WEBDEV.season)?.id === season) return true;
    const choice = this.list(WEBDEV.season).find((c) => c.id === season);
    if (!choice) return false;
    await this.choose(WEBDEV.season, choice);
    return true;
  }

  /** Press the search button: the competitions page, filtered by the chosen options. */
  async search(): Promise<string> {
    const body = this.body({}, { WD_ACTION_: "", WD_BUTTON_CLICK_: WEBDEV.search });
    const res = await send(this.url, this.jar, body);
    const page = await text(res, "competitions page");
    // An error or session page would otherwise read as a table without rows.
    if (!page.includes(`<form name="${WEBDEV.competitionsForm}"`)) {
      throw new UpstreamError(`[${LEAGUE}] The search did not answer the competitions page`, res.status, excerpt(page));
    }
    return page;
  }

  /** What the shown season and type offer. */
  options(): FormOptions {
    const season = this.chosen(WEBDEV.season);
    const real = (control: string): Choice[] => this.list(control).filter(isReal);
    const plain = (c: Choice): FormOption => ({ sourceId: c.id, name: c.label });
    return {
      competitions: season
        ? real(WEBDEV.type).map((t) => ({ sourceId: `${season.id}-${t.id}`, name: `${t.label} ${season.label}` }))
        : [],
      specialties: real(WEBDEV.specialty).map(plain),
      // The home page has no club or phase select.
      clubs: [],
      categories: real(WEBDEV.category).map(plain),
      phases: [],
    };
  }
}

/**
 * One request of the session: sends the cookies of `jar` and stores the ones
 * the answer sets. getSetCookie() keeps each cookie whole, where a joined
 * Set-Cookie header would split on the commas of its `expires` date.
 *
 * Under workerd the request goes through a TLS socket, not fetch(): the site
 * pads its Content-Length with spaces, which the workerd HTTP client rejects
 * (see socket-fetch.ts). fetch() remains for Bun, where the tests mock it.
 */
async function send(url: string, jar: Map<string, string>, body?: URLSearchParams): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip",
  };
  if (jar.size > 0) headers["Cookie"] = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";

  const connect = await socketConnect();
  const method = body ? "POST" : "GET";
  const res = connect
    ? await socketFetch(connect, url, { method, headers, body: body?.toString() })
    : await fetch(url, body ? { method, headers, body: body.toString() } : { headers });
  for (const line of res.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return res;
}

/**
 * The body of an answer. A failed one throws with the site's status and the
 * start of its body, where WebDev names its error, for the logs.
 */
async function text(res: Response, what: string): Promise<string> {
  if (!res.ok) {
    throw await upstreamError(`[${LEAGUE}] Failed to fetch the ${what}: HTTP ${res.status} ${res.statusText}`, res);
  }
  return res.text();
}

// ── Scraper ───────────────────────────────────────────────────────────────────

/** "2026-1" (season and type), or "2026" (a season) where a type is optional. */
function parseCompetition(sourceId: string): { season: string; type?: string } | null {
  const m = /^(\d{4})(?:-(\d+))?$/.exec(sourceId);
  return m ? { season: m[1], type: m[2] } : null;
}

const EMPTY_FORM_OPTIONS: FormOptions = { competitions: [], specialties: [], clubs: [], categories: [], phases: [] };

function merge(all: FormOptions[]): FormOptions {
  const unique = (lists: FormOption[][]): FormOption[] => {
    const seen = new Map<string, FormOption>();
    for (const o of lists.flat()) if (!seen.has(o.sourceId)) seen.set(o.sourceId, o);
    return [...seen.values()];
  };
  return {
    competitions: unique(all.map((o) => o.competitions)),
    specialties: unique(all.map((o) => o.specialties)),
    clubs: unique(all.map((o) => o.clubs)),
    categories: unique(all.map((o) => o.categories)),
    phases: unique(all.map((o) => o.phases)),
  };
}

function offered(session: Session, control: string, id: string, label: string, scope: string): Choice {
  const choice = session.list(control).find((c) => c.id === id);
  if (!choice || !isReal(choice)) {
    throw new BadRequestError(`${label} '${id}' is not offered by the ${LEAGUE} site for ${scope}`);
  }
  return choice;
}

export class FfpbScraper implements LeagueScraper {
  readonly baseUrl = `${ORIGIN}/FFPB_COMPETITION/`;
  readonly resultsOneAtATime = true;

  /**
   * The form values for a competition source_id:
   * - `""`: every season the site lists, not only the one the home page shows;
   * - `<season>`: the season's competitions, and the specialties and categories
   *   of the whole season, every competition type included;
   * - `<season>-<type>`: the season's competitions, and the specialties and
   *   categories that competition offers, as the site narrows them once the type
   *   is chosen.
   * A season the site does not list offers nothing.
   */
  async fetchResultsForm(competition: string): Promise<FormOptions> {
    const wanted = competition ? parseCompetition(competition) : null;
    if (competition && !wanted) {
      throw new BadRequestError(`Invalid ${LEAGUE} competition '${competition}': expected <season>-<type> or <season>`);
    }
    const session = await Session.open();
    if (session.list(WEBDEV.season).length === 0) {
      throw new Error(`[${LEAGUE}] Season select not found on the home page`);
    }

    if (!wanted) {
      const all = [session.options()];
      const shown = session.chosen(WEBDEV.season)?.id;
      for (const season of session.list(WEBDEV.season)) {
        if (!isReal(season) || season.id === shown) continue;
        await session.showSeason(season.id);
        all.push(session.options());
      }
      return merge(all);
    }

    if (!(await session.showSeason(wanted.season))) return EMPTY_FORM_OPTIONS;
    if (wanted.type) {
      const type = session.list(WEBDEV.type).find((c) => c.id === wanted.type);
      if (type && isReal(type)) await session.choose(WEBDEV.type, type);
    }
    return session.options();
  }

  /** The results of one specialty and one category of a competition (`<season>-<type>`). */
  async fetchResults(options: ScrapeOptions): Promise<ScrapedResult[]> {
    const wanted = parseCompetition(options.competition);
    if (!wanted?.type) {
      throw new BadRequestError(`Invalid ${LEAGUE} competition '${options.competition}': expected <season>-<type>`);
    }
    if (options.specialty === "0" || options.category === "0") {
      throw new BadRequestError(
        `${LEAGUE} results are fetched for one specialty and one category at a time: pass both, not 0`
      );
    }
    if (options.phase && options.phase !== "0") {
      throw new BadRequestError(`${LEAGUE} results cannot be filtered by phase: pass phase=0`);
    }

    const started = Date.now();
    const session = await Session.open();
    if (!(await session.showSeason(wanted.season))) {
      throw new BadRequestError(`The ${LEAGUE} site does not list season ${wanted.season}`);
    }
    const season = session.chosen(WEBDEV.season)!;
    // Each choice narrows the next list, as on the site.
    const type = offered(session, WEBDEV.type, wanted.type, "Competition type", `season ${season.label}`);
    await session.choose(WEBDEV.type, type);
    const competitionName = `${type.label} ${season.label}`;
    const specialty = offered(session, WEBDEV.specialty, options.specialty, "Specialty", competitionName);
    await session.choose(WEBDEV.specialty, specialty);
    const category = offered(
      session, WEBDEV.category, options.category, "Category", `${competitionName}, ${specialty.label}`
    );
    await session.choose(WEBDEV.category, category);

    const page = await session.search();
    const count = parseCount(page);
    if (count && count.shown < count.total) {
      throw new Error(
        `[${LEAGUE}] The site lists ${count.total} matches but sent ${count.shown}: ` +
          `its "Afficher plus" paging is not supported`
      );
    }

    // The group headers must name what was asked for: anything else means the
    // positions did not match the lists the server holds.
    const results = parseRows(page, Number(season.id));
    for (const result of results) {
      const got = [result.competition, result.specialty, result.category];
      const want = [competitionName, specialty.label, category.label];
      if (got.some((g, i) => g !== want[i])) {
        throw new Error(`[${LEAGUE}] Asked for ${want.join(" / ")}, the site answered ${got.join(" / ")}`);
      }
    }
    log.info({
      event: "league.results",
      league: LEAGUE.toLowerCase(),
      found: results.length,
      pageSize: page.length,
      durationMs: Date.now() - started,
      message: `${competitionName} / ${specialty.label} / ${category.label}: ${results.length} results`,
    });
    return results;
  }

  /**
   * The site's Classement tab is not scraped yet: its rankings ("par poule",
   * "général à l'issue des poules", "général final") are switched by a
   * browser-side variable the AJAX request does not carry as a form field.
   */
  async openRankings(_competition: string): Promise<RankingSource> {
    return {
      listed: false,
      specialties: [],
      categories: [],
      async fetch(): Promise<never> {
        throw new Error(`[${LEAGUE}] Rankings are not supported`);
      },
    };
  }
}
