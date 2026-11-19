import { BadRequestError } from "../params";
import type { ScrapedResult } from "../types";
import { socketConnect, socketFetch } from "./socket-fetch";
import type { FormOption, FormOptions, LeagueScraper, RankingSource, ScrapeData, ScrapeOptions } from "./types";

/**
 * Scraper for competition.ffpb.net, the national competitions of the
 * Fédération Française de Pelote Basque. The site is a PC SOFT WebDev
 * application, not the euskalpilota.fr `resultats.php` of the other leagues.
 *
 * Every scrape opens its own anonymous session, as a browser does:
 *   1. GET /FFPB_COMPETITION/ sets the session cookies and returns the guest
 *      home page, whose form action carries a session token.
 *   2. POSTing the "Compétitions" link to that action returns the competitions
 *      page (about 690 KB), whose form action carries the next token.
 *   3. Each filter change is an AJAX POST to that action. It answers WAJAX
 *      XML: the new option lists of the filters, and the results table rows
 *      as HTML in CDATA sections.
 * A token from another session fails with HTTP 400 (CGI1910 ERR_BAD_URL), so
 * tokens are always read from the form actions, never stored.
 *
 * A `<select>` is posted as the 1-based position of the chosen option in the
 * list the server holds for the session, and that list changes with the
 * season. Each option also carries `data-wb-valmem` (VALMEM in the XML), the
 * site's own id, which does not change: source_ids are these ids, and the
 * scraper maps them to positions in the list it last received.
 *
 * A competition is a season and a competition type: source_id
 * `<season>-<type id>`, for example `2026-1`, named `CHAMPIONNAT DE FRANCE 2026`
 * as the results table heads it. The specialty, category and phase lists cover
 * the whole season, every type included.
 *
 * Changing the season makes the site reset every filter to TOUTES and answer
 * the first 50 rows of the whole season (about 630 KB), which no request can
 * avoid. Results are always asked for one specialty and one category: TOUTES
 * returns a very large page.
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
  /** The home page's "Compétitions" link. */
  competitionsLink: "A32",
  competitionsForm: "PAGE_COMPETITION_INVITE",
  /** The AJAX event a filter runs on change: `_JAEE(_PAGE_, "<id>", 47, …)`. */
  changeEvent: "47",
  season: "I5",
  type: "I4",
  /**
   * The page holds two specialty selects and two category selects with the
   * same options. The browser posts both of each pair; the first one of each
   * is the one the filter request changes.
   */
  specialties: ["I10", "I9"],
  categories: ["I12", "I7"],
  phase: "I227",
  club: "I223",
  /** The results table, and its "<shown> / <total> lignes" counter. */
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
  /** `data-wb-valmem`: the site's id. "0" (or "") for TOUTES / Tous. */
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

/** Lowercase, accent- and punctuation-free form of a label. */
const normalise = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

/** The controls of the competitions page, as a browser would post them. */
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
        const choice = { position: attr(o[1], "value") ?? "", id: attr(o[1], "data-wb-valmem") ?? "", label: collapse(decode(o[2])) };
        choices.push(choice);
        if (/\bselected\b/i.test(o[1])) selected = choice.position;
      }
      // A browser posts nothing for a select without options.
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

/** The body of each `<CHAMP ALIAS="…" TYPE="…">` of a WAJAX answer. */
function champs(xml: string, type: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(new RegExp(`<CHAMP ALIAS="([^"]+)" TYPE="${type}">([\\s\\S]*?)</CHAMP>`, "g"))) {
    out.set(m[1], m[2]);
  }
  return out;
}

