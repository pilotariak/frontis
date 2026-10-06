import { describe, expect, test } from "bun:test";
import { createLoader, createRowLoader, D1_MAX_BINDINGS } from "./loader.js";

interface Row {
  id: number;
  name: string;
}

describe("createLoader", () => {
  test("coalesces loads issued in the same tick into one batch", async () => {
    const calls: number[][] = [];
    const loader = createLoader<Row>(async (ids) => {
      calls.push(ids);
      return ids.map((id) => ({ id, name: `row-${id}` }));
    });

    const [a, b, c] = await Promise.all([loader.load(1), loader.load(2), loader.load(1)]);

    expect(calls).toEqual([[1, 2]]);
    expect(a).toEqual({ id: 1, name: "row-1" });
    expect(b).toEqual({ id: 2, name: "row-2" });
    expect(c).toBe(a);
  });

  test("resolves null for ids the batch did not return", async () => {
    const loader = createLoader<Row>(async (ids) =>
      ids.filter((id) => id !== 2).map((id) => ({ id, name: `row-${id}` }))
    );

    const [a, b] = await Promise.all([loader.load(1), loader.load(2)]);
    expect(a?.id).toBe(1);
    expect(b).toBeNull();
  });

  test("short-circuits invalid ids without calling the batch", async () => {
    let called = false;
    const loader = createLoader<Row>(async () => {
      called = true;
      return [];
    });

    expect(await loader.load(Number.NaN)).toBeNull();
    expect(await loader.load(-1)).toBeNull();
    expect(await loader.load(1.5)).toBeNull();
    expect(called).toBe(false);
  });

  test("splits batches to respect the D1 bound-parameter limit", async () => {
    const calls: number[][] = [];
    const loader = createLoader<Row>(async (ids) => {
      calls.push(ids);
      return ids.map((id) => ({ id, name: `row-${id}` }));
    });

    const n = D1_MAX_BINDINGS + 5;
    const rows = await Promise.all(Array.from({ length: n }, (_, i) => loader.load(i)));

    expect(calls.length).toBe(2);
    expect(calls[0].length).toBe(D1_MAX_BINDINGS);
    expect(calls[1].length).toBe(5);
    expect(rows.every((r, i) => r?.id === i)).toBe(true);
  });

  test("starts a fresh batch for loads issued after a flush", async () => {
    const calls: number[][] = [];
    const loader = createLoader<Row>(async (ids) => {
      calls.push(ids);
      return ids.map((id) => ({ id, name: `row-${id}` }));
    });

    await loader.load(1);
    await loader.load(2);

    expect(calls).toEqual([[1], [2]]);
  });

  test("rejects every pending load when the batch throws", async () => {
    const loader = createLoader<Row>(async () => {
      throw new Error("boom");
    });

    const results = await Promise.allSettled([loader.load(1), loader.load(2)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  });
});

describe("createRowLoader", () => {
  test("issues a single IN query with one placeholder per distinct id", async () => {
    const statements: { sql: string; bindings: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...bindings: unknown[]) {
            statements.push({ sql, bindings });
            return {
              async all() {
                return { results: bindings.map((id) => ({ id, name: `row-${id}` })) };
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const loader = createRowLoader<Row>(db, "SELECT id, name FROM clubs");
    const rows = await Promise.all([loader.load(7), loader.load(3), loader.load(7)]);

    expect(statements).toEqual([
      { sql: "SELECT id, name FROM clubs WHERE id IN (?, ?)", bindings: [7, 3] },
    ]);
    expect(rows.map((r) => r?.name)).toEqual(["row-7", "row-3", "row-7"]);
  });
});
