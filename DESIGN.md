---
# ─────────────────────────────────────────────────────────────────────────────
# Machine-readable design tokens (design.md standard, https://design.md).
# Source of truth for the `:root { … }` custom-property block of
# gateway/index.html. Human-readable rationale lives in the markdown body.
# Edit here, then run `make tokens` to regenerate the landing page tokens.
# ─────────────────────────────────────────────────────────────────────────────

version: alpha
name: "Frontis Gateway"
description: "Pilotariak GraphQL gateway landing page — warm cream canvas, Basque red identity, dark code surfaces."

# Semantic palette. CSS custom-property names used by gateway/index.html are
# listed in the Colors section of the body; hack/gen-design-tokens.py maps
# each token to its `--var`.
colors:
  primary: "#C8102E"            # Basque Red — brand anchor, logo, focus ring, hover borders
  primary-dark: "#970D25"       # Fronton Dark Red — hero gradient stop
  primary-soft: "#FDE8EC"       # Blush — card icon bubbles for red-flavoured subgraphs
  primary-border: "rgba(200,16,46,0.2)"  # translucent red hairline
  background: "#F7F4EF"         # Warm Limestone Cream — page canvas (never white)
  surface: "#FFFDFC"            # Pearl Card White — content cards
  surface-elevated: "#FFFFFF"   # Pure White — scrolled nav, primary button, text on red
  surface-alt: "#F2EDE7"        # Sand — alternate section band, tags, version pill
  border: "#E5DED6"             # Warm Greige Line — universal border/divider
  text-primary: "#141414"       # Deep Ink — headings, code block and footer surfaces
  text: "#262626"               # Charcoal — body copy
  text-muted: "#7A7A7A"         # Warm Gray — eyebrows, descriptions, metadata
  text-subtle: "#A8A49E"        # Stone — footer links, code comments on dark
  success: "#1F7A5A"            # Tournament Green — live indicator
  success-soft: "#E6F4EE"       # Tournament Green Soft — icon bubbles, live dot
  championship: "#C8900A"       # Championship Amber — reserved accent
  championship-soft: "#FFF8E7"  # Championship Amber Soft — icon bubbles
  panel: "#1E1E1E"              # Panel Dark — endpoint pill
  shadow: "rgba(103,18,31,0.10)"  # red-tinted elevation shadow

typography:
  hero-title:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "64px"
    fontWeight: 900
    lineHeight: 1.0
    letterSpacing: "-1.5px"
  section-title:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "36px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.5px"
  card-title:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: "0px"
  lead:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0px"
  body:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "0px"
  body-sm:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  nav-link:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.65
    letterSpacing: "0px"
  button:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.0
    letterSpacing: "0px"
  eyebrow:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: "1.5px"
  label-caps:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: "1.2px"
  meta:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.65
    letterSpacing: "0px"
  method:
    fontFamily: '"Inter", Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: "0.5px"
  code:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0px"
  tag:
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.65
    letterSpacing: "0px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
  "3xl": "48px"
  section: "80px"
  gutter: "80px"
  gutter-tablet: "48px"
  gutter-mobile: "24px"
  nav-height: "64px"
  container: "1200px"

rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"

# Resting-state component tokens. Hover/active variants and borders are
# documented in the Components section of the body.
components:
  button-primary:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.primary}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "rgba(255,255,255,0.9)"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.surface-elevated}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    padding: "12px 24px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "rgba(255,255,255,0.08)"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
  card-icon:
    backgroundColor: "{colors.success-soft}"
    rounded: "{rounded.md}"
    size: "36px"
  tag:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text}"
    typography: "{typography.tag}"
    rounded: "{rounded.sm}"
    padding: "3px 8px"
  version-pill:
    backgroundColor: "{colors.surface-alt}"
    textColor: "{colors.text-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "4px 12px"
  endpoint:
    backgroundColor: "{colors.panel}"
    textColor: "rgba(255,255,255,0.82)"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  method-badge:
    backgroundColor: "rgba(200,16,46,0.65)"
    textColor: "{colors.surface-elevated}"
    typography: "{typography.method}"
    rounded: "{rounded.xs}"
    padding: "2px 8px"
  code-block:
    backgroundColor: "{colors.text-primary}"
    textColor: "rgba(247,244,239,0.88)"
    typography: "{typography.code}"
    rounded: "{rounded.lg}"
    padding: "24px 28px"
  inline-code:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text}"
    typography: "{typography.code}"
    rounded: "{rounded.xs}"
    padding: "1px 6px"
  footer:
    backgroundColor: "{colors.text-primary}"
    textColor: "{colors.background}"
    padding: "40px 80px"
