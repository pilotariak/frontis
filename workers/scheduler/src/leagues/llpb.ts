import { EuskalpilotaScraper } from "./euskalpilota";

export class LlpbScraper extends EuskalpilotaScraper {
  protected readonly baseUrl = "https://llpb.euskalpilota.fr/resultats.php";
  protected readonly leagueName = "LLPB";
}
