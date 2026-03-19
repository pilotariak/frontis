import * as cheerio from "cheerio";
import type { ScrapedResult } from "../types";
import type { FormOption, FormOptions, LeagueScraper, ScrapeData, ScrapeOptions } from "./types";

export class LcapbScraper implements LeagueScraper {
  private baseUrl = "https://lcapb.euskalpilota.fr/resultats.php";
  private leagueName = "LCAPB";

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

    // GET populates the SELECT dropdowns; POST submits the form and returns results.
    const response = extractResults
      ? await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
          },
          body: body.toString(),
        })
      : await fetch(`${this.baseUrl}?${body.toString()}`, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
          },
        });

    if (!response.ok) {
      throw new Error(`[${this.leagueName}] Failed to fetch page: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const formOptions = this.parseFormOptions($);
    const results = extractResults ? this.parseResults($) : [];

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
      const phaseGroupText = infoRow
        .find("span")
        .eq(1)
        .text()
        .trim()
        .replace(/\s+/g, " ");

      for (let i = 3; i < rows.length; i++) {
        const row = rows.eq(i);
        if (row.find("td.mTitreSmall").length > 0) continue;

        const cols = row.find("td");
        if (cols.length < 5) continue;

        const matchId = cols.eq(0).text().trim().replace(/\s+/g, " ");
        const date = cols.eq(1).text().trim().replace(/&nbsp;/g, "").trim();
        const clubACol = cols.eq(2);
        const clubBCol = cols.eq(3);
        const scoreRaw = cols.eq(4).text().trim().replace(/\s+/g, "");

        const extractClubData = (col: cheerio.Cheerio<cheerio.AnyNode>) => {
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

        let scoreA: number | null = null;
        let scoreB: number | null = null;
        if (scoreRaw && scoreRaw.includes("/")) {
          const scores = scoreRaw.split("/");
          scoreA = parseInt(scores[0]);
          scoreB = parseInt(scores[1]);
        }

        console.log(
          `[${this.leagueName}] ${categoryText} — ${clubAData.name} vs ${clubBData.name} (${scoreA}/${scoreB}) ${date}`
        );

        results.push({
          specialty: specialtyText || "Trinquet/P.G. Pleine Masculin",
          competition: `Championnat ${this.leagueName}`,
          year: new Date().getFullYear(),
          category: categoryText,
          phase: `${phaseGroupText} - ${matchId}`,
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
          score_a: scoreA,
          score_b: scoreB,
        });
      }
    });

    return results;
  }
}
