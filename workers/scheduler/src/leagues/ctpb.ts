import { EuskalpilotaScraper } from "./euskalpilota";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
};

export class CtpbScraper extends EuskalpilotaScraper {
  protected readonly baseUrl = "https://ctpb.euskalpilota.fr/resultats.php";
  protected readonly leagueName = "CTPB";

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

  protected override async requestHeaders(): Promise<Record<string, string>> {
    const sessionId = await this.primeSession();
    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (sessionId) {
      headers["Cookie"] = `PHPSESSID=${sessionId}`;
      headers["Referer"] = this.baseUrl;
      headers["Origin"] = new URL(this.baseUrl).origin;
    }
    return headers;
  }
}
