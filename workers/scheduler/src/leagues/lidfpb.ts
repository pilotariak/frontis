import * as cheerio from "cheerio";
import type { ScrapedResult } from "../types";
import type { LeagueScraper, ScrapeOptions } from "./types";

export class LidfpbScraper implements LeagueScraper {
  private baseUrl = "https://lidfpb.euskalpilota.fr/resultats.php";
  private leagueName = "LIDFPB";

  async fetchData(options: ScrapeOptions): Promise<ScrapedResult[]> {
    const formData = new URLSearchParams();
    formData.append("InSel", "");
    formData.append("InCompet", options.competition);
    formData.append("InSpec", options.specialty);
    formData.append("InVille", "");
    formData.append("InClub", "");
    formData.append("InDate", "");
    formData.append("InDatef", "");
    formData.append("InCat", options.category);
    formData.append("InPhase", options.phase);
    formData.append("InVoir", "Voir les résultats");

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${this.leagueName} results: ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
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
