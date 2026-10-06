import { describe, expect, test } from "bun:test";
import { buildSchema, parse, validate } from "graphql";
import {
  createCostAnalysisRule,
  createMaxDepthRule,
  createMaxDirectivesRule,
  createMaxTokensRule,
  type ValidationRule,
} from "./validation.js";

// Small stand-in for the supergraph: enough shape to exercise nesting, lists
// and arguments without depending on the composed schema file.
const schema = buildSchema(`
  type Club { id: ID!, name: String!, results(limit: Int): [Result!]! }
  type Result { id: ID!, clubA: Club!, clubB: Club!, scores: String }
  type Query {
    echo: String
    club(id: ID!): Club
    clubs: [Club!]!
    results(limit: Int, offset: Int): [Result!]!
  }
`);

function errorsFor(query: string, rule: ValidationRule): string[] {
  return validate(schema, parse(query), [rule]).map((e) => e.message);
}

describe("createMaxDepthRule", () => {
  test("accepts a query at exactly the limit", () => {
    // clubs → results → clubA → name = depth 4
    const q = `{ clubs { results { clubA { name } } } }`;
    expect(errorsFor(q, createMaxDepthRule(4))).toEqual([]);
  });

  test("rejects a query one level past the limit, reporting the depth found", () => {
    const q = `{ clubs { results { clubA { results { id } } } } }`;
    expect(errorsFor(q, createMaxDepthRule(4))).toEqual([
      "Query depth limit of 4 exceeded (depth: 5).",
    ]);
  });

  test("measures depth per nested selection, not per sibling field", () => {
    const q = `{ echo clubs { id name } results { id scores } }`;
    expect(errorsFor(q, createMaxDepthRule(2))).toEqual([]);
  });
});

describe("createMaxTokensRule", () => {
  test("counts fields and arguments together", () => {
    // 3 fields (club, id, name) + 1 argument = 4 tokens
    const q = `{ club(id: "1") { id name } }`;
    expect(errorsFor(q, createMaxTokensRule(4))).toEqual([]);
    expect(errorsFor(q, createMaxTokensRule(3))).toEqual([
      "Query token limit of 3 exceeded (tokens: 4).",
    ]);
  });

  test("counts aliased repeats of the same field", () => {
    const q = `{ a: echo b: echo c: echo }`;
    expect(errorsFor(q, createMaxTokensRule(2))).toEqual([
      "Query token limit of 2 exceeded (tokens: 3).",
    ]);
  });
});

describe("createMaxDirectivesRule", () => {
  test("ignores queries with no directives", () => {
    expect(errorsFor(`{ echo }`, createMaxDirectivesRule(0))).toEqual([]);
  });

  test("rejects directive explosion", () => {
    const q = `query ($x: Boolean = true) { echo @include(if: $x) @skip(if: false) }`;
    expect(errorsFor(q, createMaxDirectivesRule(1))).toEqual([
      "Query directive limit of 1 exceeded (directives: 2).",
    ]);
  });
});

describe("createCostAnalysisRule", () => {
  test("charges default list and field costs when no cost map entry matches", () => {
    // clubs = list (10) + id (1) + name (1) = 12
    const q = `{ clubs { id name } }`;
    expect(errorsFor(q, createCostAnalysisRule(12))).toEqual([]);
    expect(errorsFor(q, createCostAnalysisRule(11))).toEqual([
      "Query cost limit of 11 exceeded (cost: 12).",
    ]);
  });

  test("cost map entries override the defaults, including a zero cost", () => {
    const costMap = { Query: { echo: 0, clubs: 15 }, Club: { results: 20 } };
    // clubs (15) + results (20) + id (1) = 36; echo is free
    const q = `{ echo clubs { results { id } } }`;
    expect(errorsFor(q, createCostAnalysisRule(36, costMap))).toEqual([]);
    expect(errorsFor(q, createCostAnalysisRule(35, costMap))).toEqual([
      "Query cost limit of 35 exceeded (cost: 36).",
    ]);
  });

  test("treats non-null wrapped lists as lists", () => {
    // results is [Result!]! → list cost
    const q = `{ results { id } }`;
    expect(errorsFor(q, createCostAnalysisRule(10, {}, 10, 1))).toEqual([
      "Query cost limit of 10 exceeded (cost: 11).",
    ]);
  });

  test("custom default costs are honoured", () => {
    // results (list=3) + id (field=2) = 5
    const q = `{ results { id } }`;
    expect(errorsFor(q, createCostAnalysisRule(5, {}, 3, 2))).toEqual([]);
    expect(errorsFor(q, createCostAnalysisRule(4, {}, 3, 2))).toEqual([
      "Query cost limit of 4 exceeded (cost: 5).",
    ]);
  });

  test("aliasing an expensive field multiplies its cost", () => {
    const costMap = { Query: { results: 60 } };
    const q = `{ a: results { id } b: results { id } }`;
    expect(errorsFor(q, createCostAnalysisRule(121, costMap))).toEqual([
      "Query cost limit of 121 exceeded (cost: 122).",
    ]);
  });
});

describe("rule state", () => {
  test("a single rule instance can validate several documents independently", () => {
    const rule = createMaxDepthRule(2);
    expect(errorsFor(`{ clubs { results { id } } }`, rule)).toHaveLength(1);
    // Counters reset on Document leave; a shallow query must pass afterwards.
    expect(errorsFor(`{ echo }`, rule)).toEqual([]);
  });
});
