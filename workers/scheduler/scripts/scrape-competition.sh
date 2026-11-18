#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0
#
# Interactive single-competition result loader.
#
# Flow:
#   1. pick a competition
#   2. pick a specialty
#   3. pick a category
#   4. preview results (dry run), then confirm to persist into D1
#
# Usage:
#   ./scrape-competition.sh <league> [--phase N] [--all] [--save]
#
# --save skips every interactive confirmation and persists results straight into
# D1 (non-interactive / CI-friendly). Without it, each save is confirmed.
#
# Requires: wrangler, jq, curl. Runs from any directory: it moves to database/,
# where wrangler finds the D1 bindings and --local finds the shared state.
#
# The deployed scheduler (the default SCHEDULER_BASE) is behind Cloudflare
# Access. Set CF_ACCESS_TOKEN (cloudflared access token -app=<url>), or
# CF_CLIENT_ID and CF_CLIENT_SECRET for a service token, to call it.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../../database"

# ── Colors ────────────────────────────────────────────────────────────────────
# Enabled only when stderr is a terminal and NO_COLOR is unset. When piped, all
# codes collapse to empty strings and the worker is asked for plain output too.
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ]; then
  RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
  BLUE=$'\033[34m'; MAGENTA=$'\033[35m'; CYAN=$'\033[36m'
  NOCOLOR=""                 # let the worker emit its own ANSI in previews
else
  RESET=""; BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; MAGENTA=""; CYAN=""
  NOCOLOR="&no_color=true"   # ask the worker for plain output
fi

LEAGUE="${1:?usage: scrape-competition.sh <league> [--phase N] [--all] [--save]}"
shift || true

BASE="${SCHEDULER_BASE:-https://frontis-scheduler.pilotariak.com}"
DB_NAME="pilotariak-${LEAGUE}"
PHASE="0"
# Default to remote D1. --local reads the persisted local state instead.
D1_TARGET=(--remote)

# wrangler is not on PATH; run the workspace-pinned one via bunx.
WRANGLER=(bunx wrangler)

ALL=0   # --all: skip specialty/category menus, loop every combo and save.
SAVE=0  # --save: skip every confirmation prompt and persist automatically.
LOCAL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --phase) PHASE="$2"; shift ;;
    --local) LOCAL=1; D1_TARGET=(--local --persist-to ../.wrangler/state) ;;
    --all)   ALL=1 ;;
    --save)  SAVE=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# --local lists local ids; a remote worker would resolve them against its own
# database and load a different competition than the one picked.
if [ "$LOCAL" -eq 1 ]; then
  case "$BASE" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) echo "${RED}--local needs a local worker: set SCHEDULER_BASE=http://127.0.0.1:8787.${RESET}" >&2; exit 2 ;;
  esac
fi

# ── Scheduler calls ───────────────────────────────────────────────────────────
if [ -n "${CF_CLIENT_ID:-}${CF_CLIENT_SECRET:-}" ] && { [ -z "${CF_CLIENT_ID:-}" ] || [ -z "${CF_CLIENT_SECRET:-}" ]; }; then
  echo "${RED}set both CF_CLIENT_ID and CF_CLIENT_SECRET, or neither.${RESET}" >&2
  exit 2
fi

access_headers() {
  if [ -n "${CF_ACCESS_TOKEN:-}" ]; then
    printf 'cf-access-token: %s\n' "$CF_ACCESS_TOKEN"
  else
    printf 'CF-Access-Client-Id: %s\nCF-Access-Client-Secret: %s\n' "$CF_CLIENT_ID" "$CF_CLIENT_SECRET"
  fi
}

# api <url> [curl args...] -> curl the scheduler, with the Cloudflare Access
# headers when credentials are set. Headers are read from a file descriptor so
# the secrets stay out of the process list.
api() {
  if [ -n "${CF_ACCESS_TOKEN:-}${CF_CLIENT_ID:-}" ]; then
    curl -fsS -H @<(access_headers) "$@"
  else
    curl -fsS "$@"
  fi
}

# Without valid credentials Cloudflare Access answers with a redirect to its
# login page, which curl -f treats as success: every call would then silently
# do nothing. Fail before the first menu instead.
version="$(api "${BASE}/version" 2>/dev/null || true)"
if [[ "$version" != *'"version"'* ]]; then
  echo "${RED}no scheduler answers at ${BASE}.${RESET}" >&2
  echo "  local worker:    start it with 'bun run scheduler:local' or 'bun run scheduler:remote'." >&2
  echo "  deployed worker: set CF_ACCESS_TOKEN, or CF_CLIENT_ID and CF_CLIENT_SECRET (Cloudflare Access)." >&2
  exit 1
