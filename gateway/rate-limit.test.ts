// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { buildSchema, graphql } from "graphql";
import {
  clientIdentifier,
  createRateLimitPlugin,
  RATE_LIMITED_FIELDS,
  type RateLimiter,
} from "./rate-limit.js";

// Small stand-in for the supergraph: one list field, one item field and one
// field that is not rate limited.
const SDL = `
  type Club { id: ID!, name: String! }
  type Query {
    echo: String
    clubs: [Club!]
    club(id: ID!): Club
  }
`;

const rootValue = {
  echo: "pong",
  clubs: [{ id: "1", name: "Aviron Bayonnais" }],
  club: { id: "1", name: "Aviron Bayonnais" },
};

function fakeLimiter(
  allow: (key: string) => boolean = () => true
): RateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success: allow(key) };
    },
  };
}

function setup(plugin: ReturnType<typeof createRateLimitPlugin>) {
  const schema = buildSchema(SDL);
  plugin.onSchemaChange({ schema });
  return (source: string, headers: Record<string, string> = { "cf-connecting-ip": "203.0.113.1" }) =>
    graphql({
      schema,
      source,
      rootValue,
      contextValue: { request: new Request("https://gateway.test/graphql", { headers }) },
    });
}

describe("createRateLimitPlugin", () => {
  test("routes list and item fields to their binding with a client:field key", async () => {
    const list = fakeLimiter();
    const item = fakeLimiter();
    const run = setup(createRateLimitPlugin({ list, item }));

    const result = await run(`{ clubs { id } club(id: "1") { name } }`);

    expect(result.errors).toBeUndefined();
    expect(list.keys).toEqual(["203.0.113.1:clubs"]);
    expect(item.keys).toEqual(["203.0.113.1:club"]);
  });

  test("does not call the limiter for fields that are not rate limited", async () => {
    const list = fakeLimiter();
    const item = fakeLimiter();
    const run = setup(createRateLimitPlugin({ list, item }));

    const result = await run(`{ echo }`);

    expect(result).toEqual({ data: { echo: "pong" } });
    expect(list.keys).toEqual([]);
    expect(item.keys).toEqual([]);
  });

  test("counts each alias as one call", async () => {
    const list = fakeLimiter();
    const run = setup(createRateLimitPlugin({ list }));

    await run(`{ a: clubs { id } b: clubs { id } }`);

    expect(list.keys).toEqual(["203.0.113.1:clubs", "203.0.113.1:clubs"]);
  });

  test("returns a field-level rate-limit error and still resolves the other fields", async () => {
    const list = fakeLimiter(() => false);
    const item = fakeLimiter();
    const run = setup(createRateLimitPlugin({ list, item }));

    const result = await run(`{ echo limited: clubs { id } club(id: "1") { name } }`);

    expect(result.data).toEqual({
      echo: "pong",
      limited: null,
      club: { name: "Aviron Bayonnais" },
    });
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors!;
    expect(error.message).toBe('Rate limit of "Query.clubs" exceeded for "203.0.113.1"');
    expect(error.path).toEqual(["limited"]);
    expect(error.locations).toEqual([{ line: 1, column: 8 }]);
    expect(error.extensions).toEqual({
      http: { statusCode: 429, headers: { "Retry-After": "60" } },
    });
  });

  test("fails open: a throwing limiter is logged and the field resolves", async () => {
    const logged: unknown[][] = [];
    const list: RateLimiter = {
      limit: () => Promise.reject(new Error("binding unavailable")),
    };
    const run = setup(
      createRateLimitPlugin({ list, logger: { error: (...args: unknown[]) => logged.push(args) } })
    );

    const result = await run(`{ clubs { id } }`);

    expect(result).toEqual({ data: { clubs: [{ id: "1" }] } });
    expect(logged).toHaveLength(1);
    expect(logged[0][0]).toContain("Query.clubs");
    expect((logged[0][1] as Error).message).toBe("binding unavailable");
  });

  test("leaves fields unwrapped when their binding is missing", async () => {
    const item = fakeLimiter(() => false);
    const run = setup(createRateLimitPlugin({ item }));

    const result = await run(`{ clubs { id } }`);

    expect(result).toEqual({ data: { clubs: [{ id: "1" }] } });
    expect(item.keys).toEqual([]);
  });

  test("wraps each resolver once when the schema change fires twice", async () => {
    const list = fakeLimiter();
    const plugin = createRateLimitPlugin({ list });
    const schema = buildSchema(SDL);
    plugin.onSchemaChange({ schema });
    plugin.onSchemaChange({ schema });

    await graphql({ schema, source: `{ clubs { id } }`, rootValue, contextValue: {} });

    expect(list.keys).toEqual(["unknown:clubs"]);
  });

  test("a client cannot get a fresh bucket by changing x-forwarded-for", async () => {
    const list = fakeLimiter();
    const run = setup(createRateLimitPlugin({ list }));

    await run(`{ clubs { id } }`, { "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.1" });
    await run(`{ clubs { id } }`, { "cf-connecting-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.2" });

    expect(list.keys).toEqual(["203.0.113.1:clubs", "203.0.113.1:clubs"]);
  });

  test("keeps the list and item split of the previous configuration", () => {
    expect(RATE_LIMITED_FIELDS.list).toEqual([
      "categories",
      "clubs",
      "competitions",
      "results",
      "rankings",
      "playerRankings",
      "specialties",
    ]);
    expect(RATE_LIMITED_FIELDS.item).toEqual([
      "category",
      "club",
      "competition",
      "result",
      "teamRanking",
      "specialty",
    ]);
  });
});

describe("clientIdentifier", () => {
  test("prefers cf-connecting-ip", () => {
    const headers = new Headers({
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "198.51.100.1",
      host: "frontis-gateway.pilotariak.com",
    });
    expect(clientIdentifier(headers)).toBe("203.0.113.1");
  });

  test("falls back to x-forwarded-for, then host, then a constant", () => {
    expect(clientIdentifier(new Headers({ "x-forwarded-for": "198.51.100.1", host: "localhost:4000" }))).toBe(
      "198.51.100.1"
    );
    expect(clientIdentifier(new Headers({ host: "localhost:4000" }))).toBe("localhost:4000");
    expect(clientIdentifier(new Headers())).toBe("unknown");
    expect(clientIdentifier(undefined)).toBe("unknown");
  });
});
