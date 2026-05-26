---
name: "Agent / PR Triage"
timeout-minutes: 15
strict: true
on:
  schedule: "0 */6 * * 1-5"
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: read
  issues: read
tools:
  github:
    lockdown: true
    toolsets: [pull_requests, labels]
safe-outputs:
  add-labels:
    allowed:
      - kind/bug
      - kind/feature
      - kind/documentation
      - kind/question
      - kind/cleanup
      - kind/deprecation
      - size/xs
      - size/s
      - size/m
      - size/l
      - size/xl
      - priority/critical
      - priority/high
      - priority/medium
      - priority/low
      - priority/backlog
      - status/review_needed
  remove-labels:
    allowed:
      - needs/triage
      - needs/kind
      - needs/size
      - needs/priority
  add-comment: {}
---

# PR Triage Agent

List open pull requests in ${{ github.repository }} that have the label `needs/triage` or no labels.

For each untriaged PR, analyze the title, description, and changed files, then apply the following:

## 1. Assign one `kind/*` label

Classify based on file patterns and PR description:

- `kind/bug` — fixes a defect, error, or incorrect behavior (keywords: fix, bug, issue, error, crash, regression)
- `kind/feature` — adds new capability or significant enhancement (keywords: add, implement, new, feature, support)
- `kind/documentation` — changes only to `.md`, `.txt`, `.rst` or doc site files
- `kind/cleanup` — refactoring, dead code removal, tech debt, formatting (no behavior change)
- `kind/deprecation` — removes or marks a feature as end-of-life

When files span multiple categories, use the category covering the most significant change.

## 2. Assign one `size/*` label

Estimate scope from the number of changed lines (additions + deletions):

| Label | Lines changed |
|---|---|
| `size/xs` | < 10 |
| `size/s` | 10 – 49 |
| `size/m` | 50 – 249 |
| `size/l` | 250 – 499 |
| `size/xl` | ≥ 500 |

## 3. Assign one `priority/*` label

Assess urgency based on impact and context:

- `priority/critical` — security fix, data loss, or broken core functionality
- `priority/high` — significant regression or user-facing breakage
- `priority/medium` — notable improvement but non-blocking
- `priority/low` — minor fix or improvement; workaround exists
- `priority/backlog` — valid but no urgency to act now

## 4. Set status and clean up

- Add `status/review_needed` if no reviewer is already assigned.
- Remove `needs/triage` once the PR is labeled.
- Remove `needs/kind`, `needs/size`, `needs/priority` if they were present — those are now satisfied.

## Skip conditions

Skip the PR entirely if:
- It already has a `kind/*` label
- It is a draft PR

## Comment template

After labeling, leave a comment summarizing the triage:

```markdown
### 🔍 PR Triaged

| | |
|---|---|
| **Kind** | {kind_label} |
| **Size** | {size_label} ({lines_changed} lines) |
| **Priority** | {priority_label} |

**Reasoning**: {2–3 sentences covering: what type of change this is, why this size classification, and what drove the priority assessment}

<details>
<summary>Triage details</summary>

- **Files changed**: {file_count} ({list key paths or patterns}
- **Key signals**: {terms or patterns from title/description/files that drove classification}
- **Confidence**: {High / Medium / Low}

</details>

> Triage run: [#{run_id}](https://github.com/${{ github.repository }}/actions/runs/{run_id})
```
