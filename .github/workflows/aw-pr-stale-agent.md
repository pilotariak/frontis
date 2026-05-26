# PR Stale Agent

Triages and closes pull requests stale for 30+ days using the project `lifecycle/*` and `status/*` label taxonomy.

## Label Taxonomy

### Lifecycle labels — stale progression

| Label              | Meaning                                             |
| ------------------ | --------------------------------------------------- |
| `lifecycle/active` | Actively being worked on — used as exemption signal |
| `lifecycle/frozen` | Exempted from automated closure                     |
| `lifecycle/stale`  | First warning: no activity for 30+ days             |
| `lifecycle/rotten` | Second warning: stale 60+ days; will close next run |

### Status labels — final state

| Label              | When applied           |
| ------------------ | ---------------------- |
| `status/abandoned` | PR closed by the agent |

### Exemption labels — skip entirely

Any PR with one of these labels is skipped (no action, no comment):

- `lifecycle/frozen`
- `status/blocked`
- `status/on_hold`

## Three-Phase Lifecycle

```
Day 0      → PR opened
Day 30     → lifecycle/stale applied  (Category D, first warning)
Day 60     → lifecycle/rotten applied (Category D, rotten upgrade)
Next run   → closed + status/abandoned (Category D, rotten close)
```

Categories A, B, C bypass the warning phases and close immediately.

## PR Categories

| Category                    | Condition                                                              | Action                |
| --------------------------- | ---------------------------------------------------------------------- | --------------------- |
| **A — Superseded**          | Merged PR overlaps same files, or title/description says "replaced by" | Close immediately     |
| **B — Inactive Draft**      | `isDraft = true` + 30+ days no activity                                | Close immediately     |
| **C — Dependabot Conflict** | `author = dependabot[bot]` + conflict or newer PR for same dep         | Close immediately     |
| **D — Long-Running**        | Human PR, not draft, 30+ days no activity                              | Warn → rotten → close |

## What Gets Generated

File: `.github/workflows/pr-stale-agent.md`
Template: `$CLAUDE_PLUGIN_ROOT/skills/agentic-workflows/assets/pr-stale-agent.md`

The template uses `name: "Agent / PR Stale"` — see the naming convention in SKILL.md.

## Workflow

### Step 1: Gather requirements

Ask the user:

1. **Staleness threshold** — default 30 days. Adjust if the team has longer review cycles.
2. **Additional exemption labels** — any project-specific labels that should block automated closure?
3. **Draft PR threshold** — same 30 days, or different for drafts?
4. **Target directory** — path to the repository

### Step 2: Generate the workflow file

Copy `assets/pr-stale-agent.md` to `<target>/.github/workflows/pr-stale-agent.md`.

Adapt based on user answers:

| User choice              | Change                                                   |
| ------------------------ | -------------------------------------------------------- |
| Different threshold      | Update "30 days" references in the instructions body     |
| Extra exemption labels   | Add them to the "Exemptions" section in the instructions |
| `workflow_dispatch` only | Remove `schedule:` line                                  |

### Step 3: Verify gh-aw installation

```bash
gh extension list | grep gh-aw
# if missing:
gh extension install github/gh-aw
gh aw validate .github/workflows/pr-stale-agent.md
```

### Step 4: Test (dry run)

Run with `--dry-run` if supported, or trigger `workflow_dispatch` and review comments before the next scheduled run closes anything:

```bash
gh aw run .github/workflows/pr-stale-agent.md
```

## Differences from the gh-aw upstream

The upstream `stale-pr-cleanup.md` uses ad-hoc labels (`keep-open`, `stale`, `stale-draft`, `stale-dependabot`, `superseded`).

This version maps to the existing `settings.yml` taxonomy:

| Upstream label                     | This version                            |
| ---------------------------------- | --------------------------------------- |
| `keep-open`                        | `lifecycle/frozen`                      |
| `stale`                            | `lifecycle/stale`                       |
| `stale-draft` / `stale-dependabot` | `lifecycle/rotten` → `status/abandoned` |
| `superseded`                       | `status/abandoned`                      |

The two-run warning cycle (`lifecycle/stale` → `lifecycle/rotten` → close) is made explicit as a three-phase lifecycle, matching the intent already encoded in `settings.yml`.

## Customization

### Pair with auto-labeler on PR open

Apply `lifecycle/waiting` on new PRs to mark them as needing a contributor:

```yaml
# .github/workflows/label-new-prs.yml
- labels: ["lifecycle/waiting", "needs/triage"]
```

The stale agent will later transition `lifecycle/waiting` → `lifecycle/stale` when activity stops.

### Adjust close-pull-request limits

The template allows up to 20 closures per run. For repositories with large backlogs, increase `max` in `safe-outputs.close-pull-request` and raise `timeout-minutes` proportionally.