/** New option lists of the filters, and the position each one now shows. */
export function parseAjaxLists(xml: string): Map<string, { choices: Choice[]; chosen: string }> {
  const out = new Map<string, { choices: Choice[]; chosen: string }>();
  for (const [alias, body] of champs(xml, "14")) {
    const choices = [...body.matchAll(/<OPTION\b([^>]*)>([^<]*)<\/OPTION>/g)].map((o, i) => ({
      position: String(i + 1),
      id: attr(o[1], "VALMEM") ?? "",
      label: collapse(decode(o[2])),
    }));
    // `.options[<0-based index>].selected=true`
    const selected = [...body.matchAll(/\.options\[(\d+)\]\.selected=true/g)].pop();
    out.set(alias, { choices, chosen: String(selected ? Number(selected[1]) + 1 : 1) });
  }
  return out;
}

/** "<shown> / <total> lignes" of the results table, when the answer has it. */
export function parseCount(xml: string): { shown: number; total: number } | null {
  const body = champs(xml, "3").get(WEBDEV.tableCount);
  const m = body ? /(\d+)\s*\/\s*(\d+)\s*lignes/.exec(body) : null;
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

/** One results row and the group headers it falls under. */
export interface FfpbRow {
  result: ScrapedResult;
  /** The group's phase header (POULES, 1/4 DE FINALE…), before the pool is applied. */
  phaseHeader: string;
}

/**
 * Rows of the results table of a WAJAX answer. Group headers (specialty,
 * category, competition, phase) are carried to the rows that follow them.
 * Under a POULES header the phase is the row's pool ("Poule 1"), otherwise
 * the header ("1/4 DE FINALE").
 */
export function parseRows(xml: string, year: number): FfpbRow[] {
  const rows: FfpbRow[] = [];
  const head = { specialty: "", category: "", competition: "", phase: "" };
  const OPEN = "<CORPS><![CDATA[";
  const CLOSE = "]]></CORPS>";

  for (let at = xml.indexOf(OPEN); at !== -1; at = xml.indexOf(OPEN, at)) {
    const end = xml.indexOf(CLOSE, at);
    if (end === -1) break;
    const corps = xml.slice(at + OPEN.length, end);
    at = end;

    const cells = new Map<string, string>();
    for (const m of corps.matchAll(/id="zrl_\d+_ATT_(I\d+)_1"[^>]*>([\s\S]*?)<\/td>/g)) cells.set(m[1], m[2]);

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
    const date = /\b\d{2}\/\d{2}\/\d{4}\b/.exec(textOf(cells.get(CELL.date) ?? ""));

    rows.push({
      phaseHeader: head.phase,
      result: {
        specialty: head.specialty,
        competition: head.competition,
        year,
        category: head.category,
        phase: normalise(head.phase) === "poules" && pool && pool !== "Poule 0" ? pool : head.phase,
        date_match: date ? date[0] : "",
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
      },
    });
  }
  return rows;
}

// ── Session ───────────────────────────────────────────────────────────────────

/** One anonymous session, opened on the competitions page. */
class Session {
  private occurrences: string | undefined;

  private constructor(
    private readonly url: string,
    private readonly jar: Map<string, string>,
    private readonly form: PageForm
  ) {}

  static async open(): Promise<Session> {
    const jar = new Map<string, string>();
    const home = await send(`${ORIGIN}/FFPB_COMPETITION/`, jar);
    const homeAction = formAction(await text(home, "home page"), WEBDEV.homeForm);

    const body = new URLSearchParams({ WD_ACTION_: "", WD_BUTTON_CLICK_: WEBDEV.competitionsLink });
    const page = await text(await send(ORIGIN + homeAction, jar, body), "competitions page");
    const action = formAction(page, WEBDEV.competitionsForm);
    console.log(`[${LEAGUE}] session opened: competitions page ${page.length}B, ${jar.size} cookies`);
    return new Session(ORIGIN + action, jar, parsePageForm(page));
  }

  list(control: string): Choice[] {
    return this.form.lists.get(control) ?? [];
  }

  chosen(control: string): Choice | undefined {
    const position = this.form.chosen.get(control);
    return this.list(control).find((c) => c.position === position);
  }

  /**
   * Fire the change event of a filter with the given select positions, as a
   * browser does when the filter changes, and apply the option lists the
   * answer carries. Returns the WAJAX answer.
   */
  async change(control: string, positions: Record<string, string>): Promise<string> {
    for (const [name, position] of Object.entries(positions)) this.form.chosen.set(name, position);

    const body = new URLSearchParams({ WD_ACTION_: "AJAXPAGE", EXECUTE: WEBDEV.changeEvent, WD_CONTEXTE_: control });
    for (const field of this.form.fields) {
      if (field.name === "WD_ACTION_") continue;
      let value = field.value ?? this.form.chosen.get(field.name) ?? "";
      // Posted empty, as in the browser request recorded in issue #107.
      if (field.name === "WD_JSON_PROPRIETE_") value = "";
      // How many rows the table already shows.
      if (field.name === `_${WEBDEV.table}_OCC` && this.occurrences !== undefined) value = this.occurrences;
      body.append(field.name, value);
    }

    const xml = await text(await send(this.url, this.jar, body), `${control} change`);
    if (!xml.includes("<WAJAX>")) {
      throw new Error(`[${LEAGUE}] The ${control} change did not answer WAJAX XML`);
    }
    for (const [alias, { choices, chosen }] of parseAjaxLists(xml)) {
      this.form.lists.set(alias, choices);
      this.form.chosen.set(alias, chosen);
    }
    const lines = new RegExp(`<CHAMP ALIAS="${WEBDEV.table}"[^>]*><LIGNES\\b[^>]*\\bNOMBRE="(\\d+)"`).exec(xml);
    if (lines) this.occurrences = lines[1];
    console.log(`[${LEAGUE}] ${control} change: ${xml.length}B`);
    return xml;
  }

  /**
   * Show the given season, a VALMEM of the season select. False when the
   * site does not list it. Changing the season resets every other filter.
   */
  async showSeason(season: string): Promise<boolean> {
    if (this.chosen(WEBDEV.season)?.id === season) return true;
    const choice = this.list(WEBDEV.season).find((c) => c.id === season);
    if (!choice) return false;
    await this.change(WEBDEV.season, { [WEBDEV.season]: choice.position });
    return true;
  }

  /** What the shown season offers. */
  options(): FormOptions {
    const season = this.chosen(WEBDEV.season);
    const real = (control: string): Choice[] => this.list(control).filter(isReal);
    const plain = (c: Choice): FormOption => ({ sourceId: c.id, name: c.label });
    return {
      competitions: season
        ? real(WEBDEV.type).map((t) => ({ sourceId: `${season.id}-${t.id}`, name: `${t.label} ${season.label}` }))
        : [],
      specialties: real(WEBDEV.specialties[0]).map(plain),
      // VALMEM "526:7611;6906;": the club id, then its teams.
      clubs: real(WEBDEV.club).map((c) => ({ sourceId: c.id.split(":")[0], name: c.label })),
      categories: real(WEBDEV.categories[0]).map(plain),
      phases: real(WEBDEV.phase).map(plain),
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

async function text(res: Response, what: string): Promise<string> {
  if (!res.ok) throw new Error(`[${LEAGUE}] Failed to fetch the ${what}: HTTP ${res.status} ${res.statusText}`);
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

function choose(session: Session, control: string, id: string, label: string): Choice {
  const choice = session.list(control).find((c) => c.id === id);
  if (!choice || !isReal(choice)) {
    throw new BadRequestError(`${label} '${id}' is not offered by the ${LEAGUE} site for this season`);
  }
  return choice;
}

export class FfpbScraper implements LeagueScraper {
  readonly baseUrl = `${ORIGIN}/FFPB_COMPETITION/`;

  async fetchData(options: ScrapeOptions, extractResults: boolean): Promise<ScrapeData> {
    return extractResults
      ? { formOptions: EMPTY_FORM_OPTIONS, results: await this.fetchResults(options) }
      : { formOptions: await this.fetchOptions(options.competition), results: [] };
  }

  /**
   * The form values of one season, or of every season the site lists when no
   * competition is given: one season change each, so a bootstrap needs one call.
   */
  private async fetchOptions(competition: string): Promise<FormOptions> {
    const session = await Session.open();
    if (competition) {
      const wanted = parseCompetition(competition);
      if (!wanted) {
        throw new BadRequestError(`Invalid ${LEAGUE} competition '${competition}': expected <season>-<type> or <season>`);
      }
      if (!(await session.showSeason(wanted.season))) return EMPTY_FORM_OPTIONS;
      return session.options();
    }

    const all = [session.options()];
    const shown = session.chosen(WEBDEV.season)?.id;
    for (const season of session.list(WEBDEV.season)) {
      if (!isReal(season) || season.id === shown) continue;
      await session.showSeason(season.id);
      all.push(session.options());
    }
    return merge(all);
  }

  async fetchResultsForm(competition: string): Promise<FormOptions> {
    const wanted = parseCompetition(competition);
    if (!wanted) throw new BadRequestError(`Invalid ${LEAGUE} competition '${competition}'`);
    const session = await Session.open();
    if (session.list(WEBDEV.season).length === 0) {
      throw new Error(`[${LEAGUE}] Season select not found on the competitions page`);
    }
    // A season the site does not list offers no competition.
    if (!(await session.showSeason(wanted.season))) return EMPTY_FORM_OPTIONS;
    return session.options();
  }

  private async fetchResults(options: ScrapeOptions): Promise<ScrapedResult[]> {
    const wanted = parseCompetition(options.competition);
    if (!wanted?.type) {
      throw new BadRequestError(`Invalid ${LEAGUE} competition '${options.competition}': expected <season>-<type>`);
    }
    if (options.specialty === "0" || options.category === "0") {
      throw new BadRequestError(
        `${LEAGUE} results are fetched for one specialty and one category at a time: pass both, not 0`
      );
    }

    const session = await Session.open();
    if (!(await session.showSeason(wanted.season))) {
      throw new BadRequestError(`The ${LEAGUE} site does not list season ${wanted.season}`);
    }
    const season = session.chosen(WEBDEV.season)!;
    const type = choose(session, WEBDEV.type, wanted.type, "Competition type");
    const [specialty, specialty2] = WEBDEV.specialties.map((c) => choose(session, c, options.specialty, "Specialty"));
    const [category, category2] = WEBDEV.categories.map((c) => choose(session, c, options.category, "Category"));
    const phase = options.phase && options.phase !== "0"
      ? choose(session, WEBDEV.phase, options.phase, "Phase")
      : null;

    const xml = await session.change(WEBDEV.categories[0], {
      [WEBDEV.season]: season.position,
      [WEBDEV.type]: type.position,
      [WEBDEV.specialties[0]]: specialty.position,
      [WEBDEV.specialties[1]]: specialty2.position,
      [WEBDEV.categories[0]]: category.position,
      [WEBDEV.categories[1]]: category2.position,
    });

    const count = parseCount(xml);
    if (count && count.shown < count.total) {
      throw new Error(
        `[${LEAGUE}] The site lists ${count.total} matches but sent ${count.shown}: ` +
          `its "Afficher plus" paging is not supported`
      );
    }

    // The group headers must name what was asked for: anything else means the
    // positions did not match the lists the server holds.
    const competitionName = `${type.label} ${season.label}`;
    const rows = parseRows(xml, Number(season.id));
    for (const { result } of rows) {
      const got = [result.competition, result.specialty, result.category];
      const want = [competitionName, specialty.label, category.label];
      if (got.some((g, i) => g !== want[i])) {
        throw new Error(`[${LEAGUE}] Asked for ${want.join(" / ")}, the site answered ${got.join(" / ")}`);
      }
    }

    const results = phase
      ? rows.filter((r) => normalise(r.phaseHeader) === normalise(phase.label)).map((r) => r.result)
      : rows.map((r) => r.result);
    console.log(
      `[${LEAGUE}] ${competitionName} / ${specialty.label} / ${category.label}: ${rows.length} rows, ${results.length} kept`
    );
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
