// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { UpstreamError } from "./log";
import { scrapeFormOptions } from "./scraper";

const SITE = "https://ctpb.euskalpilota.fr/resultats.php";

const FORM_HTML = `
<select name="InCompet"><option value="0">-</option><option value="20260501">Championnat 2026</option></select>
<select name="InSpec"><option value="2">Trinquet</option></select>
<select name="InCat"><option value="1">1ère Série</option></select>`;

const realFetch = globalThis.fetch;

/** The warm-up GET sets a session cookie; the form GET answers `form`. */
function serve(form: () => Response): void {
  let calls = 0;
  globalThis.fetch = mock(async () =>
    ++calls === 1 ? new Response("", { status: 302, headers: { "Set-Cookie": "PHPSESSID=test-session; path=/" } }) : form()
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

describe("scrapeFormOptions", () => {
  test("reads the competitions, specialties and categories of the form", async () => {
    serve(() => new Response(FORM_HTML));
    expect(await scrapeFormOptions(SITE, "20260501")).toEqual({
      competitions: [{ sourceId: "20260501", name: "Championnat 2026" }],
      specialties: [{ sourceId: "2", name: "Trinquet" }],
      categories: [{ sourceId: "1", name: "1ère Série" }],
    });
  });

  test("keeps the status and a redacted start of the body of a failure, the message unchanged", async () => {
    // Over HTTP/2 a response has no status text: the message ends with ": ".
    const page = `<html><body><h1>502 Bad Gateway</h1>
      <p>Request PHPSESSID=leaked-session failed</p>${"<p>nginx</p>\n".repeat(40)}</body></html>`;
    serve(() => new Response(page, { status: 502 }));

    const err = await scrapeFormOptions(SITE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UpstreamError);
    const { message, upstreamStatus, upstreamBody } = err as UpstreamError;
    expect(message).toBe(`Failed to fetch ${SITE}: `);
    expect(upstreamStatus).toBe(502);
    expect(upstreamBody).toStartWith("502 Bad Gateway Request PHPSESSID=[redacted] failed nginx nginx");
    expect(upstreamBody).not.toContain("leaked-session");
    expect(upstreamBody).not.toContain("\n");
    expect(upstreamBody.length).toBeLessThanOrEqual(201);
  });
});