fi

# rows() runs inside process substitutions, where a wrangler failure (expired
# login, unknown database) would be lost and read as an empty table. Check that
# D1 answers before the first menu.
if ! d1_check="$("${WRANGLER[@]}" d1 execute "$DB_NAME" "${D1_TARGET[@]}" --json --command "SELECT 1" 2>&1)"; then
  echo "${RED}cannot query ${DB_NAME} with wrangler:${RESET}" >&2
  printf '%s\n' "$d1_check" | grep -m1 -E 'ERROR|"text"' >&2 || true
  echo "  if your wrangler login expired, run 'bunx wrangler login' (or set CLOUDFLARE_API_TOKEN)." >&2
  exit 1
fi

# rows <table> -> lines "id<TAB>name" from D1.
rows() {
  "${WRANGLER[@]}" d1 execute "$DB_NAME" "${D1_TARGET[@]}" --json \
    --command "SELECT id, name FROM $1 ORDER BY name" \
    | jq -r '.[0].results[] | "\(.id)\t\(.name)"'
}

# render_table <tsv-text>
# Draws a bordered ASCII grid from the worker's TSV (format=tsv).
# Line 1 is a "# ..." meta line (printed as-is); the rest is a tab-separated
# table whose first row is the header. Column widths auto-fit the content.
render_table() {
  local tsv="$1"
  printf '%s\n' "$(sed -n '1p' <<<"$tsv")"          # meta line
  # Perl with -CSDA so length()/sprintf count characters, not bytes — keeps
  # columns aligned when cells contain accents (é, è …). A cell may hold several
  # stacked lines, joined with US (\x1f) by the worker (e.g. club + its players);
  # each becomes its own physical line inside the row. A border is drawn after
  # every row; the header labels are centered, data cells left-aligned.
  sed '1d' <<<"$tsv" | perl -CSDA -e '
    sub pad_left   { my ($s,$w) = @_; $s . (" " x ($w - length $s)); }
    sub pad_center {
      my ($s,$w) = @_; my $t = $w - length $s;
      my $l = int($t / 2); my $r = $t - $l;
      (" " x $l) . $s . (" " x $r);
    }

    my @rows;                                     # each row: arrayref of cells,
    while (<STDIN>) {                             # each cell: arrayref of lines
      chomp;
      push @rows, [ map { [ split /\x1f/, $_, -1 ] } split /\t/, $_, -1 ];
    }

    # Column widths = widest sub-line across every row.
    my @w;
    for my $r (@rows) {
      for my $i (0 .. $#$r) {
        for my $ln (@{ $r->[$i] }) {
          $w[$i] = length $ln if !defined $w[$i] || length $ln > $w[$i];
        }
      }
    }
    my $sep = "+" . join("+", map { "-" x ($_ + 2) } @w) . "+";

    print "$sep\n";
    for my $ri (0 .. $#rows) {
      my $r = $rows[$ri];
      my $height = 0;
      for my $c (@$r) { $height = @$c if @$c > $height; }   # tallest cell
      for my $k (0 .. $height - 1) {
        print "|" . join("", map {
          my $v = defined $r->[$_][$k] ? $r->[$_][$k] : "";
          " " . ($ri == 0 ? pad_center($v, $w[$_]) : pad_left($v, $w[$_])) . " |";
        } 0 .. $#w) . "\n";
      }
      print "$sep\n";                              # border after every row
    }
  '
}

# pick <label> <table> -> sets global REPLY_ID to the chosen row id.
pick() {
  local label="$1" table="$2"
  local -a ids=() names=()
  while IFS=$'\t' read -r id name; do
    ids+=("$id"); names+=("$name")
  done < <(rows "$table")

  if [ "${#ids[@]}" -eq 0 ]; then
    echo "${RED}no $label found in $DB_NAME — run /scrape_infos first.${RESET}" >&2
    exit 1
  fi

  echo "" >&2
  echo "${BOLD}${CYAN}Choose a $label:${RESET}" >&2
  local i
  for i in "${!ids[@]}"; do
    printf "  ${YELLOW}%3d)${RESET} %s  ${DIM}[id=%s]${RESET}\n" "$((i + 1))" "${names[$i]}" "${ids[$i]}" >&2
  done

  local choice
  while :; do
    read -rp "${BOLD}$label #${RESET} > " choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "${#ids[@]}" ]; then
      REPLY_ID="${ids[$((choice - 1))]}"
      echo "  ${GREEN}-> ${names[$((choice - 1))]} (id=$REPLY_ID)${RESET}" >&2
      return
    fi
    echo "  ${RED}invalid, pick 1..${#ids[@]}${RESET}" >&2
  done
}