---

# Design System — Frontis Gateway

> Landing page of the Pilotariak GraphQL federation gateway. Warm cream canvas, Basque red identity, dark code surfaces.

Frontis shares its palette with the Kancha mobile app so every Pilotariak surface reads as one family. This document
covers the web landing page served by `gateway/index.html`; the tokens above are the normative values and the
`:root` custom properties of that page are generated from them (`make tokens`).

---

## Overview

**Mood:** Disciplined and warm. Frontis is developer-facing infrastructure, so the page feels like a well-kept
federation: authoritative, calm, and precise. It borrows the materiality of a pelota fronton — cream stone, a deep red
banner, crisp white lines — and adds the dark, monospaced surfaces developers expect from an API product.

**Core philosophy:**

- A **cream canvas** (`#F7F4EF`) grounds the page. Never pure white, never cold gray.
- **Basque red** (`#C8102E`) is the single brand accent. It owns the hero gradient, the logo mark, focus rings and
  hover borders. It is never used for large text blocks below the hero.
- **Ink** (`#141414`) does double duty: headings on cream, and the surface of code blocks and the footer. The dark
  developer surfaces are the ink colour, not a new black.
- **Elevation through borders**, not shadows. Cards are `surface` on `background`, separated by the warm `border`
  line. The only shadow is red-tinted and reserved for the hovered primary button.
- The hero runs a **red → dark red → cream vertical gradient** so the page transitions into the cream field without a
  hard edge.

**Key characteristics:**

- Desktop-first marketing layout with a fixed max-width container (1200px) and responsive gutters.
- **Inter** at high weights carries the brand voice; a system monospace stack carries everything technical.
- No decorative imagery. Two translucent white circles in the hero are the only ornament.
- Confident, moderate geometry: 8px buttons, 12px cards, pills only for the version badge.

---

## Colors

The palette is a warm neutral family with one red accent, one green status colour and one amber reserve.

### Brand & primary

- **Primary — Basque Red (`#C8102E`):** logo marks, focus outline, card hover border, hero gradient top, primary button
  text. Full opacity only.
- **Primary Dark — Fronton Dark Red (`#970D25`):** hero gradient middle stop. Not used for text on this page.
- **Primary Soft — Blush (`#FDE8EC`):** icon bubbles for red-flavoured subgraph cards (specialties, results).
- **Primary Border (`rgba(200,16,46,0.2)`):** translucent red hairline, available for error-style boxes.

### Canvas & surfaces

- **Background — Warm Limestone Cream (`#F7F4EF`):** page canvas, hero gradient bottom stop, footer wordmark text.
- **Surface — Pearl Card White (`#FFFDFC`):** content cards on the cream canvas (one-step elevation).
- **Surface Elevated — Pure White (`#FFFFFF`):** scrolled navigation bar, primary button, all text over the red hero.
- **Surface Alt — Sand (`#F2EDE7`):** alternate section band (Quick Start), tag chips, scrolled version pill.
- **Border — Warm Greige Line (`#E5DED6`):** every border and divider on light surfaces; inline `code` background.

### Ink & text

- **Text Primary — Deep Ink (`#141414`):** headings, card titles, code block and footer backgrounds.
- **Text — Charcoal (`#262626`):** body copy, tags, scrolled nav links.
- **Text Muted — Warm Gray (`#7A7A7A`):** eyebrows, card descriptions, port badges, section subtitles.
- **Text Subtle — Stone (`#A8A49E`):** footer links, code language label, code comments on dark.

### Semantic

- **Success — Tournament Green (`#1F7A5A`):** reserved for live/healthy indicators.
- **Success Soft (`#E6F4EE`):** pulsing live dot in the hero eyebrow, echo card icon bubble.
- **Championship — Amber (`#C8900A`) / Amber Soft (`#FFF8E7`):** icon bubbles for the categories, clubs and
  competitions cards. Kept in the palette for parity with Kancha's finals treatment.
- **Panel — Dark (`#1E1E1E`):** endpoint pill background inside the hero.
- **Shadow (`rgba(103,18,31,0.10)`):** the one elevation shadow, red-tinted.

### Reference table (CSS custom properties)

