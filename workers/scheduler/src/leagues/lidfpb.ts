import { EuskalpilotaScraper } from "./euskalpilota";

export class LidfpbScraper extends EuskalpilotaScraper {
  readonly baseUrl = "https://lidfpb.euskalpilota.fr/resultats.php";
  protected readonly leagueName = "LIDFPB";
}