pick "competition" competitions; COMPETITION="$REPLY_ID"

# ── --all: pick competition only, then loop every specialty x category ────────
if [ "$ALL" -eq 1 ]; then
  mapfile -t SPECS < <(rows specialties | cut -f1)
  mapfile -t CATS  < <(rows categories  | cut -f1)
  echo ""
  echo "${CYAN}Looping ${BOLD}${#SPECS[@]}${RESET}${CYAN} specialties x ${BOLD}${#CATS[@]}${RESET}${CYAN} categories for competition=${COMPETITION} (saving each).${RESET}"
  if [ "$SAVE" -eq 0 ]; then
    read -rp "${BOLD}Proceed? [y/N]${RESET} > " go
    case "$go" in y|Y|yes|YES) ;; *) echo "${YELLOW}aborted.${RESET}"; exit 0 ;; esac
  fi

  # --save: auto-persist every combo, no per-result prompt.
  n=0 saved=0 skipped=0 auto="$SAVE"
  for spec in "${SPECS[@]}"; do
    for cat in "${CATS[@]}"; do
      n=$((n + 1))
      q="league=${LEAGUE}&competition=${COMPETITION}&specialty=${spec}&category=${cat}&phase=${PHASE}${NOCOLOR}"

      # Preview first (dry run), so the user sees results before saving.
      preview="$(api "${BASE}/scrape_results?${q}&dry_run=true&format=tsv" || echo "  (request failed)")"

      # Auto-skip combos with no results — nothing to save.
      if grep -q "(no results)" <<<"$preview"; then
        skipped=$((skipped + 1))
        continue
      fi

      echo ""
      echo "${BOLD}${BLUE}── [$n] spec=$spec cat=$cat ─────────────────────────────────${RESET}"
      render_table "$preview"

      if [ "$auto" -eq 1 ]; then
        ans="y"
      else
        read -rp "${BOLD}Save?${RESET} ${GREEN}[y]es${RESET} / ${RED}[n]o${RESET} / ${CYAN}[a]ll-rest${RESET} / ${MAGENTA}[q]uit${RESET} > " ans </dev/tty
      fi

      case "$ans" in
        a|A) auto=1; ans="y" ;;
        q|Q) echo "${MAGENTA}quit.${RESET}"; break 2 ;;
      esac

      case "$ans" in
        y|Y|yes|YES)
          if api "${BASE}/scrape_results?${q}" >/dev/null; then
            echo "  ${GREEN}saved.${RESET}"; saved=$((saved + 1))
          else
            echo "  ${RED}FAILED.${RESET}"
          fi
          ;;
        *) echo "  ${DIM}skipped.${RESET}" ;;
      esac
      sleep 0.3   # be gentle on the upstream site
    done
  done
  echo ""
  echo "${BOLD}done: $n combos — ${GREEN}$saved saved${RESET}${BOLD}, ${DIM}$skipped empty-skipped${RESET}${BOLD}.${RESET}"
  exit 0
fi

pick "specialty"   specialties;  SPECIALTY="$REPLY_ID"
pick "category"    categories;   CATEGORY="$REPLY_ID"

q="league=${LEAGUE}&competition=${COMPETITION}&specialty=${SPECIALTY}&category=${CATEGORY}&phase=${PHASE}${NOCOLOR}"

echo ""
echo "${BOLD}${BLUE}── Preview (dry run) ─────────────────────────────────────────${RESET}"
render_table "$(api "${BASE}/scrape_results?${q}&dry_run=true&format=tsv")"
echo ""

if [ "$SAVE" -eq 1 ]; then
  answer="y"
else
  read -rp "${BOLD}Save these results into D1? [y/N]${RESET} > " answer
fi
case "$answer" in
  y|Y|yes|YES)
    echo "${BOLD}${BLUE}── Saving ────────────────────────────────────────────────────${RESET}"
    api "${BASE}/scrape_results?${q}"
    echo ""
    echo "${GREEN}done.${RESET}"
    ;;
  *)
    echo "${YELLOW}aborted, nothing saved.${RESET}"
    ;;
esac
