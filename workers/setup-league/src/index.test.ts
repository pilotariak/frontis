// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import worker from "./index";
import { UpstreamError } from "./log";
import * as scraper from "./scraper";
import type { Env } from "./types";

/** A D1 database holding one league row, `lcapb`. */
function leagueDb(): D1Database {
  const league = { id: 1, name: "Comité Côte d'Argent", acronym: "lcapb", url: "https://lcapb.euskalpilota.fr/resultats.php" };
  return {
    prepare: () => ({ bind: () => ({ first: async () => league }) }),
  } as unknown as D1Database;
}

function envWith(db: D1Database): Env {
  return { DB_LEAGUE_LCAPB: db, DB_LEAGUE_LIDFPB: db, DB_LEAGUE_CTPB: db, DB_LEAGUE_LLPB: db, DB_LEAGUE_FFPB: db };
}

const get = (path: string) => worker.fetch(new Request(`https://setup-league.internal${path}`), envWith(leagueDb()));
const body = (res: Response) => res.json() as Promise<Record<string, unknown>>;

let logs: unknown[][];
let errors: unknown[][];

beforeEach(() => {
  logs = [];
  errors = [];
  spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a));
  spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a));
});

afterEach(() => mock.restore());

describe("route logs", () => {
  test("/bootstrap logs the league site failure it returns, the answer unchanged", async () => {
    spyOn(scraper, "scrapeFormOptions").mockRejectedValue(
      new UpstreamError("Failed to fetch https://lcapb.euskalpilota.fr/resultats.php: ", 503, "Service indisponible")
    );

    const res = await get("/bootstrap?league=lcapb&competition_source_id=20260501");

    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: "Failed to fetch https://lcapb.euskalpilota.fr/resultats.php: " });
    expect(errors).toEqual([
      [
        {
          event: "route.error",
          route: "/bootstrap",
          league: "lcapb",
          competition: "20260501",
          dryRun: "true",
          status: 500,
          durationMs: expect.any(Number),
          message: "Failed to fetch https://lcapb.euskalpilota.fr/resultats.php: ",
          upstreamStatus: 503,
          upstreamBody: "Service indisponible",
        },
      ],
    ]);
  });

  test("/init logs a missing parameter as a 400", async () => {
    const res = await get("/init?acronym=lcapb");

    expect(res.status).toBe(400);
    expect(await body(res)).toEqual({ error: "missing required parameters: name, url, acronym" });
    expect(errors).toEqual([
      [
        {
          event: "route.error",
          route: "/init",
          league: "lcapb",
          status: 400,
          durationMs: expect.any(Number),
          message: "missing required parameters: name, url, acronym",
        },
      ],
    ]);
  });

  test("/bootstrap logs what it read as one object", async () => {
    spyOn(scraper, "scrapeFormOptions").mockResolvedValue({
      competitions: [{ sourceId: "20260501", name: "Championnat 2026" }],
      specialties: [{ sourceId: "2", name: "Trinquet" }],
      categories: [],
    });

    const res = await get("/bootstrap?league=lcapb");

    expect(res.status).toBe(200);
    expect(logs).toEqual([
      [
        {
          event: "route.done",
          route: "/bootstrap",
          league: "lcapb",
          dryRun: "true",
          status: 200,
          found: 2,
          durationMs: expect.any(Number),
          message: "1 competitions, 1 specialties, 0 categories",
        },
      ],
    ]);
    expect(errors).toEqual([]);
  });
});
