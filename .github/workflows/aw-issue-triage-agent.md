---
name: "Agent / Issue Triage"
timeout-minutes: 5
strict: true
on:
  schedule: "0 14 * * 1-5"
  workflow_dispatch:
permissions:
  issues: read
tools:
  github:
    # lockdown mode: prevents prompt injection from untrusted issue authors
    lockdown: true
    toolsets: [issues, labels]
safe-outputs:
  add-labels:
    allowed:
      - kind/bug
      - kind/feature
      - kind/documentation
      - kind/question
      - kind/discussion
      - kind/support
      - kind/cleanup
      - kind/deprecation
      - status/available
      - status/proposal
  remove-labels:
    allowed:
      - needs/triage
  add-comment: {}
---

# Issue Triage Agent

List open issues in ${{ github.repository }} that have the label `needs/triage` or no labels at all.

For each untriaged issue, analyze the title and body, then apply the following actions:

## 1. Assign one `kind/*` label

Choose the single label that best fits the issue:

- `kind/bug` — the author is reporting a problem, error, crash, or incorrect behavior
- `kind/feature` — the author is requesting a new capability or significant enhancement
- `kind/documentation` — the issue is about missing, incorrect, outdated, or unclear documentation
- `kind/question` — the author is asking how something works, seeking clarification, or requesting guidance
- `kind/discussion` — open-ended feedback, RFC, design discussion, or community input that doesn't fit a specific action category
- `kind/support` — the author needs help operating, configuring, or integrating the project
- `kind/cleanup` — internal technical debt, refactoring, dead code removal, or code quality improvement
- `kind/deprecation` — request to deprecate, remove, or mark a feature as end-of-life

When in doubt between `kind/question` and `kind/support`: if the person is trying to use the software and hitting friction, it's `kind/support`; if they're asking about design intent or how something works, it's `kind/question`.

When in doubt between `kind/feature` and `kind/discussion`: if the request is concrete and actionable, it's `kind/feature`; if it's exploratory or needs more design work, it's `kind/discussion`.

## 2. Apply `status/available`

Add `status/available` if:
- The issue has no assignee, or is only assigned to bots

Skip `status/available` if a human maintainer is already assigned.

## 3. Remove `needs/triage`

After assigning a `kind/*` label, remove `needs/triage` to signal the issue has been processed.

## Skip conditions

Skip the issue entirely (do not label, do not comment) if:
- It already has a `kind/*` label
- It is assigned to a non-bot user

## Comment template

After labeling an issue, leave a comment to make the classification transparent to the author:

```markdown
### 🏷️ Issue Triaged

Hi @{author}! I've classified this issue as **{label_name}**.

**Reasoning**: {1–2 sentences explaining which signals in the title/body drove this classification}

<details>
<summary>Triage details</summary>

- **Detected signals**: {key terms or patterns that matched}
- **Confidence**: {High / Medium / Low}

{If confidence is Low, add: "If this label doesn't fit, please update it — more context in the issue body would help."}

</details>

> Triage run: [#{run_id}](https://github.com/${{ github.repository }}/actions/runs/{run_id})
```

Keep the comment concise — use the `<details>` block to keep verbose analysis collapsed by default.
