/**
 * The /admin page. It lives in a TypeScript string rather than an .html import:
 * `bun test` loads .html imports as HTML bundles, not text, so tests could not
 * read the page.
 *
 * The page is a String.raw template: `${…}` interpolates server-side values, so
 * the inline script must use neither backticks nor `${`. Names scraped from the
 * league sites only ever reach the DOM through `new Option()` and textContent.
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

    .segmented {
      display: inline-flex;
      padding: 4px;
      gap: 4px;
      background: var(--surface-alt);
      border: 1px solid var(--line);
      border-radius: 12px;
      margin-bottom: 24px;
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

    .steps { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
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
    select {
      width: 100%;
      font: inherit;
      color: var(--text);
      background: var(--white);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
    }
    select:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }
    select:disabled { color: var(--subtle); background: var(--surface-alt); }

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
      .steps { grid-template-columns: 1fr; }
      .primary { margin-left: 0; width: 100%; }
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
      <p class="lede">Pick what to scrape from the league site, preview it with a dry run, then save it into D1.</p>
    </div>

    <form class="card" id="form" novalidate>
      <div class="segmented" role="radiogroup" aria-label="Script">
        <input type="radio" name="script" id="script-results" value="results" checked />
        <label for="script-results">Match results</label>
        <input type="radio" name="script" id="script-rankings" value="rankings" />
        <label for="script-rankings">Rankings</label>
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
        <div class="field">
          <label for="specialty"><b>3</b>Specialty</label>
          <select id="specialty" required disabled></select>
        </div>
        <div class="field">
          <label for="category"><b>4</b>Category</label>
          <select id="category" required disabled></select>
        </div>
      </div>

      <p class="hint" id="hint" role="status" aria-live="polite"></p>

      <div class="actions">
        <label class="check">
          <input type="checkbox" id="dry-run" checked />
          Dry run <small>— fetch and show, save nothing</small>
        </label>
        <button type="submit" class="primary" id="run" disabled>Preview</button>
      </div>
    </form>

    <section class="card output" id="output" hidden aria-live="polite">
      <div class="output-head">
        <span class="badge" id="badge"></span>
        <code class="request" id="request"></code>
        <button type="button" class="secondary" id="save" hidden>Save these results</button>
      </div>
      <pre id="log"></pre>
    </section>
  </main>

  <script type="application/json" id="leagues">${leaguesJson}</script>
  <script>
    (function () {
      "use strict";

      var SESSION_LOST = "No answer from the scheduler. Your Cloudflare Access session may have expired: reload the page.";

      function el(id) { return document.getElementById(id); }
      var form = el("form");
      var leagueEl = el("league");
      var competitionEl = el("competition");
      var specialtyEl = el("specialty");
      var categoryEl = el("category");
      var dryRunEl = el("dry-run");
      var runEl = el("run");
      var hintEl = el("hint");
      var outputEl = el("output");
      var badgeEl = el("badge");
      var requestEl = el("request");
      var saveEl = el("save");
      var logEl = el("log");

      // Each menu load bumps its counter, so a slow answer to an older pick
      // never overwrites the menus of a newer one.
      var loads = { competitions: 0, options: 0 };
      var busy = false;
      var lastDryRun = null;

      function script() { return form.elements.namedItem("script").value; }

      function hint(text, isError) {
        hintEl.textContent = text || "";
        hintEl.classList.toggle("error", Boolean(isError));
      }

      function reset(select, placeholder) {
        select.replaceChildren(new Option(placeholder, ""));
        select.disabled = true;
      }

      // Access answers an expired session with a redirect to its login page:
      // a cross-origin hop that fetch() reports as a network error, or an HTML
      // page. Neither is JSON.
      async function getJson(url) {
        var res;
        try {
          res = await fetch(url, { headers: { Accept: "application/json" } });
        } catch (e) {
          throw new Error(SESSION_LOST);
        }
        if ((res.headers.get("content-type") || "").indexOf("application/json") === -1) {
          throw new Error(SESSION_LOST);
        }
        var body = await res.json();
        if (!res.ok) throw new Error(body.error || "HTTP " + res.status);
        return body;
      }

      // parent is a select or an optgroup, which has no add().
      function addOptions(parent, items) {
        items.forEach(function (item) {
          if (item.id === null) {
            var missing = new Option(item.name + " (not in database: run /scrape_infos)", "");
            missing.disabled = true;
            parent.appendChild(missing);
          } else {
            parent.appendChild(new Option(item.name, String(item.id)));
          }
        });
      }

      function refresh() {
        var ready = Boolean(leagueEl.value && competitionEl.value && specialtyEl.value && categoryEl.value);
        runEl.disabled = busy || !ready;
        var dry = dryRunEl.checked;
        runEl.textContent = dry ? "Preview" : "Run and save";
        runEl.classList.toggle("save", !dry);
      }

      function forgetDryRun() {
        lastDryRun = null;
        saveEl.hidden = true;
      }

      async function loadCompetitions() {
        var mine = ++loads.competitions;
        loads.options++;
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
          var body = await getJson("/admin/competitions?" + new URLSearchParams({ league: leagueEl.value }));
          if (mine !== loads.competitions) return;
          reset(competitionEl, body.competitions.length ? "Choose a competition" : "No competition: run /scrape_infos");
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
          var body = await getJson("/admin/options?" + new URLSearchParams({
            league: leagueEl.value,
            competition: competitionEl.value,
            script: script(),
          }));
          if (mine !== loads.options) return;
          reset(specialtyEl, "Choose a specialty");
          specialtyEl.add(new Option("All specialties", "0"));
          addOptions(specialtyEl, body.specialties);
          specialtyEl.disabled = false;
          reset(categoryEl, "Choose a category");
          categoryEl.add(new Option("All categories", "0"));
          addOptions(categoryEl, body.categories);
          categoryEl.disabled = false;
          hint(body.specialties.length + " specialties and " + body.categories.length + " categories offered.");
        } catch (e) {
          if (mine !== loads.options) return;
          reset(specialtyEl, "Not available");
          reset(categoryEl, "Not available");
          hint(e.message, true);
        }
        refresh();
      }

      async function execute(scriptName, query, dryRun) {
        var params = new URLSearchParams(query);
        params.set("no_color", "true");
        params.set("dry_run", String(dryRun));
        var path = "/scrape_" + scriptName + "?" + params;

        busy = true;
        forgetDryRun();
        refresh();
        saveEl.disabled = true;
        outputEl.hidden = false;
        badgeEl.className = "badge";
        badgeEl.textContent = dryRun ? "Running dry run…" : "Running and saving…";
        requestEl.textContent = "GET " + path;
        logEl.textContent = "";
        var started = performance.now();

        try {
          var res;
          try {
            res = await fetch(path);
          } catch (e) {
            throw new Error(SESSION_LOST);
          }
          var type = res.headers.get("content-type") || "";
          if (type.indexOf("text/plain") === -1 && type.indexOf("application/json") === -1) {
            throw new Error(SESSION_LOST);
          }
          var text = await res.text();
          if (type.indexOf("application/json") !== -1) {
            try { text = JSON.parse(text).error || text; } catch (e) { /* keep the raw body */ }
          }
          var seconds = ((performance.now() - started) / 1000).toFixed(1) + " s";
          if (res.ok) {
            badgeEl.className = dryRun ? "badge dry" : "badge ok";
            badgeEl.textContent = (dryRun ? "Dry run, nothing saved" : "Saved") + " · " + seconds;
            if (dryRun) {
              lastDryRun = { script: scriptName, query: query };
              saveEl.textContent = scriptName === "rankings" ? "Save these rankings" : "Save these results";
              saveEl.hidden = false;
            }
          } else {
            badgeEl.className = "badge fail";
            badgeEl.textContent = "HTTP " + res.status + " · " + seconds;
          }
          logEl.textContent = text;
        } catch (e) {
          badgeEl.className = "badge fail";
          badgeEl.textContent = "Failed";
          logEl.textContent = e.message;
        } finally {
          busy = false;
          saveEl.disabled = false;
          refresh();
        }
      }

      leagueEl.add(new Option("Choose a league", ""));
      JSON.parse(el("leagues").textContent).forEach(function (league) {
        leagueEl.add(new Option(league.toUpperCase(), league));
      });
      reset(competitionEl, "Choose a league first");
      reset(specialtyEl, "Choose a competition first");
      reset(categoryEl, "Choose a competition first");

      leagueEl.addEventListener("change", loadCompetitions);
      competitionEl.addEventListener("change", loadOptions);
      form.querySelectorAll("input[name=script]").forEach(function (radio) {
        radio.addEventListener("change", function () {
          if (competitionEl.value) loadOptions();
          else forgetDryRun();
        });
      });
      specialtyEl.addEventListener("change", function () { forgetDryRun(); refresh(); });
      categoryEl.addEventListener("change", function () { forgetDryRun(); refresh(); });
      dryRunEl.addEventListener("change", refresh);

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (runEl.disabled) return;
        execute(script(), {
          league: leagueEl.value,
          competition: competitionEl.value,
          specialty: specialtyEl.value,
          category: categoryEl.value,
        }, dryRunEl.checked);
      });

      saveEl.addEventListener("click", function () {
        if (lastDryRun && !busy) execute(lastDryRun.script, lastDryRun.query, false);
      });
    })();
  </script>
</body>
</html>
`;
}
