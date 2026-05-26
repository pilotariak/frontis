# Issue Triage Agent

Automates classification of new/unlabeled GitHub issues using the project label taxonomy from `settings.yml`.

## Label Taxonomy

### Kind labels — primary triage target

| Label                | When to apply                                 |
| -------------------- | --------------------------------------------- |
| `kind/bug`           | Problem, error, or unexpected behavior        |
| `kind/feature`       | New capability or feature request             |
| `kind/documentation` | Missing, wrong, or unclear docs               |
| `kind/question`      | Asking for clarification or information       |
| `kind/discussion`    | General feedback, RFC, or open-ended proposal |
| `kind/support`       | User needs help operating the project         |
| `kind/cleanup`       | Technical debt, refactoring, code quality     |
| `kind/deprecation`   | Request to remove or mark deprecated          |

Disambiguation:

- `kind/support` vs `kind/question`: author hitting friction using the software → `kind/support`; asking about design intent → `kind/question`
- `kind/feature` vs `kind/discussion`: concrete actionable request → `kind/feature`; exploratory/needs design → `kind/discussion`

### Needs labels — triage markers

| Label            | Meaning                                                     |
| ---------------- | ----------------------------------------------------------- |
| `needs/triage`   | Not yet triaged — added on issue open, removed after triage |
| `needs/priority` | No `priority/*` label assigned                              |

### Status labels — set during triage

| Label              | When to apply                     |
| ------------------ | --------------------------------- |
| `status/available` | Open, unclaimed, ready to pick up |
| `status/proposal`  | Needs evaluation before action    |

## What Gets Generated

File: `.github/workflows/issue-triage-agent.md`
Template: `$CLAUDE_PLUGIN_ROOT/skills/agentic-workflows/assets/issue-triage-agent.md`

The template uses `name: "Agent / Issue Triage"` — see the naming convention in SKILL.md.

## Workflow

### Step 1: Gather requirements

Ask the user:

1. **Trigger** — scheduled batch (default: weekdays 14:00 UTC) or real-time on issue open?
   - Scheduled: lower noise, processes backlog; use `on: schedule`
   - Real-time: instant feedback; use `on: issues: [opened, reopened]` (extra caution needed — public users control issue content)
2. **Priority labeling** — also assign a `priority/*` label? (default: no; keep scope narrow)
3. **Comment on issues** — leave an explanation comment per issue? (default: yes)
4. **Target directory** — path to the repository

### Step 2: Generate the workflow file

Copy `assets/issue-triage-agent.md` to `<target>/.github/workflows/issue-triage-agent.md`.

Adapt based on user answers:

| User choice         | Change                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Real-time trigger   | Replace `on: schedule` with `on: issues: types: [opened, reopened]`                             |
| Add priority labels | Append `priority/*` to `safe-outputs.add-labels.allowed`; extend agent instructions (see below) |
| No comments         | Remove `add-comment: {}` from `safe-outputs` and the comment block from instructions            |

**Priority labels extension** — add to `safe-outputs.add-labels.allowed`:

```yaml
- priority/critical
- priority/high
- priority/medium
- priority/low
- priority/backlog
```

And add to the agent instructions:

```markdown
3. Assign a `priority/*` label based on impact and urgency:
   - `priority/critical` — data loss, security issue, or broken core functionality
   - `priority/high` — significant pain point affecting many users
   - `priority/medium` — notable issue but workaround exists
   - `priority/low` — minor inconvenience or cosmetic problem
   - `priority/backlog` — valid but no current support to act on it
```

### Step 3: Verify gh-aw installation

```bash
gh extension list | grep gh-aw
# if missing:
gh extension install github/gh-aw
gh aw validate .github/workflows/issue-triage-agent.md
```

### Step 4: Test

```bash
gh aw run .github/workflows/issue-triage-agent.md
```

Or push and trigger `workflow_dispatch` from the GitHub Actions UI.

## Customization

### Auto-apply `needs/triage` on issue open

Separate standard GitHub Actions workflow — runs before the triage agent:

```yaml
# .github/workflows/label-new-issues.yml
name: Label new issues
on:
  issues:
    types: [opened]
jobs:
  label:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: ['needs/triage', 'status/available']
            })
```

Pipeline: new issue → `needs/triage` applied → triage agent runs → removes `needs/triage`, adds `kind/*`.

### Shared imports

For multi-workflow repositories, extract shared guidance into `shared/` and import:

```yaml
imports:
  - shared/reporting.md
```