| Token               | CSS variable    | Value                  | Usage                                   |
| ------------------- | --------------- | ---------------------- | --------------------------------------- |
| `primary`           | `--red`         | `#C8102E`              | Brand, focus ring, hover border         |
| `primary-dark`      | `--red-dark`    | `#970D25`              | Hero gradient stop                      |
| `primary-soft`      | `--red-soft`    | `#FDE8EC`              | Red icon bubbles                        |
| `primary-border`    | `--red-border`  | `rgba(200,16,46,0.2)`  | Translucent red hairline                |
| `background`        | `--cream`       | `#F7F4EF`              | Page canvas                             |
| `surface`           | `--card`        | `#FFFDFC`              | Content cards                           |
| `surface-elevated`  | `--white`       | `#FFFFFF`              | Scrolled nav, primary button, hero text |
| `surface-alt`       | `--surface-alt` | `#F2EDE7`              | Alternate band, tags, version pill      |
| `border`            | `--line`        | `#E5DED6`              | Borders, dividers, inline code bg       |
| `text-primary`      | `--ink`         | `#141414`              | Headings, dark surfaces                 |
| `text`              | `--text`        | `#262626`              | Body copy                               |
| `text-muted`        | `--muted`       | `#7A7A7A`              | Eyebrows, descriptions                  |
| `text-subtle`       | `--subtle`      | `#A8A49E`              | Footer links, code comments             |
| `success`           | `--green`       | `#1F7A5A`              | Live/healthy                            |
| `success-soft`      | `--green-soft`  | `#E6F4EE`              | Live dot, green icon bubble             |
| `championship`      | `--amber`       | `#C8900A`              | Reserved accent                         |
| `championship-soft` | `--amber-soft`  | `#FFF8E7`              | Amber icon bubbles                      |
| `panel`             | `--panel`       | `#1E1E1E`              | Endpoint pill                           |
| `shadow`            | `--shadow`      | `rgba(103,18,31,0.10)` | Primary button hover shadow             |

The font stacks are also exposed as custom properties: `--font` is `typography.body.fontFamily` and `--mono` is
`typography.code.fontFamily`.

Three literal colours remain hard-coded in `gateway/index.html` on purpose and are not tokens: the macOS-style window
dots of the code block header (`#ff5f57`, `#febc2e`, `#28c840`) and the syntax-highlight hues inside the sample
(`#C792EA`, `#C3E88D`, `#82AAFF`), which follow the Material palette conventions of code editors rather than the brand.

---

## Typography

**Font families:**

- **Inter** (variable, loaded from Google Fonts) for all prose and headings. The stack falls back to
  `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **System monospace** (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`) for the endpoint pill, tags, port
  badges, inline code and the code block.

**Scale and hierarchy:**

| Role            | Size | Weight | Line height | Letter spacing | Notes                                           |
| --------------- | ---- | ------ | ----------- | -------------- | ----------------------------------------------- |
| Hero title      | 64px | 900    | 1.0         | −1.5px         | 48px / −1px on tablet, 36px / −0.8px on mobile  |
| Section title   | 36px | 800    | 1.15        | −0.5px         | `h2` of each content section                    |
| Card title      | 20px | 700    | inherited   | 0              | Subgraph names                                  |
| Lead            | 18px | 400    | 1.7         | 0              | Hero and section subtitles (16px on mobile)     |
| Body            | 16px | 400    | 1.65        | 0              | Document default                                |
| Body small      | 14px | 400    | 1.5         | 0              | Card descriptions, footer links                 |
| Nav link        | 15px | 500    | inherited   | 0              | Hidden on mobile                                |
| Button          | 16px | 700    | 1.0         | 0              | Primary and secondary buttons                   |
| Eyebrow         | 12px | 700    | inherited   | +1.5px         | Always `uppercase`                              |
| Label caps      | 12px | 700    | inherited   | +1.2px         | Code language label; footer wordmark uses +1px  |
| Meta            | 12px | 600    | inherited   | 0              | Version pill                                    |
| Method          | 11px | 700    | inherited   | +0.5px         | `POST` badge, `uppercase`                       |
| Code            | 13px | 400    | 1.7         | 0              | Monospace; code block and endpoint pill         |
| Tag             | 12px | 500    | inherited   | 0              | Monospace chips, port badges                    |

**Principles:**

- Weight 900 is reserved for the hero title. Section titles use 800, card titles 700.
- Headline tracking is negative (−1.5px at 64px, −0.5px at 36px); small caps labels are positive (+1.2 to +1.5px).
- Every uppercase label (eyebrow, code language, method, footer wordmark) carries letter-spacing. No tracking, no caps.
- Anything a developer might copy is monospace: endpoint, tags, ports, inline code, code block.

