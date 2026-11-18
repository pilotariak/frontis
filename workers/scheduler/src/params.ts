import type { FormOption } from "./leagues/types";

/**
 * A request the caller must fix: /scrape_results and /scrape_rankings answer
 * it with HTTP 400. Any other error is ours or the league site's (HTTP 500).
 */
export class BadRequestError extends Error {}

/** A lookup row named by a request parameter. */
export interface LookupRow {
  id: number;
  source_id: string;
  name: string;
}

/**
 * Database ids are non-negative integers, "0" standing for every one. Check
 * every one before the first query, so a typo is reported as such.
 */
export function checkIds(params: Record<string, string>): void {
  for (const [name, value] of Object.entries(params)) {
    if (!/^\d+$/.test(value)) throw new BadRequestError(`Invalid ${name}: '${value}'`);
  }
}

/**
 * The row behind a database id given as a request parameter. `allowAll`
 * accepts "0", meaning every one, and returns null for it.
 */
export async function lookup(
  db: D1Database,
  table: string,
  id: string,
  label: string,
  allowAll: boolean
): Promise<LookupRow | null> {
  if (allowAll && id === "0") return null;
  const row = await db
    .prepare(`SELECT id, source_id, name FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ id: number; source_id: string | null; name: string }>();
  if (!row?.source_id) {
    throw new BadRequestError(`${label} with id '${id}' not found in database. Run /scrape_infos first.`);
  }
  return { id: row.id, source_id: row.source_id, name: row.name };
}

/** source_id → id for the given source_ids; the oldest row wins a duplicate. */
export async function idsBySourceId(
  db: D1Database,
  table: string,
  sourceIds: string[]
): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  const distinct = [...new Set(sourceIds)];
  if (distinct.length === 0) return ids;
  const { results } = await db
    .prepare(`SELECT id, source_id FROM ${table} WHERE source_id IN (${distinct.map(() => "?").join(", ")}) ORDER BY id`)
    .bind(...distinct)
    .all<{ id: number; source_id: string }>();
  for (const r of results) if (!ids.has(r.source_id)) ids.set(r.source_id, r.id);
  return ids;
}

/**
 * Narrow what the competition offers on the league site to the requested row,
 * or fail with the offered choices as database ids, so the caller can pick a
 * valid one. A null `wanted` ("0") keeps every offered choice.
 */
export async function pick(
  db: D1Database,
  table: string,
  offered: FormOption[],
  wanted: LookupRow | null,
  label: string,
  competition: string
): Promise<FormOption[]> {
  if (!wanted) return offered;
  const match = offered.find((o) => o.sourceId === wanted.source_id);
  if (match) return [match];

  const ids = await idsBySourceId(db, table, offered.map((o) => o.sourceId));
  const choices = offered.map((o) => {
    const id = ids.get(o.sourceId);
    return id === undefined ? `? (${o.name}, source_id ${o.sourceId} not in database)` : `${id} (${o.name})`;
  });
  throw new BadRequestError(
    `${label} ${wanted.id} (${wanted.name}) is not offered by ${competition}. ` +
      `Offered: ${choices.length > 0 ? choices.join(", ") : "none"}`
  );
}
