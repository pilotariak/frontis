import * as cheerio from "cheerio";
import type { ScrapedResult } from "../types";
import type { FormOption, FormOptions, LeagueScraper, ScrapeData, ScrapeOptions } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

export class CtpbScraper implements LeagueScraper {
  private baseUrl = "https://ctpb.euskalpilota.fr/resultats.php";
  private leagueName = "CTPB";

  // CTPB requires a warm-up GET to obtain a PHPSESSID cookie; without it the
  // server redirects away from resultats.php and no form/results are returned.
  private async primeSession(): Promise<string | null> {
    const res = await fetch(this.baseUrl, { headers: BROWSER_HEADERS, redirect: "manual" });
    const cookie = res.headers.get("set-cookie");
    const match = cookie?.match(/PHPSESSID=([^;]+)/);
    console.log(
      `[${this.leagueName}] primeSession status=${res.status} cookie=${match ? "PHPSESSID acquired" : "none"}`
    );
    return match ? match[1] : null;
  }

  async fetchData(options: ScrapeOptions, extractResults: boolean): Promise<ScrapeData> {
    const body = new URLSearchParams({
      InSel: "",
      InCompet: options.competition,
      InSpec: options.specialty,
      InVille: "",
      InClub: "",
      InDate: "",
      InDatef: "",
      InCat: options.category,
      InPhase: options.phase,
      InVoir: "Voir les résultats",
    });

    const sessionId = await this.primeSession();
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (sessionId) {
      headers["Cookie"] = `PHPSESSID=${sessionId}`;
      headers["Referer"] = this.baseUrl;
      headers["Origin"] = new URL(this.baseUrl).origin;
    }

    // GET populates the SELECT dropdowns; POST submits the form and returns results.
    const response = extractResults
      ? await fetch(this.baseUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        })
      : await fetch(`${this.baseUrl}?${body.toString()}`, { headers });

    console.log(
      `[${this.leagueName}] fetch ${extractResults ? "POST" : "GET"} ${this.baseUrl} -> status=${response.status} finalUrl=${response.url}`
    );

    if (!response.ok) {
      throw new Error(`[${this.leagueName}] Failed to fetch page: ${response.statusText}`);
    }

    const html = await response.text();
    console.log(
      `[${this.leagueName}] html length=${html.length}, select[name] count=${(html.match(/<select/gi) ?? []).length}`
    );
    const $ = cheerio.load(html);

    const formOptions = this.parseFormOptions($);
    console.log(
      `[${this.leagueName}] parsed competitions=${formOptions.competitions.length} specialties=${formOptions.specialties.length} clubs=${formOptions.clubs.length} categories=${formOptions.categories.length} phases=${formOptions.phases.length}`
    );
    const results = extractResults ? this.parseResults($) : [];
    console.log(`[${this.leagueName}] parsed results=${results.length}`);

    return { formOptions, results };
  }

  private parseFormOptions($: cheerio.CheerioAPI): FormOptions {
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
      specialties: parseSelect("InSpec"),
      clubs: parseSelect("InClub"),
      categories: parseSelect("InCat"),
      phases: parseSelect("InPhase"),
    };
  }

  private parseResults($: cheerio.CheerioAPI): ScrapedResult[] {
    const results: ScrapedResult[] = [];

    $(".mBloc").each((_, table) => {
      const rows = $(table).find("tr");

      const infoRow = rows.eq(1);
      const specialtyText = infoRow
        .find("td")
        .first()
        .contents()
        .filter(function () {
          return this.nodeType === 3;
        })
        .text()
        .trim();

      const categoryText = infoRow.find("span").eq(0).text().trim();

      for (let i = 3; i < rows.length; i++) {
        const row = rows.eq(i);
        if (row.find("td.mTitreSmall").length > 0) continue;

        const cols = row.find("td");
        if (cols.length < 5) continue;

        const phase = cols.eq(0).find("strong").text()
          .replace(/ /g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const date = cols.eq(1).text().trim().replace(/&nbsp;/g, "").trim();
        const clubACol = cols.eq(2);
        const clubBCol = cols.eq(3);
        const sets = cols.eq(4).text().replace(/[\s ]/g, "").match(/\d{1,2}\/\d{1,2}/g) ?? [];
        const scores = sets.length > 0 ? sets.join(" ") : null;

        const extractClubData = (col: typeof clubACol) => {
          const fullText = col.contents().first().text().trim();
          const teamNumber = col
            .find("span.small")
            .contents()
            .first()
            .text()
            .trim()
            .replace(/[()]/g, "");
          const players: { name: string; number: string }[] = [];
          col.find("li").each((_, li) => {
            const liText = $(li).text().trim();
            const match = liText.match(/\(([^)]+)\)\s*(.*)/);
            if (match) {
              players.push({ number: match[1].trim(), name: match[2].trim() });
            }
          });
          return { name: `${fullText} ${teamNumber}`.trim(), players };
        };

        const clubAData = extractClubData(clubACol);
        const clubBData = extractClubData(clubBCol);

        console.log(
          `[${this.leagueName}] ${categoryText} — ${clubAData.name} vs ${clubBData.name} ${scores ?? "-/-"} ${date}`
        );

        results.push({
          specialty: specialtyText || "Trinquet/P.G. Pleine Masculin",
          competition: `Championnat ${this.leagueName}`,
          year: new Date().getFullYear(),
          category: categoryText,
          phase,
          date_match: date,
          club_a: clubAData.name,
          club_a_player1_name: clubAData.players[0]?.name,
          club_a_player1_number: clubAData.players[0]?.number,
          club_a_player2_name: clubAData.players[1]?.name,
          club_a_player2_number: clubAData.players[1]?.number,
          club_b: clubBData.name,
          club_b_player1_name: clubBData.players[0]?.name,
          club_b_player1_number: clubBData.players[0]?.number,
          club_b_player2_name: clubBData.players[1]?.name,
          club_b_player2_number: clubBData.players[1]?.number,
          scores,
        });
      }
    });

    return results;
  }
}
