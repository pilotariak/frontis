// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

/**
 * Structured logs for Workers Logs.
 *
 * Each console call logs one object. Workers Logs indexes the keys of a logged
 * object as fields, so a query can filter and group on them, where a prefixed
 * string can only be searched as text. The field names are fixed here and
 * listed in docs/reference/logs.md: keep both in step.
 */

/** The fields of a log line. Every value is a string or a number. */
export interface LogFields {
  /** What happened, as a dotted name: `route.error`, `cron.results`, … */
  event: string;
  /** A sentence a person can read without the other fields. */
  message: string;
  /** The path of the request: `/scrape_results`, `/admin/options`, … */
  route?: string;
  /** League code: `lcapb`, `ffpb`, … */
  league?: string;
  /** The ids the request or the cron named, as given. */
  competition?: string;
  specialty?: string;
  category?: string;
  phase?: string;
  /** "true" or "false", when the request named `dry_run`. */
  dryRun?: string;
  /** The HTTP status the route answered. */
  status?: number;
  /** Rows read from the league site. */
  found?: number;
  /** Rows written to D1. */
  saved?: number;
  /** Rows left out, or self-calls that failed in a cron summary. */
  skipped?: number;
  failed?: number;
  /** Distinct "specialty / category" labels of the skipped rows, capped. */
  missing?: string;
  /** Wall time, in milliseconds. */
  durationMs?: number;
  /** The status the league site answered, and the start of its body. */
  upstreamStatus?: number;
  upstreamBody?: string;
  /** Characters of the page read from the league site. */
  pageSize?: number;
  /** The cron expression that started the run. */
  cron?: string;
}

/** Drop the unset fields, so a line holds only what it knows. */
function entry(fields: LogFields): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// console is read at each call, not captured once, so tests can spy on it.
export const log = {
  info: (fields: LogFields): void => console.log(entry(fields)),
  warn: (fields: LogFields): void => console.warn(entry(fields)),
  error: (fields: LogFields): void => console.error(entry(fields)),
};

// ── Upstream failures ─────────────────────────────────────────────────────────

/** Characters of an upstream body kept in a log line. */
export const EXCERPT_LENGTH = 200;

/** Characters of markup read, then characters of text redacted, before the excerpt is cut. */
const SCAN_LENGTH = 65_536;
const TEXT_LENGTH = 2_000;

/**
 * `name=value` or `name: value` where the name is a session id, a token or a
 * secret, alone or after a prefix: `PHPSESSID=…`, `access_token=…`, `X-Auth: …`,
 * `"token": "…"`.
 */
const SECRET_PAIR =
  /\b((?:[\w-]*[_-])?(?:phpsessid|session(?:[_-]?id)?|sess[_-]?id|sid|token|cookie|auth(?:orization)?|secret|passw(?:or)?d|jwt|api[_-]?key))(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s"'<>&;,()]+)/gi;
/** A long run of letters, digits and URL-safe symbols: a token, a hash or a path holding one. */
const OPAQUE = /[\w+/=-]{32,}/g;

/**
 * The markup without its scripts and styles, an unclosed one running to the
 * end. One pass: every regex here stops at the next "<" or ">", so a page of
 * unclosed tags costs no more CPU than a plain one.
 */
function dropCode(html: string): string {
  let out = "";
  let from = 0;
  let inside: string | null = null;
  for (const m of html.matchAll(/<(\/?)(script|style)\b[^<>]*>/gi)) {
    const name = m[2].toLowerCase();
    if (inside === null && !m[1]) {
      out += `${html.slice(from, m.index)} `;
      inside = name;
    } else if (inside === name && m[1]) {
      from = m.index + m[0].length;
      inside = null;
    }
  }
  return inside === null ? out + html.slice(from) : out;
}

/**
 * The start of an upstream body, safe to log: tags, scripts and styles dropped,
 * session ids, tokens and other secrets replaced by [redacted], whitespace
 * collapsed, cut to about EXCERPT_LENGTH characters. Error pages of WebDev and
 * PHP name their error in their text, which the excerpt keeps.
 */
export function excerpt(body: string): string {
  let text = dropCode(body.slice(0, SCAN_LENGTH))
    .replace(/<[^<>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Redact a bounded text, cut before its last word so no token is cut in two.
  if (text.length > TEXT_LENGTH) text = text.slice(0, Math.max(0, text.lastIndexOf(" ", TEXT_LENGTH)));
  text = text.replace(SECRET_PAIR, "$1$2[redacted]").replace(OPAQUE, "[redacted]").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text;
}

/**
 * A league site answer the scraper cannot use. The message is the one the
 * route returns; the status and the body excerpt only go to the logs.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus: number,
    readonly upstreamBody: string
  ) {
    super(message);
  }
}

/**
 * An UpstreamError for an answer, its body read for the excerpt. A body that
 * cannot be read leaves the excerpt empty, never hides the failure.
 */
export async function upstreamError(message: string, res: Response): Promise<UpstreamError> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    // Keep the status: it is what the log needs most.
  }
  return new UpstreamError(message, res.status, excerpt(body));
}

/** The message of an error, and the league site's status and body when it carries them. */
export function errorFields(err: unknown): Pick<LogFields, "message" | "upstreamStatus" | "upstreamBody"> {
  if (err instanceof UpstreamError) {
    return { message: err.message, upstreamStatus: err.upstreamStatus, upstreamBody: err.upstreamBody };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** The route and the parameters the request named, as it gave them. */
export function routeFields(url: URL): Pick<
  LogFields,
  "route" | "league" | "competition" | "specialty" | "category" | "phase" | "dryRun"
> {
  const param = (name: string) => url.searchParams.get(name) ?? undefined;
  return {
    route: url.pathname,
    league: param("league"),
    competition: param("competition"),
    specialty: param("specialty"),
    category: param("category"),
    phase: param("phase"),
    dryRun: param("dry_run"),
  };
}

/** Log an error a route answers: its parameters, the status it returns and why. */
export function logRouteError(url: URL, started: number, status: number, err: unknown): void {
  log.error({
    event: "route.error",
    ...routeFields(url),
    status,
    durationMs: Date.now() - started,
    ...errorFields(err),
  });
}

/** Log a scrape a route answered with its counts. */
export function logRouteDone(
  url: URL,
  started: number,
  counts: { found: number; saved?: number },
  message: string
): void {
  log.info({
    event: "route.done",
    ...routeFields(url),
    status: 200,
    ...counts,
    durationMs: Date.now() - started,
    message,
  });
}

// ── Skipped rows ──────────────────────────────────────────────────────────────

/** Distinct labels named in one warning; the rest are counted. */
export const MAX_LABELS = 10;

/** "a; b; c", or "a; …; j (+3 more)" past MAX_LABELS. */
export function labelList(labels: Iterable<string>): string {
  const all = [...new Set(labels)];
  const shown = all.slice(0, MAX_LABELS).join("; ");
  return all.length > MAX_LABELS ? `${shown} (+${all.length - MAX_LABELS} more)` : shown;
}