---

## Layout

The page is a single column of full-width bands, each holding a centred **fixed-max-width container** (1200px).

### Spacing scale

| Token           | Value  | Usage                                              |
| --------------- | ------ | -------------------------------------------------- |
| `xs`            | 4px    | Pill vertical padding, tag gaps                    |
| `sm`            | 8px    | Icon/text gaps, eyebrow bottom margin              |
| `md`            | 12px   | Hero action gap, card header gap, button padding Y |
| `lg`            | 16px   | Title bottom margin, card description margin       |
| `xl`            | 24px   | Card padding, card grid gap, nav gaps              |
| `2xl`           | 32px   | Hero subtitle bottom margin                        |
| `3xl`           | 48px   | Section header bottom margin                       |
| `section`       | 80px   | Vertical padding of every content section          |
| `gutter`        | 80px   | Horizontal page gutter ≥ 1280px                    |
| `gutter-tablet` | 48px   | Gutter 1024–1279px (32px between 768 and 1023px)   |
| `gutter-mobile` | 24px   | Gutter < 768px                                     |
| `nav-height`    | 64px   | Fixed navigation bar                               |
| `container`     | 1200px | Max content width                                  |

### Grid

- **Card grid:** 3 columns ≥ 1024px, 2 columns 640–1023px, 1 column below. Gap `xl` (24px).
- **Hero:** centred flex column, min-height 480px (420px tablet, 320px mobile), padding `120px 80px 80px` so content
  clears the fixed nav.
- **Section header:** max-width 640px, left aligned, stacked eyebrow → title → subtitle.

### Breakpoints

| Range         | Behaviour                                                    |
| ------------- | ------------------------------------------------------------ |
| < 768px       | 24px gutters, nav links hidden, hero title 36px, 1-col grid  |
| 768–1023px    | 32–48px gutters, hero title 48px, 2-col grid                 |
| 1024–1279px   | 48px gutters, 3-col grid                                     |
| ≥ 1280px      | 80px gutters, 3-col grid                                     |

---

## Elevation & Depth

| Level | Surface            | Method                                                             |
| ----- | ------------------ | ------------------------------------------------------------------ |
| 0     | Cream page         | `background` — no border, no shadow                                |
| 0'    | Sand band          | `surface-alt` — tonal shift for the Quick Start section            |
| 1     | Content card       | `surface` + `1px solid border`                                     |
| 1h    | Card hover         | border turns `primary`; `0 4px 12px rgba(103,18,31,0.07)`          |
| 2     | Scrolled nav       | `surface-elevated` + `1px solid border` bottom                     |
| 3     | Hero               | red gradient; prominence by colour, white text                     |
| 3'    | Endpoint pill      | `panel` inset on the hero, `1px solid rgba(255,255,255,0.12)`      |
| 4     | Code block, footer | `text-primary` surfaces; the darkest layer                         |
| 5     | Primary button     | hover lifts 1px with `0 4px 16px shadow` (red-tinted)              |

**Shadow philosophy:** one shadow, red-tinted (`rgba(103,18,31,·)`), never cool gray. Cards separate by border colour
alone; the shadow appears only on the hovered primary button and, faintly, on the hovered card.

**Motion:** 150–200ms ease transitions on colour, border, shadow and transform. `prefers-reduced-motion` collapses
all animation to 0.01ms, including the pulsing live dot.

---

## Shapes

Moderate, consistent rounding. Larger surfaces get larger radii.

| Token  | Value  | Usage                                                    |
| ------ | ------ | -------------------------------------------------------- |
| `xs`   | 4px    | Method badge, inline code, focus-visible outline         |
| `sm`   | 6px    | Tag chips, footer logo                                   |
| `md`   | 8px    | Buttons, endpoint pill, nav logo, card icon bubble       |
| `lg`   | 12px   | Content cards, code block                                |
| `full` | 9999px | Version pill; hero circles and live dot are `50%`        |

Never go below 4px on an interactive element. Never mix a pill with a square corner in the same component.

---

## Components

### Navigation bar

```
Height:        64px, fixed, transparent over the hero
Scrolled:      background surface-elevated, border-bottom 1px solid border
Logo:          32px square, background primary, rounded md, "F" 14px weight 800 white
Title:         15px weight 700 — white over hero, text-primary when scrolled
Links:         15px weight 500 — rgba(255,255,255,0.82) over hero → text when scrolled, primary on hover
Version pill:  12px weight 600, rounded full, padding 4px 12px
               hero: rgba(255,255,255,0.12) bg, rgba(255,255,255,0.2) border, rgba(255,255,255,0.75) text
               scrolled: surface-alt bg, border border, text-muted text
```

