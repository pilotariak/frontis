// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import * as cheerio from "cheerio";
import type { FormOption, FormOptions } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

async function primeSession(baseUrl: string): Promise<string | null> {
  const res = await fetch(baseUrl, { headers: BROWSER_HEADERS, redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  const match = cookie?.match(/PHPSESSID=([^;]+)/);
  return match ? match[1] : null;
}

export async function scrapeFormOptions(url: string, competitionSourceId?: string): Promise<FormOptions> {
  const fetchUrl = competitionSourceId
    ? `${url}?${new URLSearchParams({ InCompet: competitionSourceId })}`
    : url;

  // Some sites (e.g. CTPB) require a warm-up GET to obtain a session cookie,
  // then a second request with that cookie + Referer to actually serve the page.
  const sessionId = await primeSession(url);
  const headers: Record<string, string> = { ...BROWSER_HEADERS };
  if (sessionId) {
    headers["Cookie"]  = `PHPSESSID=${sessionId}`;
    headers["Referer"] = url;
    headers["Origin"]  = new URL(url).origin;
  }

  console.log(`[scraper] curl '${fetchUrl}'${sessionId ? ` -b 'PHPSESSID=${sessionId}'` : ""}`);

  const response = await fetch(fetchUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }

  const $ = cheerio.load(await response.text());

  const parseSelect = (name: string): FormOption[] => {
    const options: FormOption[] = [];
    $(`select[name="${name}"] option`).each((_, el) => {
      const value = $(el).attr("value") ?? "";
      const label = $(el).text().trim();
      if (value !== "" && value !== "0") {
        options.push({ sourceId: value, name: label });
      }
    });
    return options;
  };

  return {
    competitions: parseSelect("InCompet"),
    specialties:  parseSelect("InSpec"),
    categories:   parseSelect("InCat"),
  };
}
