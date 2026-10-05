import { EuskalpilotaScraper } from "./euskalpilota";

export class LcapbScraper extends EuskalpilotaScraper {
  protected readonly baseUrl = "https://lcapb.euskalpilota.fr/resultats.php";
  protected readonly leagueName = "LCAPB";
}