### Hero

```
Background:    linear-gradient(to bottom, primary 0%, primary-dark 45%, background 100%)
Ornament:      two circles rgba(255,255,255,0.07), 400px top-right and 280px bottom-left
Eyebrow:       12px weight 700 uppercase +1.5px, rgba(255,255,255,0.75), with a 6px pulsing success-soft dot
Title:         64px weight 900 −1.5px white
Subtitle:      18px weight 400 line-height 1.7, rgba(255,255,255,0.82), max-width 560px
```

### Buttons

```
Shared:        padding 12px 24px, rounded md, 16px weight 700, min-height 44px, 2px border
Primary:       background surface-elevated, text primary, border surface-elevated
  hover:       background rgba(255,255,255,0.9), translateY(-1px), shadow 0 4px 16px
Secondary:     background transparent, text surface-elevated, border rgba(255,255,255,0.5)
  hover:       border surface-elevated, background rgba(255,255,255,0.08)
Active:        scale(0.98)
```

Buttons only appear on the hero, so both variants are designed for the red gradient.

### Endpoint pill & method badge

```
Pill:          background panel, border 1px solid rgba(255,255,255,0.12), rounded md, padding 8px 16px
               monospace 13px, text rgba(255,255,255,0.82)
Method badge:  background rgba(200,16,46,0.65), text surface-elevated, rounded xs, padding 2px 8px
               11px weight 700 uppercase +0.5px
```

### Section header

```
Eyebrow:       12px weight 700 uppercase +1.5px, text-muted, margin-bottom sm
Title:         36px weight 800 −0.5px, text-primary, margin-bottom lg
Subtitle:      18px weight 400 line-height 1.7, text-muted
Inline code:   monospace 14px, background border, text text, rounded xs, padding 1px 6px
```

### Content card (subgraph)

```
Background:    surface
Border:        1px solid border — primary on hover, plus 0 4px 12px rgba(103,18,31,0.07)
Rounded:       lg (12px)
Padding:       24px
Icon bubble:   36px square, rounded md, background success-soft / championship-soft / primary-soft
Title:         20px weight 700 text-primary
Description:   14px line-height 1.5 text-muted
Tags:          monospace 12px weight 500, background surface-alt, border 1px solid border, rounded sm, padding 3px 8px
Port badge:    monospace 12px text-muted, border-top 1px solid border, padding-top 12px
```

### Code block

```
Background:    text-primary (ink), rounded lg, overflow hidden
Header:        padding 10px 20px, border-bottom 1px solid rgba(255,255,255,0.08)
               three 10px dots (#ff5f57 / #febc2e / #28c840), language label 12px weight 700 uppercase +1.2px text-subtle
Body:          monospace 13px line-height 1.7, padding 24px 28px, text rgba(247,244,239,0.88)
Highlighting:  keywords #C792EA, strings #C3E88D, accent #82AAFF, comments text-subtle italic
```

### Footer

```
Background:    text-primary, padding 40px 80px (40px 24px on mobile)
Logo:          24px square, background primary, rounded sm, "F" 11px weight 800 white
Wordmark:      14px weight 700 uppercase +1px, background (cream)
Links:         14px weight 400 text-subtle → background on hover; separators rgba(255,255,255,0.12)
```

### Focus

Every focusable element gets `outline: 2px solid primary; outline-offset: 3px; border-radius: xs` on `:focus-visible`.

---

## Do's and Don'ts

### Do

- ✅ Use `background` (`#F7F4EF`) as the page canvas and `surface-alt` for alternate bands. Never `#FFFFFF` as a canvas.
- ✅ Keep red purposeful: logo, focus ring, hover border, hero gradient. One red element per hierarchy level.
- ✅ Separate cards from the canvas with `1px solid border`, not with shadows.
- ✅ Give every uppercase label letter-spacing (+1.2 to +1.5px) and weight 700.
- ✅ Set developer-facing strings (endpoints, headers, types, ports) in the monospace stack.
- ✅ Reuse `text-primary` for dark surfaces (code block, footer) instead of introducing a new black.
- ✅ Switch text from white to `text-primary` / `text-muted` as soon as content leaves the hero gradient.
- ✅ Respect `prefers-reduced-motion`; every animation must have a reduced fallback.
- ✅ Edit `DESIGN.md` first, then run `make tokens`; never hand-edit the `:root` block of `gateway/index.html`.

