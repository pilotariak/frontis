/**
 * Per-request batching for entity lookups by primary key.
 *
 * When the gateway resolves a cross-subgraph field it sends ONE `_entities`
 * query carrying many representations, and @apollo/subgraph calls
 * `__resolveReference` once per representation, synchronously, in a loop.
 * A naive resolver therefore issues one `SELECT ... WHERE id = ?` per entity
 * (N+1). This loader queues every `load(id)` made during the current
 * synchronous tick and flushes them in a microtask as a single
 * `WHERE id IN (...)` statement.
 *
 * Create one loader per request (in the Yoga `context` factory) so entries
 * are never shared across requests or leagues.
 */

/** D1 rejects statements with more than 100 bound parameters. */
export const D1_MAX_BINDINGS = 100;

export interface Loader<Row, K extends number | string = number> {
  /** Resolve a row by id, or null when it does not exist. */
  load(id: K): Promise<Row | null>;
}

interface Pending<Row, K> {
  id: K;
  resolve: (row: Row | null) => void;
  reject: (err: unknown) => void;
}

/**
 * Build a loader from a batch function that fetches rows for a set of
 * distinct ids. The batch function may return rows in any order; missing ids
 * resolve to null. Ids are chunked so each call stays within D1's bound
 * parameter limit.
 */
export function createLoader<Row extends { id: K }, K extends number | string = number>(
  batch: (ids: K[]) => Promise<Row[]>,
  maxBatchSize: number = D1_MAX_BINDINGS,
): Loader<Row, K> {
  let queue: Pending<Row, K>[] = [];

  async function flush(): Promise<void> {
    const pending = queue;
    queue = [];

    const ids = [...new Set(pending.map((p) => p.id))];
    const chunks: K[][] = [];
    for (let i = 0; i < ids.length; i += maxBatchSize) {
      chunks.push(ids.slice(i, i + maxBatchSize));
    }

    try {
      const rows = (await Promise.all(chunks.map((chunk) => batch(chunk)))).flat();
      const byId = new Map<K, Row>();
      for (const row of rows) byId.set(row.id, row);
      for (const p of pending) p.resolve(byId.get(p.id) ?? null);
    } catch (err) {
      for (const p of pending) p.reject(err);
    }
  }

  return {
    load(id: K): Promise<Row | null> {
      // Reject garbage before it reaches the database; the gateway only ever
      // sends ids it previously got from us, so this is defensive.
      if (typeof id === "number" && (!Number.isInteger(id) || id < 0)) return Promise.resolve(null);

      return new Promise<Row | null>((resolve, reject) => {
        if (queue.length === 0) queueMicrotask(() => void flush());
        queue.push({ id, resolve, reject });
      });
    },
  };
}

/**
 * Loader backed by a D1 table: `select` is the projection and table, e.g.
 * `"SELECT id, name FROM clubs"`; the loader appends `WHERE id IN (?, ...)`.
 */
export function createRowLoader<Row extends { id: number }>(
  db: D1Database,
  select: string,
): Loader<Row> {
  return createLoader<Row>(async (ids) => {
    const placeholders = ids.map(() => "?").join(", ");
    const { results } = await db
      .prepare(`${select} WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<Row>();
    return results;
  });
}

/**
 * One-to-many variant: `load(key)` resolves to every row `batch` returns for
 * that key (an empty list when there is none), `keyOf` telling which key a row
 * belongs to. Used for `Player` statistics, so the matches of every player of
 * a list come back in one statement instead of one per player.
 */
export function createGroupLoader<Row, K extends number | string>(
  batch: (keys: K[]) => Promise<Row[]>,
  keyOf: (row: Row) => K,
): { load(key: K): Promise<Row[]> } {
  const loader = createLoader<{ id: K; rows: Row[] }, K>(async (keys) => {
    const groups = new Map<K, Row[]>(keys.map((key) => [key, []]));
    for (const row of await batch(keys)) groups.get(keyOf(row))?.push(row);
    return [...groups].map(([id, rows]) => ({ id, rows }));
  });
  return {
    async load(key: K): Promise<Row[]> {
      return (await loader.load(key))?.rows ?? [];
    },
  };
}
