// SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
// SPDX-License-Identifier: Apache-2.0

import * as cheerio from "cheerio";
import type { FormOption, FormOptions } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

export async function scrapeFormOptions(url: string, competitionSourceId?: string): Promise<FormOptions> {
  const fetchUrl = competitionSourceId
    ? `${url}?${new URLSearchParams({ InCompet: competitionSourceId })}`
    : url;

  console.log(`[scraper] curl '${fetchUrl}' -H 'User-Agent: ${USER_AGENT}'`);

  const response = await fetch(fetchUrl, {
    headers: { "User-Agent": USER_AGENT },
  });

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
