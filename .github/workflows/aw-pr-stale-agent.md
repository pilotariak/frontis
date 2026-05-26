---
name: "Agent / PR Stale"
timeout-minutes: 30
strict: true
on:
  schedule: weekly on monday
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
      - lifecycle/stale
      - lifecycle/rotten
      - status/abandoned
  remove-labels:
    allowed:
      - lifecycle/stale
      - lifecycle/rotten
      - lifecycle/active
      - lifecycle/waiting
      - needs/triage
  add-comment:
    max: 30
  close-pull-request:
    target: "*"
    max: 20
---

# PR Stale Agent

List all open pull requests in ${{ github.repository }} with `updatedAt` older than 30 days.

## Exemptions — skip immediately

Skip any PR that carries one of these labels (do not label, comment, or close it):
- `lifecycle/frozen`
- `status/blocked`
- `status/on_hold`

## Classification — evaluate A → B → C → D, stop at first match

### Category A — Superseded

Close if any of:
- Another PR modifying at least one of the same files was merged into the base branch after this PR was created
- Title/description contains "replaced by", "superseded by", or "closes #N" where issue #N is already closed
- A PR with at least 70% overlapping title words was merged after this PR was opened

**Action**: close + add `status/abandoned` + remove `lifecycle/stale` if present.

**Comment**:
```
🔄 Closing this PR as it appears to be superseded by work that has already been merged.

If this is incorrect and the work is still needed, please reopen or open a new PR referencing this one.

*Automated by PR Stale workflow — Run ${{ github.run_id }}*
```

### Category B — Inactive Draft

Close if:
- `isDraft` is `true`
- `updatedAt` older than 30 days

**Action**: close + add `status/abandoned` + remove `lifecycle/stale` if present.

**Comment**:
```
🧹 Closing this draft PR due to 30+ days of inactivity.

This is not a rejection — feel free to reopen when work resumes, or add `lifecycle/frozen` to prevent future automated closure.

*Automated by PR Stale workflow — Run ${{ github.run_id }}*
```

### Category C — Dependabot Conflict

Close if:
- Author is `dependabot[bot]`
- `mergeable` is `CONFLICTING` OR a newer Dependabot PR for the same dependency is open or merged

**Action**: close + add `status/abandoned`.

**Comment**:
```
🤖 Closing this Dependabot PR — it has a merge conflict or has been superseded by a newer update for the same dependency.

*Automated by PR Stale workflow — Run ${{ github.run_id }}*
```

### Category D — Long-Running Open PR (warn only, never close)

Warn if:
- Does not match A, B, or C
- Not a draft
- No new commits, reviews, or comments in 30+ days

**If already has `lifecycle/rotten`**: close + add `status/abandoned` (it was warned twice — now close).

**If already has `lifecycle/stale`**: upgrade to `lifecycle/rotten`, remove `lifecycle/stale`.

**Comment on rotten upgrade**:
```
⚠️ This PR has now been stale for 60+ days with no activity and will be closed on the next scheduled run.

To keep it open, add `lifecycle/frozen` or push a new commit.

*Automated by PR Stale workflow — Run ${{ github.run_id }}*
```

**If no stale label yet**: add `lifecycle/stale`.

**Comment on first warning**:
```
⏰ This PR has been open without activity for 30+ days.

**To prevent future automated closure:**
- Push a new commit or leave a comment to show work is continuing
- Add `lifecycle/frozen` to exempt this PR from automated cleanup
- Close it yourself if it is no longer relevant

*Automated by PR Stale workflow — Run ${{ github.run_id }}*
```

**Do NOT close Category D on first or second warning — human review required.**

## Processing order

1. Process Categories A, B, C first (closures)
2. Then Category D (warnings and rotten closures)
3. Prioritize oldest `updatedAt` first if safe-output limits are reached
