#!/usr/bin/env python3
# SPDX-FileCopyrightText: Copyright (C) Nicolas Lamirault <nicolas.lamirault@gmail.com>
# SPDX-License-Identifier: Apache-2.0
"""Generate the `:root { … }` design-token block of gateway/index.html from DESIGN.md.

DESIGN.md frontmatter is the single source of truth for every design token.
This script renders the CSS custom properties the landing page relies on
(`--red`, `--cream`, `--font`, …) from those tokens, so the stylesheet can
never drift from the documented design system.

Colour variables come from the standard `colors:` block; the two font-stack
variables come from `typography.<level>.fontFamily`.

Usage:
    gen-design-tokens.py            # rewrite gateway/index.html in place
    gen-design-tokens.py --check    # exit 1 if index.html is out of date (CI)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError:
    sys.exit("error: PyYAML is required (pip install pyyaml)")

ROOT = Path(__file__).resolve().parent.parent
DESIGN = ROOT / "DESIGN.md"
INDEX = ROOT / "gateway" / "index.html"

# Source of each CSS variable's value in the frontmatter:
#   ("c", key)   -> colors[key]
#   ("f", level) -> typography[level].fontFamily
Source = tuple[str, str]

# Order is the emitted order inside `:root`.
FIELDS: list[tuple[str, Source]] = [
    ("--red", ("c", "primary")),
    ("--red-dark", ("c", "primary-dark")),
    ("--red-soft", ("c", "primary-soft")),
    ("--red-border", ("c", "primary-border")),
    ("--cream", ("c", "background")),
    ("--card", ("c", "surface")),
    ("--white", ("c", "surface-elevated")),
    ("--surface-alt", ("c", "surface-alt")),
    ("--line", ("c", "border")),
    ("--ink", ("c", "text-primary")),
    ("--text", ("c", "text")),
    ("--muted", ("c", "text-muted")),
    ("--subtle", ("c", "text-subtle")),
    ("--green", ("c", "success")),
    ("--green-soft", ("c", "success-soft")),
    ("--amber", ("c", "championship")),
    ("--amber-soft", ("c", "championship-soft")),
    ("--panel", ("c", "panel")),
    ("--shadow", ("c", "shadow")),
    ("--font", ("f", "body")),
    ("--mono", ("f", "code")),
]

# Column at which colour values start, so the block stays visually aligned.
VALUE_COLUMN = 15
INDENT = "      "

ROOT_RE = re.compile(
    r"(/\* ── Design System Tokens ── \*/\n\s*:root \{\n).*?(\n\s*\})",
    re.S,
)


def load_tokens() -> dict:
    text = DESIGN.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        sys.exit("error: DESIGN.md has no YAML frontmatter")
    return yaml.safe_load(m.group(1))


def resolve(tokens: dict, var: str, source: Source) -> str:
    kind, key = source
    if kind == "c":
        value = tokens.get("colors", {}).get(key)
    elif kind == "f":
        value = tokens.get("typography", {}).get(key, {}).get("fontFamily")
    else:  # pragma: no cover
        value = None
    if value is None:
        sys.exit(f"error: token for '{var}' ({source}) not found in DESIGN.md")
    return str(value)


def render_body(entries: list[tuple[str, str, str]]) -> str:
    """Render `:root` declarations. Colours are column-aligned; font stacks are
    long and get a single space."""
    lines = []
    for var, kind, value in entries:
        name = f"{var}:"
        pad = " " if kind == "f" else " " * max(1, VALUE_COLUMN - len(name))
        lines.append(f"{INDENT}{name}{pad}{value};")
    return "\n".join(lines)


def rewrite(text: str, body: str) -> str:
    if not ROOT_RE.search(text):
        sys.exit(f"error: no '/* ── Design System Tokens ── */ :root {{' block found in {INDEX}")
    return ROOT_RE.sub(lambda m: f"{m.group(1)}{body}{m.group(2)}", text, count=1)


def main() -> int:
    check = "--check" in sys.argv[1:]
    tokens = load_tokens()

    entries = [(var, src[0], resolve(tokens, var, src)) for var, src in FIELDS]

    old = INDEX.read_text()
    updated = rewrite(old, render_body(entries))

    rel = INDEX.relative_to(ROOT)
    if check:
        if updated != old:
            sys.stderr.write(
                f"error: {rel} is out of date with DESIGN.md tokens.\n"
                "       run `make tokens` and commit the result.\n"
            )
            return 1
        print(f"✅ {rel} matches DESIGN.md")
        return 0

    if updated != old:
        INDEX.write_text(updated)
        print(f"✅ wrote {rel} from DESIGN.md")
    else:
        print(f"✅ {rel} already up to date")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
