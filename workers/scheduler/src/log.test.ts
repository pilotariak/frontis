// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  EXCERPT_LENGTH,
  errorFields,
  excerpt,
  labelList,
  log,
  logRouteError,
  MAX_LABELS,
  upstreamError,
  UpstreamError,
} from "./log";

afterEach(() => mock.restore());

describe("log", () => {
  test("logs one object per call, without the unset fields", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    log.warn({ event: "results.skipped", league: "lcapb", competition: undefined, skipped: 2, message: "Skipped 2" });
    expect(warn.mock.calls).toEqual([[{ event: "results.skipped", league: "lcapb", skipped: 2, message: "Skipped 2" }]]);
  });

  test("a route error carries the request's parameters, as given", () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const url = new URL("https://scheduler.internal/scrape_results?league=ffpb&competition=12&specialty=55&category=1&phase=0");
    logRouteError(url, Date.now(), 400, "Category '1' is not offered");
    expect(error.mock.calls[0]).toEqual([
      {
        event: "route.error",
        route: "/scrape_results",
        league: "ffpb",
        competition: "12",
        specialty: "55",
        category: "1",
        phase: "0",
        status: 400,
        durationMs: expect.any(Number),
        message: "Category '1' is not offered",
      },
    ]);
  });
});

describe("excerpt", () => {
  test("keeps the text of the page, whitespace collapsed", () => {
    expect(excerpt("<html>\n<body>\n  <h1>Erreur</h1>\n\t<p>CGI1910   ERR_BAD_URL</p></body></html>")).toBe(
      "Erreur CGI1910 ERR_BAD_URL"
    );
  });

  test("drops scripts and styles", () => {
    expect(excerpt("<script>var token = 'x';</script><style>p{}</style><p>Indisponible</p>")).toBe("Indisponible");
  });

  test("cuts the text to about 200 characters", () => {
    const cut = excerpt("mot ".repeat(100));
    expect(cut.length).toBe(EXCERPT_LENGTH + 1);
    expect(cut.endsWith("…")).toBe(true);
  });

  test.each([
    ["PHPSESSID=3f2a9c1d7e", "PHPSESSID=[redacted]"],
    ["session_id: 3f2a9c1d7e", "session_id: [redacted]"],
    ["?access_token=abc.def&page=2", "?access_token=[redacted]&page=2"],
    ["Set-Cookie: FOO", "Set-Cookie: [redacted]"],
    ["password='hunter2'", "password=[redacted]"],
    ['{"token":"abc123","sid": "x9"}', '{"token":[redacted],"sid": [redacted]}'],
    ["/FFPB_COMPETITION/PAGE_ACCUEIL_INVITE/AWPQ7XUFTQ2BDKE4GUXZ6JMC3HDNN5RVO", "[redacted]"],
  ])("redacts %p", (body, expected) => {
    expect(excerpt(body)).toBe(expected);
  });

  test("leaves the words that only contain a secret's name", () => {
    expect(excerpt("Consider: the inside: tokens")).toBe("Consider: the inside: tokens");
  });
});

describe("upstreamError", () => {
  test("keeps the message, the status and the excerpt", async () => {
    const err = await upstreamError("[LCAPB] Failed to fetch page: ", new Response("<p>Bad gateway</p>", { status: 502 }));
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err).toMatchObject({ message: "[LCAPB] Failed to fetch page: ", upstreamStatus: 502, upstreamBody: "Bad gateway" });
  });

  test("keeps the status when the body cannot be read", async () => {
    const res = new Response("gone", { status: 504 });
    await res.text();
    const err = await upstreamError("[CTPB] Failed to fetch page: ", res);
    expect(err).toMatchObject({ upstreamStatus: 504, upstreamBody: "" });
  });
});

describe("errorFields", () => {
  test("adds the league site's status and body for an upstream failure only", () => {
    expect(errorFields(new UpstreamError("boom", 500, "Fatal error"))).toEqual({
      message: "boom",
      upstreamStatus: 500,
      upstreamBody: "Fatal error",
    });
    expect(errorFields(new Error("D1 unavailable"))).toEqual({ message: "D1 unavailable" });
    expect(errorFields("missing required parameter: league")).toEqual({ message: "missing required parameter: league" });
  });
});

describe("labelList", () => {
  test("lists each label once", () => {
    expect(labelList(["Main Nue / Cadets", "Main Nue / Cadets", "Trinquet / Seniors"])).toBe(
      "Main Nue / Cadets; Trinquet / Seniors"
    );
  });

  test("counts the labels past the cap", () => {
    const labels = Array.from({ length: MAX_LABELS + 3 }, (_, i) => `S${i} / C${i}`);
    const list = labelList(labels);
    expect(list.split("; ")).toHaveLength(MAX_LABELS);
    expect(list.endsWith("S9 / C9 (+3 more)")).toBe(true);
  });
});
