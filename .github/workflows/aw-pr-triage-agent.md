# PR Triage Agent

Automates classification of open PRs using the project label taxonomy from `settings.yml`: assigns `kind/*`, `size/*`, and `priority/*` labels; clears `needs/triage`.

## Label Taxonomy

### Kind labels — PR category

| Label                | When to apply                                                  |
| -------------------- | -------------------------------------------------------------- |
| `kind/bug`           | Fixes a defect, error, or regression                           |
| `kind/feature`       | Adds new capability or significant enhancement                 |
| `kind/documentation` | Changes only to docs, `.md`, `.rst`, or doc site files         |
| `kind/cleanup`       | Refactoring, tech debt, dead code removal (no behavior change) |
| `kind/deprecation`   | Removes or marks a feature as end-of-life                      |

File pattern hints:

- `*.md`, `docs/**`, `*.rst` → `kind/documentation`
- `*_test.*`, `*.test.*`, `tests/**` paired with source → `kind/bug` or `kind/feature`
- Build/CI only (`.github/**`, `Makefile`, `go.mod`) → `kind/cleanup` or `kind/feature`

### Size labels — PR scope

Based on total lines changed (additions + deletions):

| Label     | Range           |
| --------- | --------------- |
| `size/xs` | < 10 lines      |
| `size/s`  | 10 – 49 lines   |
| `size/m`  | 50 – 249 lines  |
| `size/l`  | 250 – 499 lines |
| `size/xl` | ≥ 500 lines     |

### Priority labels — urgency

| Label               | When to apply                                      |
| ------------------- | -------------------------------------------------- |
| `priority/critical` | Security fix, data loss, broken core functionality |
| `priority/high`     | Significant regression or user-facing breakage     |
| `priority/medium`   | Notable improvement, non-blocking                  |
| `priority/low`      | Minor fix; workaround exists                       |
| `priority/backlog`  | Valid but no urgency                               |

### Needs labels — triage markers (removed after triage)

| Label            | Action                                                     |
| ---------------- | ---------------------------------------------------------- |
| `needs/triage`   | Removed once `kind/*`, `size/*`, `priority/*` are assigned |
| `needs/kind`     | Removed once `kind/*` assigned                             |
| `needs/size`     | Removed once `size/*` assigned                             |
| `needs/priority` | Removed once `priority/*` assigned                         |

### Status labels — set during triage

| Label                  | When                     |
| ---------------------- | ------------------------ |
| `status/review_needed` | No reviewer assigned yet |

## What Gets Generated

File: `.github/workflows/pr-triage-agent.md`
Template: `$CLAUDE_PLUGIN_ROOT/skills/agentic-workflows/assets/pr-triage-agent.md`

The template uses `name: "Agent / PR Triage"` — see the naming convention in SKILL.md.

## Workflow

### Step 1: Gather requirements

Ask the user:

1. **Trigger** — scheduled every 6 hours on weekdays (default) or `workflow_dispatch` only?
2. **Draft PRs** — skip drafts? (default: yes — draft PRs are explicitly excluded)
3. **Comment on PRs** — leave a triage summary comment? (default: yes)
4. **Target directory** — path to the repository

### Step 2: Generate the workflow file

Copy `assets/pr-triage-agent.md` to `<target>/.github/workflows/pr-triage-agent.md`.

Adapt based on user answers:

| User choice              | Change                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| `workflow_dispatch` only | Remove the `schedule:` line                                                      |
| Include draft PRs        | Remove the skip-drafts condition from instructions                               |
| No comments              | Remove `add-comment: {}` from `safe-outputs` and comment block from instructions |

### Step 3: Verify gh-aw installation

```bash
gh extension list | grep gh-aw
# if missing:
gh extension install github/gh-aw
gh aw validate .github/workflows/pr-triage-agent.md
```

### Step 4: Test

```bash
gh aw run .github/workflows/pr-triage-agent.md
```

## Differences from the gh-aw upstream

The upstream gh-aw pr-triage-agent targets agent-created PRs specifically and uses dynamic `pr-type:*` / `pr-risk:*` / `pr-priority:*` label namespaces.

This version:

- Applies to **all open PRs** (not only bot-authored)
- Uses the **existing `settings.yml` taxonomy** (`kind/*`, `size/*`, `priority/*`) — no new label namespaces
- Omits repo-memory and batch processing (simpler, lower token cost per run)
- Focuses on label application + a concise comment rather than a full report issue

Upstream features to consider adding later:

- `repo-memory` for cross-run trending and PR age tracking
- Batch grouping (`pr-batch:*` labels) for similar PRs
- Triage report issue generation (Phase 8 in upstream)

## Customization

### Auto-apply `needs/triage` on PR open

```yaml
# .github/workflows/label-new-prs.yml
name: Label new PRs
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
jobs:
  label:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            if (!context.payload.pull_request.draft) {
              github.rest.issues.addLabels({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.payload.pull_request.number,
                labels: ['needs/triage']
              })
            }
```

### Add size auto-labeler (alternative)

[github/labeler](https://github.com/actions/labeler) can apply `size/*` labels using glob patterns. Use it instead of the agent for size labeling to save tokens — let the triage agent focus only on `kind/*` and `priority/*`.
