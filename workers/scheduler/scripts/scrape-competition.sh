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
#   ./scrape-competition.sh <league> [--phase N]
#
# Requires: wrangler, jq, curl. Run from a dir where the D1 binding resolves
# (e.g. database/ or workers/scheduler/).

set -euo pipefail

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

LEAGUE="${1:?usage: scrape-competition.sh <league> [--phase N]}"
shift || true

BASE="${SCHEDULER_BASE:-https://frontis-scheduler.pilotariak.com}"
DB_NAME="pilotariak-${LEAGUE}"
PHASE="0"
# Default to remote D1. --local reads the persisted local state instead.
D1_TARGET=(--remote)

# wrangler is not on PATH; run the workspace-pinned one via bunx.
WRANGLER=(bunx wrangler)

ALL=0   # --all: skip specialty/category menus, loop every combo and save.

while [ $# -gt 0 ]; do
  case "$1" in
    --phase) PHASE="$2"; shift ;;
    --local) D1_TARGET=(--local --persist-to ../.wrangler/state) ;;
    --all)   ALL=1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

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
  read -rp "${BOLD}Proceed? [y/N]${RESET} > " go
  case "$go" in y|Y|yes|YES) ;; *) echo "${YELLOW}aborted.${RESET}"; exit 0 ;; esac

  n=0 saved=0 skipped=0 auto=0
  for spec in "${SPECS[@]}"; do
    for cat in "${CATS[@]}"; do
      n=$((n + 1))
      q="league=${LEAGUE}&competition=${COMPETITION}&specialty=${spec}&category=${cat}&phase=${PHASE}${NOCOLOR}"

      # Preview first (dry run), so the user sees results before saving.
      preview="$(curl -fsS "${BASE}/scrape_results?${q}&dry_run=true&format=tsv" || echo "  (request failed)")"

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
          if curl -fsS "${BASE}/scrape_results?${q}" >/dev/null; then
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
render_table "$(curl -fsS "${BASE}/scrape_results?${q}&dry_run=true&format=tsv")"
echo ""

read -rp "${BOLD}Save these results into D1? [y/N]${RESET} > " answer
case "$answer" in
  y|Y|yes|YES)
    echo "${BOLD}${BLUE}── Saving ────────────────────────────────────────────────────${RESET}"
    curl -fsS "${BASE}/scrape_results?${q}"
    echo ""
    echo "${GREEN}done.${RESET}"
    ;;
  *)
    echo "${YELLOW}aborted, nothing saved.${RESET}"
    ;;
esac