### Don't

- ❌ Don't use pure black (`#000000`); use `text-primary` or `panel`.
- ❌ Don't place `text-primary` or `text-muted` over the red hero; use white and translucent white.
- ❌ Don't use translucent white (`rgba(255,255,255,·)`) on the cream canvas; it is invisible there.
- ❌ Don't add shadows to content cards at rest; the border is the elevation.
- ❌ Don't use more than one accent per section. Red owns actions, green means live, amber is reserved.
- ❌ Don't go below `xs` (4px) radius on interactive elements or mix radii inside one component.
- ❌ Don't set `font-weight` 900 outside the hero title.
- ❌ Don't widen the container beyond 1200px or shrink gutters below 24px.
- ❌ Don't hard-code a brand colour in `gateway/index.html`; add a token and reference its `--var`.

---

## Agent Prompt Guide

### Quick colour reference

| Name         | Value                  | CSS variable    |
| ------------ | ---------------------- | --------------- |
| Red          | `#C8102E`              | `--red`         |
| Red Dark     | `#970D25`              | `--red-dark`    |
| Red Soft     | `#FDE8EC`              | `--red-soft`    |
| Cream        | `#F7F4EF`              | `--cream`       |
| Card         | `#FFFDFC`              | `--card`        |
| White        | `#FFFFFF`              | `--white`       |
| Surface Alt  | `#F2EDE7`              | `--surface-alt` |
| Line         | `#E5DED6`              | `--line`        |
| Ink          | `#141414`              | `--ink`         |
| Text         | `#262626`              | `--text`        |
| Muted        | `#7A7A7A`              | `--muted`       |
| Subtle       | `#A8A49E`              | `--subtle`      |
| Green        | `#1F7A5A`              | `--green`       |
| Green Soft   | `#E6F4EE`              | `--green-soft`  |
| Amber        | `#C8900A`              | `--amber`       |
| Amber Soft   | `#FFF8E7`              | `--amber-soft`  |
| Panel        | `#1E1E1E`              | `--panel`       |
| Shadow       | `rgba(103,18,31,0.10)` | `--shadow`      |

### Component prompts

**Hero band:**

> "Build a centred hero with a vertical gradient `var(--red)` 0% → `var(--red-dark)` 45% → `var(--cream)` 100%,
> min-height 480px, padding `120px 80px 80px`. Eyebrow: 12px weight 700 uppercase 1.5px tracking in
> `rgba(255,255,255,0.75)` with a 6px pulsing `var(--green-soft)` dot. Title: 64px weight 900 −1.5px white. Subtitle:
> 18px line-height 1.7 `rgba(255,255,255,0.82)`, max-width 560px."

**Subgraph card:**

> "Create a card with background `var(--card)`, `1px solid var(--line)`, radius 12px, padding 24px. Header row with a
> 36px icon bubble (radius 8px, background `var(--green-soft)`) and a 20px weight 700 `var(--ink)` title. Description
> 14px line-height 1.5 `var(--muted)`. Monospace 12px tags on `var(--surface-alt)` with a `var(--line)` border, radius
> 6px. Port badge 12px monospace `var(--muted)` above a `var(--line)` top border. On hover the border turns
> `var(--red)`."

**Code block:**

> "Render a code block with background `var(--ink)` and radius 12px. Header padding `10px 20px` with three 10px dots and
> an uppercase 12px weight 700 label in `var(--subtle)`. Body in `var(--mono)` 13px line-height 1.7, padding
> `24px 28px`, text `rgba(247,244,239,0.88)`."

**Section header:**

> "Stack an uppercase eyebrow (12px weight 700 1.5px tracking `var(--muted)`), a 36px weight 800 −0.5px `var(--ink)`
> title and an 18px line-height 1.7 `var(--muted)` subtitle. Max-width 640px, margin-bottom 48px."

### Iteration guide

1. **Tokens first.** Change `DESIGN.md`, run `make tokens`, commit both. CI fails on drift.
2. **The hero is the only red zone.** Below it, text is ink or muted and red is a 1–2px accent.
3. **Borders replace shadows.** If a card has a resting `box-shadow`, remove it and check the border.
4. **Monospace for anything copyable.** If a developer would paste it, it is `var(--mono)`.
5. **Caps carry tracking.** An uppercase label without letter-spacing is wrong.
6. **Reduced motion is mandatory.** Any new animation goes under the existing `prefers-reduced-motion` rule.
