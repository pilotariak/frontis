/**
 * The /admin page. It lives in a TypeScript string rather than an .html import:
 * `bun test` loads .html imports as HTML bundles, not text, so tests could not
 * read the page.
 *
 * The page is a String.raw template: `${…}` interpolates server-side values, so
 * the inline script must use neither backticks nor `${`. Names scraped from the
 * league sites only ever reach the DOM through `new Option()` and textContent.
 *
 * Two modes share the page: "One combination" runs a single scrape, like the
 * URLs it replaces; "Every combination" walks each specialty x category the
 * competition offers, like `scrape-competition.sh --all`, and asks before each
 * save. The walk reads the X-Scrape-Found header to skip empty combinations,
 * and skips the ones the competition does not offer (HTTP 400).
 *
 * A third card bootstraps a league, as setup-league's /init and /bootstrap do:
 * its save writes the league's row through POST /admin/league, then runs
 * /scrape_infos without dry run, for one competition or, like the loop of
 * howto-league-bootstrap.md, for every competition in D1. Its Init button
 * writes the row alone, like /init. The cards share the output panel.
 *
 * The `:root` block is generated from DESIGN.md: edit DESIGN.md and run
 * `make tokens`, never the block itself.
 */
export function renderAdminPage(leagues: string[], version: string): string {
  // A JSON island read by the script; "<" is escaped so no value can end the tag.
  const leaguesJson = JSON.stringify(leagues).replace(/</g, "\\u003c");

  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Frontis Scheduler Admin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }

    /* ── Design System Tokens ── */
    :root {
      --red:         #C8102E;
      --red-dark:    #970D25;
      --red-soft:    #FDE8EC;
      --red-border:  rgba(200,16,46,0.2);
      --cream:       #F7F4EF;
      --card:        #FFFDFC;
      --white:       #FFFFFF;
      --surface-alt: #F2EDE7;
      --line:        #E5DED6;
      --ink:         #141414;
      --text:        #262626;
      --muted:       #7A7A7A;
      --subtle:      #A8A49E;
      --green:       #1F7A5A;
      --green-soft:  #E6F4EE;
      --amber:       #C8900A;
      --amber-soft:  #FFF8E7;
      --panel:       #1E1E1E;
      --shadow:      rgba(103,18,31,0.10);
      --font: "Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }

    body {
      background: var(--cream);
      color: var(--text);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.5;
      min-height: 100vh;
    }

    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 32px;
      height: 64px;
      background: var(--white);
      border-bottom: 1px solid var(--line);
    }
    .logo {
      width: 32px; height: 32px;
      display: grid; place-items: center;
      background: var(--red);
      border-radius: 8px;
      color: var(--white);
      font-weight: 800;
      font-size: 14px;
    }
    .title { font-weight: 700; color: var(--ink); }
    .title span { color: var(--muted); font-weight: 500; }
    .version {
      margin-left: auto;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      background: var(--surface-alt);
      border: 1px solid var(--line);
      border-radius: 9999px;
      padding: 4px 12px;
    }

    main {
      max-width: 880px;
      margin: 0 auto;
      padding: 40px 32px 64px;
      display: grid;
      gap: 24px;
    }
    h1 { font-size: 28px; line-height: 1.2; color: var(--ink); letter-spacing: -0.02em; }
    .lede { color: var(--muted); margin-top: 6px; }

    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 1px 2px var(--shadow);
      padding: 28px;
    }

    fieldset { border: 0; min-width: 0; }
    .toggles { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
    .segmented {
      display: inline-flex;
      padding: 4px;
      gap: 4px;
      background: var(--surface-alt);
      border: 1px solid var(--line);
      border-radius: 12px;
    }
    .segmented input { position: absolute; opacity: 0; pointer-events: none; }
    .segmented label {
      padding: 8px 18px;
      border-radius: 9px;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
    }
    .segmented input:checked + label { background: var(--white); color: var(--ink); box-shadow: 0 1px 3px var(--shadow); }
    .segmented input:focus-visible + label { outline: 2px solid var(--red); outline-offset: 2px; }
    fieldset:disabled .segmented label { cursor: not-allowed; }

    .steps { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .walk-mode .one-only { display: none; }
    .field { display: grid; gap: 6px; min-width: 0; }
    .field label { font-size: 13px; font-weight: 600; color: var(--ink); }
    .field label b {
      display: inline-grid; place-items: center;
      width: 20px; height: 20px; margin-right: 6px;
      border-radius: 50%;
      background: var(--red-soft);
      color: var(--red);
      font-size: 11px;
    }
    select, .field input {
      width: 100%;
      font: inherit;
      color: var(--text);
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
    }
    select:focus-visible, .field input:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }
    select:disabled, .field input:disabled, .field input[readonly] { color: var(--subtle); background: var(--surface-alt); }
    .field label small { font-weight: 400; color: var(--muted); }
    .field.wide { grid-column: 1 / -1; }

    details.card { padding: 0; }
    details.card > summary {
      display: grid;
      gap: 2px;
      padding: 20px 28px;
      list-style: none;
      cursor: pointer;
    }
    details.card > summary::-webkit-details-marker { display: none; }
    details.card > summary:focus-visible { outline: 2px solid var(--red); outline-offset: -2px; border-radius: 16px; }
    details.card > summary strong { color: var(--ink); }
    details.card > summary strong::before {
      content: "\25B8";
      display: inline-block;
      width: 18px;
      color: var(--red);
      transition: transform 0.15s;
    }
    details[open].card > summary strong::before { transform: rotate(90deg); }
    details.card > summary span { font-size: 13px; color: var(--muted); }
    .bootstrap-body { padding: 0 28px 28px; }

    .hint { min-height: 22px; margin-top: 16px; font-size: 13px; color: var(--muted); }
    .hint.error { color: var(--red-dark); }

    .actions {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 12px;
      padding-top: 20px;
      border-top: 1px solid var(--line);
    }
    .check { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
    .check input { width: 18px; height: 18px; accent-color: var(--red); }
    .check small { font-weight: 400; color: var(--muted); }

    button {
      font: inherit;
      font-weight: 700;
      border: 1px solid transparent;
      border-radius: 10px;
      padding: 10px 20px;
      cursor: pointer;
    }
    button:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .primary { margin-left: auto; background: var(--ink); color: var(--white); }
    .primary.save { background: var(--red); }
    .primary.save:hover:not(:disabled) { background: var(--red-dark); }
    .secondary { background: var(--white); color: var(--red); border-color: var(--red-border); }
    .actions .push { margin-left: auto; }
    .actions .push + .primary { margin-left: 0; }
    .danger { background: var(--red); color: var(--white); }
    .danger:hover:not(:disabled) { background: var(--red-dark); }
    kbd { font-family: var(--mono); font-size: 11px; font-weight: 600; opacity: 0.7; margin-left: 4px; }

    .output { padding: 0; overflow: hidden; }
    .output-head {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 16px 20px;
      border-bottom: 1px solid var(--line);
    }
    .badge {
      font-size: 12px;
      font-weight: 700;
      border-radius: 9999px;
      padding: 3px 10px;
      background: var(--surface-alt);
      color: var(--muted);
    }
    .badge.ok { background: var(--green-soft); color: var(--green); }
    .badge.dry { background: var(--amber-soft); color: var(--amber); }
    .badge.fail { background: var(--red-soft); color: var(--red-dark); }
    .request {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
      flex: 1 1 240px;
    }
    .output-head button { padding: 6px 14px; font-size: 13px; }

    .walk { display: grid; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
    .walk-status { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; }
    .walk-status strong { color: var(--ink); overflow-wrap: anywhere; }
    .walk-status span { font-size: 13px; color: var(--muted); }
    progress { width: 100%; height: 6px; accent-color: var(--red); }
    .walk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .walk-decide { display: inline-flex; flex-wrap: wrap; gap: 8px; }
    .walk-actions button { padding: 8px 14px; font-size: 13px; }
    #walk-stop { margin-left: auto; }
    pre {
      margin: 0;
      padding: 20px;
      min-height: 120px;
      max-height: 70vh;
      overflow: auto;
      background: var(--panel);
      color: #EDEDED;
      font-family: var(--mono);
      font-size: 12.5px;
      line-height: 1.55;
      white-space: pre;
    }

    @media (max-width: 767px) {
      header { padding: 0 16px; }
      main { padding: 24px 16px 48px; }
      .card { padding: 20px; }
      .output, details.card { padding: 0; }
      details.card > summary { padding: 16px 20px; }
      .bootstrap-body { padding: 0 20px 20px; }
      .steps { grid-template-columns: 1fr; }
      .primary, .actions .push { margin-left: 0; width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo" aria-hidden="true">F</div>
    <div class="title">Frontis Scheduler <span>· Admin</span></div>
    <div class="version">v${version}</div>
  </header>

  <main>
    <div>
      <h1>Load competition data</h1>
      <p class="lede">Pick what to scrape from the league site, preview it with a dry run, then save it into D1. A league with no data yet needs a bootstrap first, below.</p>
    </div>

    <form class="card" id="form" novalidate>
      <fieldset id="setup">
        <div class="toggles">
          <div class="segmented" role="radiogroup" aria-label="Script">
            <input type="radio" name="script" id="script-results" value="results" checked />
            <label for="script-results">Match results</label>
            <input type="radio" name="script" id="script-rankings" value="rankings" />
            <label for="script-rankings">Rankings</label>
          </div>
          <div class="segmented" role="radiogroup" aria-label="Mode">
            <input type="radio" name="mode" id="mode-one" value="one" checked />
            <label for="mode-one">One combination</label>
            <input type="radio" name="mode" id="mode-walk" value="walk" />
            <label for="mode-walk">Every combination</label>
          </div>
        </div>

        <div class="steps">
          <div class="field">
            <label for="league"><b>1</b>League</label>
            <select id="league" required></select>
          </div>
          <div class="field">
            <label for="competition"><b>2</b>Competition</label>
            <select id="competition" required disabled></select>
          </div>
          <div class="field one-only">
            <label for="specialty"><b>3</b>Specialty</label>
            <select id="specialty" required disabled></select>
          </div>
          <div class="field one-only">
            <label for="category"><b>4</b>Category</label>
            <select id="category" required disabled></select>
          </div>
        </div>
      </fieldset>

      <p class="hint" id="hint" role="status" aria-live="polite"></p>

      <div class="actions">
        <label class="check">
          <input type="checkbox" id="dry-run" checked />
          <span id="dry-run-label">Dry run</span> <small id="dry-run-help">— fetch and show, save nothing</small>
        </label>
        <button type="submit" class="primary" id="run" disabled>Preview</button>
      </div>
    </form>

    <details class="card" id="bootstrap">
      <summary>
        <strong>Bootstrap a league</strong>
        <span>Register the league, then load its competitions, specialties, categories, clubs and phases from its site, like setup-league's /init and /bootstrap.</span>
      </summary>
      <form class="bootstrap-body" id="bs-form" novalidate>
        <fieldset id="bs-setup">
          <div class="steps">
            <div class="field">
              <label for="bs-league"><b>1</b>League</label>
              <select id="bs-league" required></select>
            </div>
            <div class="field">
              <label for="bs-name"><b>2</b>Full name</label>
              <input type="text" id="bs-name" required disabled autocomplete="off" spellcheck="false" placeholder="Comité Côte d'Argent de Pelote Basque" />
            </div>
            <div class="field wide">
              <label for="bs-url">Site URL <small>set by the league's scraper, saved with the name</small></label>
              <input type="url" id="bs-url" readonly placeholder="Choose a league first" />
            </div>
            <div class="field wide">
              <label for="bs-competition"><b>3</b>Scope</label>
              <select id="bs-competition" disabled></select>
            </div>
          </div>
        </fieldset>

        <p class="hint" id="bs-hint" role="status" aria-live="polite"></p>

        <div class="actions">
          <label class="check" id="bs-dry-run-check">
            <input type="checkbox" id="bs-dry-run" checked />
            <span>Dry run</span> <small>— read the league site, save nothing</small>
          </label>
          <button type="button" class="secondary push" id="bs-init" disabled title="Like setup-league's /init: write the league's row, scrape nothing">Init (register only)</button>
          <button type="submit" class="primary" id="bs-run" disabled>Preview</button>
        </div>
      </form>
    </details>

    <section class="card output" id="output" hidden>
      <div class="output-head">
        <span class="badge" id="badge" role="status"></span>
        <code class="request" id="request"></code>
        <button type="button" class="secondary" id="save" hidden>Save these results</button>
      </div>
      <div class="walk" id="walk" hidden>
        <div class="walk-status">
          <strong id="walk-step"></strong>
          <span id="walk-tally"></span>
        </div>
        <progress id="walk-bar" value="0" max="1"></progress>
        <div class="walk-actions">
          <span class="walk-decide" id="walk-decide" hidden>
            <button type="button" class="danger" id="walk-save">Save <kbd>Y</kbd></button>
            <button type="button" class="secondary" id="walk-skip">Skip <kbd>N</kbd></button>
            <button type="button" class="secondary" id="walk-all">Save all remaining <kbd>A</kbd></button>
          </span>
          <button type="button" class="secondary" id="walk-stop">Stop <kbd>Q</kbd></button>
        </div>
      </div>
      <pre id="log"></pre>
    </section>
  </main>

  <script type="application/json" id="leagues">${leaguesJson}</script>
  <script>
    (function () {
      "use strict";

      var SESSION_LOST = "Your Cloudflare Access session has expired: reload the page.";
      var NO_ANSWER = "No answer from the scheduler: the network request failed.";
      // A failed scrape is tried this many times in all, these many ms apart.
      var RETRY_PAUSES = [3000, 10000];
      // A walk stops after this many outages in a row: the scheduler or the
      // league site is down, the rest would fail the same way.
      var MAX_FAILURES_IN_A_ROW = 5;

      function el(id) { return document.getElementById(id); }
      var form = el("form");
      var setupEl = el("setup");
      var leagueEl = el("league");
      var competitionEl = el("competition");
      var specialtyEl = el("specialty");
      var categoryEl = el("category");
      var dryRunEl = el("dry-run");
      var dryRunLabelEl = el("dry-run-label");
      var dryRunHelpEl = el("dry-run-help");
      var runEl = el("run");
      var hintEl = el("hint");
      var outputEl = el("output");
      var badgeEl = el("badge");
      var requestEl = el("request");
      var saveEl = el("save");
      var logEl = el("log");
      var walkEl = el("walk");
      var walkStepEl = el("walk-step");
      var walkTallyEl = el("walk-tally");
      var walkBarEl = el("walk-bar");
      var walkDecideEl = el("walk-decide");
      var walkSaveEl = el("walk-save");
      var walkStopEl = el("walk-stop");
      var bootstrapEl = el("bootstrap");
      var bsFormEl = el("bs-form");
      var bsSetupEl = el("bs-setup");
      var bsLeagueEl = el("bs-league");
      var bsNameEl = el("bs-name");
      var bsUrlEl = el("bs-url");
      var bsCompetitionEl = el("bs-competition");
      var bsDryRunEl = el("bs-dry-run");
      var bsDryRunCheckEl = el("bs-dry-run-check");
      var bsInitEl = el("bs-init");
      var bsRunEl = el("bs-run");
      var bsHintEl = el("bs-hint");

      // Each menu load bumps its counter, so a slow answer to an older pick
      // never overwrites the menus of a newer one.
      var loads = { competitions: 0, options: 0, league: 0 };
      var busy = false;
      var lastDryRun = null;
      // What the league site offers for the chosen competition and script.
      var offered = null;
      // The running walk: { ask, stopped, decide }, or null.
      var walk = null;
      // The bootstrap card's league, as /admin/league answers it, or null,
      // and its competitions in D1.
      var bsLeague = null;
      var bsCompetitions = [];
      var SAVE_LABELS = { results: "Save these results", rankings: "Save these rankings", infos: "Bootstrap and save" };

      function script() { return form.elements.namedItem("script").value; }
      function mode() { return form.elements.namedItem("mode").value; }
      function hasId(item) { return item.id !== null; }
      function pause(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
      function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

      function say(target, text, isError) {
        target.textContent = text || "";
        target.classList.toggle("error", Boolean(isError));
      }
      function hint(text, isError) { say(hintEl, text, isError); }

      function badge(kind, text) {
        badgeEl.className = kind ? "badge " + kind : "badge";
        badgeEl.textContent = text;
      }

      function reset(select, placeholder) {
        select.replaceChildren(new Option(placeholder, ""));
        select.disabled = true;
      }

      // One request to the scheduler, which always answers text/plain or JSON.
      // Access answers an expired session with a redirect to its login page:
      // redirect "manual" stops fetch() there, as an opaque redirect, instead
      // of following it cross-origin into a network error. That, or any other
      // answer below 500 that is not the scheduler's, throws SESSION_LOST.
      // Everything else comes back as { res, status, type, text }: status 0
      // when the network failed, an HTML type for a Cloudflare error page.
      async function send(url, init) {
        init.redirect = "manual";
        var res;
        try {
          res = await fetch(url, init);
        } catch (e) {
          return { res: null, status: 0, type: "", text: NO_ANSWER };
        }
        var type = res.headers.get("content-type") || "";
        var ours = type.indexOf("text/plain") !== -1 || type.indexOf("application/json") !== -1;
        if (res.type === "opaqueredirect" || (!ours && res.status < 500 && res.status !== 429)) {
          throw new Error(SESSION_LOST);
        }
        var text = await res.text().catch(function () { return ""; });
        return { res: res, status: res.status, type: type, text: ours ? text : edgeError(text) };
      }

      // Cloudflare's own error page, sent when the Worker blew its CPU limit
      // (1102), threw (1101) or the request timed out (524). Its title names
      // the cause, as "Worker exceeded resource limits | host | Cloudflare".
      function edgeError(html) {
        var title = /<title>([^<]*)<\/title>/i.exec(html);
        var cause = title ? title[1].split("|")[0].trim() : "";
        return "Cloudflare error page" + (cause ? ": " + cause : "") +
          " (the Worker ran out of CPU time, crashed or timed out)";
      }

      function statusLabel(status) { return status ? "HTTP " + status : "No answer"; }

      // No answer, a rate limit or a Worker failure: worth trying again, and
      // what a walk counts towards MAX_FAILURES_IN_A_ROW. Any other answer,
      // such as a 400 for a combination the competition does not offer, shows
      // the scheduler and the league site are up.
      function outage(status) { return status === 0 || status === 429 || status >= 500; }

      function tooManyFailures() {
        return MAX_FAILURES_IN_A_ROW + " requests failed in a row: stopped, the next ones would fail the same way. " +
          "Run again once the scheduler or the league site answers.";
      }

      // One line for a failed answer, with the tries a scrape took.
      function failureDetail(answer) {
        var tries = answer.attempts > 1 ? " · " + answer.attempts + " tries" : "";
        return (answer.status ? "HTTP " + answer.status + ": " : "") + answer.text.split("\n")[0] + tries;
      }

      // A body makes it a POST.
      async function fetchJson(url, body) {
        var init = { headers: { Accept: "application/json" } };
        if (body) {
          init.method = "POST";
          init.headers["Content-Type"] = "application/json";
          init.body = JSON.stringify(body);
        }
        var answer = await send(url, init);
        if (answer.type.indexOf("application/json") === -1) throw new Error(failureDetail(answer));
        var json = JSON.parse(answer.text);
        if (!answer.res.ok) throw new Error(json.error || "HTTP " + answer.status);
        return json;
      }

      // parent is a select or an optgroup, which has no add().
      function addOptions(parent, items) {
        items.forEach(function (item) {
          if (item.id === null) {
            var missing = new Option(item.name + " (not in database: bootstrap the league)", "");
            missing.disabled = true;
            parent.appendChild(missing);
          } else {
            parent.appendChild(new Option(item.name, String(item.id)));
          }
        });
      }

      // Every specialty x category the competition offers and the database knows.
      function combinations() {
        var list = [];
        if (!offered) return list;
        offered.specialties.filter(hasId).forEach(function (specialty) {
          offered.categories.filter(hasId).forEach(function (category) {
            list.push({ specialty: specialty, category: category, label: specialty.name + " · " + category.name });
          });
        });
        return list;
      }

      function describeOffer() {
        if (!offered) return;
        if (mode() === "one") {
          hint(offered.specialties.length + " specialties and " + offered.categories.length + " categories offered.");
          return;
        }
        var specialties = offered.specialties.filter(hasId).length;
        var categories = offered.categories.filter(hasId).length;
        var unknown = offered.specialties.length + offered.categories.length - specialties - categories;
        var text = plural(specialties, "specialty", "specialties") + " × " +
          plural(categories, "category", "categories") + ": " +
          plural(combinations().length, "combination", "combinations") +
          ", the empty and not offered ones skipped.";
        if (unknown) text += " " + unknown + " left out, not in database: bootstrap the league for this competition.";
        hint(text);
      }

      function refresh() {
        var walking = mode() === "walk";
        var dry = dryRunEl.checked;
        form.classList.toggle("walk-mode", walking);
        if (walking) {
          var count = combinations().length;
          runEl.disabled = busy || count === 0;
          dryRunLabelEl.textContent = "Ask before each save";
          dryRunHelpEl.textContent = "— preview every combination, then save or skip it";
          runEl.textContent = (dry ? "Review " : "Save ") + (count ? plural(count, "combination", "combinations") : "every combination");
        } else {
          var ready = Boolean(leagueEl.value && competitionEl.value && specialtyEl.value && categoryEl.value);
          runEl.disabled = busy || !ready;
          dryRunLabelEl.textContent = "Dry run";
          dryRunHelpEl.textContent = "— fetch and show, save nothing";
          runEl.textContent = dry ? "Preview" : "Run and save";
        }
        runEl.classList.toggle("save", !dry);

        // Every competition always saves: a dry run of each would show nothing.
        var bsAll = bsCompetitionEl.value === "*";
        var bsDry = bsDryRunEl.checked && !bsAll;
        bsDryRunCheckEl.hidden = bsAll;
        bsRunEl.disabled = busy || !bsLeague || !bsNameEl.value.trim();
        bsInitEl.disabled = bsRunEl.disabled;
        bsRunEl.textContent = bsAll
          ? "Save " + plural(bsCompetitions.length, "competition", "competitions")
          : bsDry ? "Preview" : "Bootstrap and save";
        bsRunEl.classList.toggle("save", !bsDry);
      }

      // The setup fieldset keeps each control's own disabled state underneath.
      function setBusy(on) {
        busy = on;
        setupEl.disabled = on;
        dryRunEl.disabled = on;
        bsSetupEl.disabled = on;
        bsDryRunEl.disabled = on;
        refresh();
      }

      function forgetDryRun() {
        lastDryRun = null;
        saveEl.hidden = true;
      }

      async function loadCompetitions() {
        var mine = ++loads.competitions;
        loads.options++;
        offered = null;
        reset(competitionEl, "Loading competitions…");
        reset(specialtyEl, "Choose a competition first");
        reset(categoryEl, "Choose a competition first");
        forgetDryRun();
        refresh();
        if (!leagueEl.value) {
          reset(competitionEl, "Choose a league first");
          hint("");
          return;
        }
        hint("");
        try {
          var body = await fetchJson("/admin/competitions?" + new URLSearchParams({ league: leagueEl.value }));
          if (mine !== loads.competitions) return;
          reset(competitionEl, body.competitions.length ? "Choose a competition" : "No competition: bootstrap the league below");
          if (!body.competitions.length) offerBootstrap(leagueEl.value);
          var groups = [
            ["Refreshed nightly", body.competitions.filter(function (c) { return c.enabled; })],
            ["Other competitions", body.competitions.filter(function (c) { return !c.enabled; })],
          ];
          groups.forEach(function (group) {
            if (!group[1].length) return;
            var optgroup = document.createElement("optgroup");
            optgroup.label = group[0];
            addOptions(optgroup, group[1]);
            competitionEl.add(optgroup);
          });
          competitionEl.disabled = body.competitions.length === 0;
        } catch (e) {
          if (mine !== loads.competitions) return;
          reset(competitionEl, "Could not load competitions");
          hint(e.message, true);
        }
        refresh();
      }

      async function loadOptions() {
        var mine = ++loads.options;
        offered = null;
        reset(specialtyEl, "Loading specialties…");
        reset(categoryEl, "Loading categories…");
        forgetDryRun();
        refresh();
        if (!competitionEl.value) {
          reset(specialtyEl, "Choose a competition first");
          reset(categoryEl, "Choose a competition first");
          hint("");
          return;
        }
        hint("Reading what the league site offers for this competition…");
        try {
          var body = await fetchJson("/admin/options?" + new URLSearchParams({
            league: leagueEl.value,
            competition: competitionEl.value,
            script: script(),
          }));
          if (mine !== loads.options) return;
          offered = body;
          reset(specialtyEl, "Choose a specialty");
          specialtyEl.add(new Option("All specialties", "0"));
          addOptions(specialtyEl, body.specialties);
          specialtyEl.disabled = false;
          reset(categoryEl, "Choose a category");
          categoryEl.add(new Option("All categories", "0"));
          addOptions(categoryEl, body.categories);
          categoryEl.disabled = false;
          describeOffer();
        } catch (e) {
          if (mine !== loads.options) return;
          reset(specialtyEl, "Not available");
          reset(categoryEl, "Not available");
          hint(e.message, true);
        }
        refresh();
      }

      // One call to a scrape route, tried again after a pause when the network
      // or the Worker failed (no answer, or a 5xx): a page that only just blows
      // the CPU limit, or a hiccup of the league site, often passes the next
      // time. Trying a save again is harmless: results are upserted, rankings
      // replaced in one transaction. found and saved come from the
      // X-Scrape-Found and X-Scrape-Saved headers, null when absent. Throws
      // only SESSION_LOST.
      async function scrape(scriptName, query, dryRun) {
        var params = new URLSearchParams(query);
        params.set("no_color", "true");
        params.set("dry_run", String(dryRun));
        var path = "/scrape_" + scriptName + "?" + params;
        requestEl.textContent = "GET " + path;
        var answer;
        var attempt = 1;
        for (;;) {
          answer = await send(path, {});
          if (!outage(answer.status) || attempt > RETRY_PAUSES.length || (walk && walk.stopped)) break;
          badge("", statusLabel(answer.status) + ": trying again (" + (attempt + 1) + "/" + (RETRY_PAUSES.length + 1) + ")…");
          await pause(RETRY_PAUSES[attempt - 1]);
          if (walk && walk.stopped) break;
          attempt++;
        }
        var text = answer.text;
        if (answer.type.indexOf("application/json") !== -1) {
          try { text = JSON.parse(text).error || text; } catch (e) { /* keep the raw body */ }
        }
        var found = answer.res ? answer.res.headers.get("X-Scrape-Found") : null;
        var saved = answer.res ? answer.res.headers.get("X-Scrape-Saved") : null;
        return {
          ok: Boolean(answer.res && answer.res.ok),
          status: answer.status,
          attempts: attempt,
          text: text,
          found: found === null ? null : Number(found),
          saved: saved === null ? null : Number(saved),
        };
      }

      // ── One combination, or a bootstrap ──────────────────────────────────

      // register is set for a bootstrap: { league, name }, the league's row,
      // written before /scrape_infos saves.
      async function execute(scriptName, query, dryRun, register) {
        setBusy(true);
        forgetDryRun();
        saveEl.disabled = true;
        outputEl.hidden = false;
        walkEl.hidden = true;
        badge("", dryRun ? "Running dry run…" : "Running and saving…");
        logEl.textContent = "";
        var started = performance.now();
        var bootstrapped = false;

        try {
          var registered = "";
          if (register && !dryRun) {
            var path = "/admin/league?" + new URLSearchParams({ league: register.league });
            requestEl.textContent = "POST " + path;
            var row = await fetchJson(path, { name: register.name });
            registered = registeredLine(row) + "\n\n";
          }
          var answer = await scrape(scriptName, query, dryRun);
          var seconds = ((performance.now() - started) / 1000).toFixed(1) + " s";
          if (answer.ok) {
            badge(dryRun ? "dry" : "ok", (dryRun ? "Dry run, nothing saved" : "Saved") + " · " + seconds);
            if (dryRun) {
              lastDryRun = { script: scriptName, query: query, register: register };
              saveEl.textContent = SAVE_LABELS[scriptName];
              saveEl.hidden = false;
            }
            bootstrapped = Boolean(register) && !dryRun;
          } else {
            badge("fail", statusLabel(answer.status) + " · " + seconds);
          }
          logEl.textContent = registered + answer.text;
        } catch (e) {
          badge("fail", "Failed");
          logEl.textContent = e.message;
        } finally {
          saveEl.disabled = false;
          setBusy(false);
        }
        if (bootstrapped) afterBootstrap(register.league);
      }

      // ── Bootstrap a league ───────────────────────────────────────────────

      function registeredLine(row) {
        return "League " + row.acronym.toUpperCase() + " registered as " + row.name + " (" + row.url + ")";
      }

      // Like setup-league's /init: write the league's row, scrape nothing.
      async function initLeague(league, name) {
        setBusy(true);
        forgetDryRun();
        outputEl.hidden = false;
        walkEl.hidden = true;
        var path = "/admin/league?" + new URLSearchParams({ league: league });
        requestEl.textContent = "POST " + path;
        badge("", "Registering…");
        logEl.textContent = "";
        var registered = false;
        try {
          logEl.textContent = registeredLine(await fetchJson(path, { name: name }));
          badge("ok", "Registered");
          registered = true;
        } catch (e) {
          badge("fail", "Failed");
          logEl.textContent = e.message;
        } finally {
          setBusy(false);
        }
        if (registered && bsLeagueEl.value === league) loadLeague(true);
      }

      // The bootstrap card's league: its row, to prefill the name, and its
      // competitions, to scope /scrape_infos (which takes a source_id).
      // keepScope keeps the chosen competition when the league is the same.
      async function loadLeague(keepScope) {
        var mine = ++loads.league;
        var scope = keepScope ? bsCompetitionEl.value : "";
        bsLeague = null;
        bsCompetitions = [];
        bsNameEl.value = "";
        bsNameEl.disabled = true;
        bsUrlEl.value = "";
        forgetDryRun();
        if (!bsLeagueEl.value) {
          reset(bsCompetitionEl, "Choose a league first");
          say(bsHintEl, "");
          refresh();
          return;
        }
        reset(bsCompetitionEl, "Site default competition");
        say(bsHintEl, "Reading the league…");
        refresh();
        try {
          var query = new URLSearchParams({ league: bsLeagueEl.value });
          var answers = await Promise.all([
            fetchJson("/admin/league?" + query),
            fetchJson("/admin/competitions?" + query),
          ]);
          if (mine !== loads.league) return;
          bsLeague = answers[0];
          bsCompetitions = answers[1].competitions;
          bsNameEl.value = bsLeague.name || "";
          bsNameEl.disabled = false;
          bsUrlEl.value = bsLeague.url;
          var options = bsCompetitions.map(function (c) { return new Option(c.name, c.source_id); });
          if (options.length) {
            options.unshift(new Option("Every competition in D1, one request each", "*"));
          }
          options.forEach(function (option) {
            option.selected = option.value === scope;
            bsCompetitionEl.add(option);
          });
          bsCompetitionEl.disabled = false;
          var count = plural(bsCompetitions.length, "competition", "competitions");
          say(bsHintEl, (bsLeague.name ? "Registered." : "Not registered yet: give its full name, then Init, or bootstrap straight away.") + " " +
            count + " in D1. " + (bsCompetitions.length
              ? "The site offers every specialty and category of a competition only when scoped to it: save every competition once."
              : "Save the site default competition first: it lists every competition."));
        } catch (e) {
          if (mine !== loads.league) return;
          say(bsHintEl, e.message, true);
        }
        refresh();
      }

      // Like the loop of howto-league-bootstrap.md: register the league, then
      // one saved /scrape_infos per competition, 300 ms apart. Stop and q
      // end it after the current request. competitions run oldest first: the
      // last upsert wins, so the current season's labels must come last.
      async function bootstrapAll(league, name, competitions) {
        var failed = 0;
        var inARow = 0;
        var done = 0;
        var journal = [];
        var registered = "";
        var lost = null;

        walk = { ask: false, stopped: false, decide: null };
        setBusy(true);
        forgetDryRun();
        outputEl.hidden = false;
        walkEl.hidden = false;
        walkDecideEl.hidden = true;
        walkStopEl.hidden = false;
        walkStopEl.disabled = false;
        walkBarEl.max = competitions.length;
        logEl.textContent = "";

        function show() {
          walkBarEl.value = done;
          walkTallyEl.textContent = (done - failed) + " saved · " + failed + " failed";
        }

        try {
          var path = "/admin/league?" + new URLSearchParams({ league: league });
          requestEl.textContent = "POST " + path;
          walkStepEl.textContent = "Registering the league";
          show();
          var row = await fetchJson(path, { name: name });
          registered = registeredLine(row) + "\n\n";
          for (var i = 0; i < competitions.length && !walk.stopped; i++) {
            var competition = competitions[i];
            walkStepEl.textContent = (i + 1) + " / " + competitions.length + " · " + competition.name;
            badge("", "Saving…");
            var reply = await scrape("infos", { league: league, competition: competition.source_id }, false);
            if (!reply.ok) {
              failed++;
              journal.push("failed  " + competition.name + "  (" + failureDetail(reply) + ")");
            }
            inARow = !reply.ok && outage(reply.status) ? inARow + 1 : 0;
            done = i + 1;
            show();
            if (inARow >= MAX_FAILURES_IN_A_ROW && done < competitions.length) {
              lost = tooManyFailures();
              break;
            }
            if (!walk.stopped) await pause(300);
          }
        } catch (e) {
          lost = e.message;
        }

        var finished = !lost && done === competitions.length;
        walkStopEl.hidden = true;
        requestEl.textContent = "";
        show();
        walkStepEl.textContent = finished
          ? "Finished: " + plural(competitions.length, "competition", "competitions")
          : "Stopped after " + done + " / " + competitions.length;
        badge(lost ? "fail" : "ok", lost ? "Failed" : finished ? "Done" : "Stopped");
        logEl.textContent = (lost ? lost + "\n\n" : "") + registered + "done: " +
          plural(done, "competition", "competitions") + ", " + (done - failed) + " saved, " + failed + " failed." +
          (journal.length ? "\n\n" + journal.join("\n") : "");
        walk = null;
        setBusy(false);
        if (registered) afterBootstrap(league);
      }

      // A league with no competition in D1 has nothing to scrape yet.
      function offerBootstrap(league) {
        bootstrapEl.open = true;
        if (!bsLeagueEl.value && !busy) {
          bsLeagueEl.value = league;
          loadLeague(false);
        }
      }

      // A saved bootstrap changes what both cards list for its league.
      function afterBootstrap(league) {
        if (bsLeagueEl.value === league) loadLeague(true);
        if (leagueEl.value === league) loadCompetitions();
      }

      // ── Every combination ────────────────────────────────────────────────
      // Like scrape-competition.sh --all: each combination is previewed and
      // the user saves it, skips it, saves all the rest, or stops. Without
      // "Ask before each save", each one is saved straight away.

      // Show the decision buttons and wait for one. Each prompt owns its own
      // resolver, cleared before it runs, so no click reaches a later prompt.
      function decide(canSave) {
        walkSaveEl.disabled = !canSave;
        walkDecideEl.hidden = false;
        return new Promise(function (resolve) { walk.decide = resolve; });
      }

      function answer(choice) {
        if (!walk || !walk.decide) return;
        if (choice === "save" && walkSaveEl.disabled) return;
        var resolve = walk.decide;
        walk.decide = null;
        walkDecideEl.hidden = true;
        resolve(choice);
      }

      function stopWalk() {
        if (!walk || walk.stopped) return;
        walk.stopped = true;
        walkStopEl.disabled = true;
        if (walk.decide) answer("stop");
        else badge("", "Stopping after this request…");
      }

      async function runWalk(scriptName, base, list, ask) {
        var noun = scriptName === "rankings" ? "teams" : "results";
        var tally = { saved: 0, skipped: 0, empty: 0, notOffered: 0, failed: 0 };
        var inARow = 0;
        // Whether the current combination failed with an outage.
        var down = false;
        var journal = [];
        var done = 0;
        var lost = null;

        walk = { ask: ask, stopped: false, decide: null };
        setBusy(true);
        forgetDryRun();
        outputEl.hidden = false;
        walkEl.hidden = false;
        walkDecideEl.hidden = true;
        walkStopEl.hidden = false;
        walkStopEl.disabled = false;
        walkBarEl.max = list.length;
        logEl.textContent = "";

        function note(state, combo, detail) {
          var pad = "            ".slice(state.length);
          journal.push(state + pad + combo.label + "  (" + detail + ")");
        }
        function failure(combo, reply) {
          tally.failed++;
          if (outage(reply.status)) down = true;
          note("failed", combo, failureDetail(reply));
        }
        function show() {
          walkBarEl.value = done;
          walkTallyEl.textContent = tally.saved + " saved · " + tally.skipped + " skipped · " +
            tally.empty + " empty · " + tally.notOffered + " not offered · " + tally.failed + " failed";
        }

        try {
          for (var i = 0; i < list.length && !walk.stopped; i++) {
            var combo = list[i];
            down = false;
            var query = {
              league: base.league,
              competition: base.competition,
              specialty: String(combo.specialty.id),
              category: String(combo.category.id),
            };
            walkStepEl.textContent = (i + 1) + " / " + list.length + " · " + combo.label;
            show();
            var asking = walk.ask;
            badge("", asking ? "Previewing…" : "Saving…");

            var reply = await scrape(scriptName, query, asking);
            if (walk.stopped && asking) break;

            if (reply.status === 400) {
              // The competition does not offer this combination, such as an
              // FFPB category the specialty does not have: nothing to save,
              // nothing to ask, as scrape-competition.sh --all does.
              tally.notOffered++;
              note("not offered", combo, reply.text.split("\n")[0]);
            } else if (!reply.ok) {
              failure(combo, reply);
              if (asking) {
                badge("fail", statusLabel(reply.status));
                logEl.textContent = reply.text;
                var next = await decide(false);
                if (next === "stop") break;
                if (next === "all") walk.ask = false;
              }
            } else if (reply.found === 0) {
              tally.empty++;
            } else if (!asking) {
              tally.saved++;
              note("saved", combo, reply.found + " found, " + reply.saved + " saved");
              badge("ok", "Saved");
              logEl.textContent = reply.text;
            } else {
              badge("dry", "Dry run · " + reply.found + " " + noun + " found");
              logEl.textContent = reply.text;
              var choice = await decide(true);
              if (choice === "stop") break;
              if (choice === "all") {
                walk.ask = false;
                choice = "save";
              }
              if (choice === "skip") {
                tally.skipped++;
                note("skipped", combo, reply.found + " found");
              } else {
                badge("", "Saving…");
                var saved = await scrape(scriptName, query, false);
                if (saved.ok) {
                  tally.saved++;
                  note("saved", combo, saved.found + " found, " + saved.saved + " saved");
                  badge("ok", "Saved");
                } else {
                  failure(combo, saved);
                }
              }
            }
            done = i + 1;
            show();
            inARow = down ? inARow + 1 : 0;
            if (inARow >= MAX_FAILURES_IN_A_ROW && done < list.length) {
              lost = tooManyFailures();
              break;
            }
            // Be gentle on the league site, as the script is.
            if (!walk.stopped) await pause(300);
          }
        } catch (e) {
          lost = e.message;
        }

        var finished = !lost && done === list.length;
        walkDecideEl.hidden = true;
        walkStopEl.hidden = true;
        requestEl.textContent = "";
        show();
        walkStepEl.textContent = finished
          ? "Finished: " + plural(list.length, "combination", "combinations")
          : "Stopped after " + done + " / " + list.length;
        badge(lost ? "fail" : "ok", lost ? "Failed" : finished ? "Done" : "Stopped");
        var summary = "done: " + plural(done, "combination", "combinations") + ", " + tally.saved + " saved, " +
          tally.skipped + " skipped, " + tally.empty + " empty, " + tally.notOffered + " not offered, " +
          tally.failed + " failed.";
        logEl.textContent = (lost ? lost + "\n\n" : "") + summary + (journal.length ? "\n\n" + journal.join("\n") : "");
        walk = null;
        setBusy(false);
      }

      // ── Wiring ───────────────────────────────────────────────────────────

      leagueEl.add(new Option("Choose a league", ""));
      bsLeagueEl.add(new Option("Choose a league", ""));
      JSON.parse(el("leagues").textContent).forEach(function (league) {
        leagueEl.add(new Option(league.toUpperCase(), league));
        bsLeagueEl.add(new Option(league.toUpperCase(), league));
      });
      reset(competitionEl, "Choose a league first");
      reset(bsCompetitionEl, "Choose a league first");
      reset(specialtyEl, "Choose a competition first");
      reset(categoryEl, "Choose a competition first");
      refresh();

      leagueEl.addEventListener("change", loadCompetitions);
      competitionEl.addEventListener("change", loadOptions);
      form.querySelectorAll("input[name=script]").forEach(function (radio) {
        radio.addEventListener("change", function () {
          if (competitionEl.value) loadOptions();
          else forgetDryRun();
        });
      });
      form.querySelectorAll("input[name=mode]").forEach(function (radio) {
        radio.addEventListener("change", function () {
          forgetDryRun();
          describeOffer();
          refresh();
        });
      });
      specialtyEl.addEventListener("change", function () { forgetDryRun(); refresh(); });
      categoryEl.addEventListener("change", function () { forgetDryRun(); refresh(); });
      dryRunEl.addEventListener("change", refresh);

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (runEl.disabled) return;
        if (mode() === "walk") {
          runWalk(script(), { league: leagueEl.value, competition: competitionEl.value }, combinations(), dryRunEl.checked);
          return;
        }
        execute(script(), {
          league: leagueEl.value,
          competition: competitionEl.value,
          specialty: specialtyEl.value,
          category: categoryEl.value,
        }, dryRunEl.checked);
      });

      saveEl.addEventListener("click", function () {
        if (lastDryRun && !busy) execute(lastDryRun.script, lastDryRun.query, false, lastDryRun.register);
      });

      bsLeagueEl.addEventListener("change", function () { loadLeague(false); });
      bsNameEl.addEventListener("input", function () { forgetDryRun(); refresh(); });
      bsCompetitionEl.addEventListener("change", function () { forgetDryRun(); refresh(); });
      bsDryRunEl.addEventListener("change", refresh);
      bsInitEl.addEventListener("click", function () {
        if (!bsInitEl.disabled) initLeague(bsLeague.acronym, bsNameEl.value.trim());
      });
      bsFormEl.addEventListener("submit", function (event) {
        event.preventDefault();
        if (bsRunEl.disabled) return;
        var name = bsNameEl.value.trim();
        if (bsCompetitionEl.value === "*") {
          bootstrapAll(bsLeague.acronym, name, bsCompetitions.slice().reverse());
          return;
        }
        execute("infos", { league: bsLeague.acronym, competition: bsCompetitionEl.value }, bsDryRunEl.checked, {
          league: bsLeague.acronym,
          name: name,
        });
      });

      walkSaveEl.addEventListener("click", function () { answer("save"); });
      el("walk-skip").addEventListener("click", function () { answer("skip"); });
      el("walk-all").addEventListener("click", function () { answer("all"); });
      walkStopEl.addEventListener("click", stopWalk);

      // The script's keys: y save, n skip, a save all the rest, q stop.
      document.addEventListener("keydown", function (event) {
        if (!walk || event.ctrlKey || event.metaKey || event.altKey) return;
        var key = event.key.toLowerCase();
        if (key === "q") {
          event.preventDefault();
          stopWalk();
          return;
        }
        var choice = { y: "save", n: "skip", a: "all" }[key];
        if (choice && walk.decide) {
          event.preventDefault();
          answer(choice);
        }
      });
    })();
  </script>
</body>
</html>
`;
}
