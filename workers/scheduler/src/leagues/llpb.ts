import { EuskalpilotaScraper } from "./euskalpilota";

export class LlpbScraper extends EuskalpilotaScraper {
  readonly baseUrl ="https://llpb.euskalpilota.fr/resultats.php";
  protected readonly leagueName = "LLPB";
}
