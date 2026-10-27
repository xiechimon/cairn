# ADR 0007 · Merge gate switches to GitHub native auto-merge

> Status: **Decided and in effect** (2026-10-01). D4 was flipped to `strict: true` on 2026-10-16; see "Amendment · 2026-10-16" at the end.
> Source: during the parallel-lane period, agents ran a 20-second-polling sentinel to grab the CLEAN window. The sentinel has two fatal flaws — every state transition wakes the model (one full turn), and background monitors have a lifetime (default 5 minutes, cap 30 minutes); once CI outruns the monitor window the sentinel silently dies and nobody takes over the PR.

## Problem Statement

Multiple lanes open PRs in parallel; who watches the "first green merges first" wait? Before this there was no auto-merge capability: the practice was an agent starting a background script that ran `gh pr view` every 20 seconds, printing a line and waking the model on every state-letter change. The cost: one full model turn burned per state transition; and the monitor dies when its time is up, leaving a long CI uncovered afterwards.

Native auto-merge hands the whole segment to GitHub: attach `--auto` when opening the PR, and once CI turns green the platform merges by itself — it keeps working even if the session dies, at zero token cost. The previous blockers were that the repo-level setting was off and main had no required checks — and auto-merge waits exactly for required checks.

## Recon facts (measured 2026-10-01)

| # | Fact | Source |
|---|---|---|
| F1 | The repo had `allow_auto_merge: false` — `gh pr merge --auto` was rejected outright | `gh api repos/xiechimon/pacman` |
| F2 | main had **no branch protection**: GET protection returned 404 "Branch not protected"; not a single required check was set | `gh api repos/xiechimon/pacman/branches/main/protection` |
| F3 | CI has a single workflow with two jobs: `check` / `pack-smoke`. `pull_request:` triggers unconditionally (any lane branch opening a PR gets CI); `push` covers only `main` and `prototype/**` | `.github/workflows/ci.yml` |
| F4 | **Enabling auto-merge without protection = dangerous**: what auto-merge waits for is required checks; when the required list is empty, the branch merges as soon as it is mergeable — i.e. before CI finishes. Therefore D1 must land in the same batch as D2 | GitHub documented behavior, not separately measured for this ADR (guardrails in the Premortem) |
| F5 | There exist PRs "with commits pushed but no CI run": #577 head `9b62d567` had zero check-runs and zero workflow runs | `gh api .../commits/9b62d567/check-runs`, `.../actions/runs?head_sha=` |

## Decision

| ID | Decision |
|---|---|
| **D1** | Enable `allow_auto_merge = true` on the repo |
| **D2** | Add a protection rule on main: required checks = `check` + `pack-smoke`; `strict: false`; `enforce_admins: false`; reviews not required. Check names are taken verbatim from the check-runs API, not by eye |
| **D3** | Process convention: after opening a PR, immediately `gh pr merge <n> --squash --auto`, replacing the polling sentinel. Do not close the corresponding lane before the PR merges |
| **D4** | `strict: false` is deliberate: `strict: true` (require the branch to be up-to-date first) invalidates every other PR on each merge under many lanes, forcing proactive rebases — and rebasing after a push can only be done via force-push, which is doubly banned by repo rules and hooks. Better to let GitHub merge serially in arrival order |
| **D5** | `enforce_admins: false` is also deliberate: it preserves the owner's ability to push main directly and to merge early by hand; the protection rule must not become a lock that locks ourselves out |
| **D6** | The protection rule contains only required checks and **not** "PR required first" — the existing ability to push main directly is untouched |

## Read-back verification (read the authoritative store right after changing, not "the file was written")

| Item | Read-back value | Source |
|---|---|---|
| Repo auto-merge | `allow_auto_merge: true` | `gh api repos/xiechimon/pacman` |
| main required checks | `["check", "pack-smoke"]` | `gh api repos/xiechimon/pacman/branches/main/protection` |
| strict | `false` | same as above |
| enforce_admins | `false` | same as above |
| Review required | not required | same as above |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Required check names mistyped** → all PRs wait forever in "waiting for status" | Names taken from the actual output of `commits/<sha>/check-runs` (`check`, `pack-smoke`); after setting the rule, read back `required_status_checks.contexts` and compare verbatim |
| **PRs whose head has no CI run wait forever** (F5 measured to exist) | Pushing any commit triggers CI; `enforce_admins: false` guarantees a manual merge as backstop. The two F5 cases (#577 / #580) were themselves CONFLICTING and needed a rebase-repush anyway |
| **Base moves and conflicts → auto-merge silently stalls** | auto-merge does not resolve conflicts, it only waits for green. On conflict the PR turns DIRTY and no longer advances automatically; a human rebase is needed — such events still need a human; what auto-merge eliminates is "waiting for green", not "watching for conflicts" |

## Amendment · 2026-10-16: D4 flipped to `strict: true`

### Triggering event

#1368's CI ran at 04:17, when main's `apps/web/src/detail/composer.tsx` had 9 arbitrary spacing values. At 04:51 #1367 merged, adding a 10th (`pb-[48px]`). At 06:24 #1368 merged on the stale 04:17 green and simultaneously froze that file's baseline at 9. The merge result main `f7eb56a8` had `check` red (ui-debt-gate: 320 > 319). #1369 (CI 04:19) then also merged on a stale green (`9ced1c1a`), after which every PR's `check` inherited that red (#1370). `strict: false` allowed merging on a stale green — this was the direct pass-through point.

### Re-examining D4's premise

D4's premise "up-to-date can only mean rebase + force-push" does not hold. `gh api -X PUT repos/xiechimon/pacman/pulls/<n>/update-branch` (and, once D7 is enabled, the Update branch button on the PR page) merges main into the PR branch; the new head triggers CI, history is not rewritten, no force-push needed.

### Decision

| ID | Decision |
|---|---|
| **D4′** | main's required checks change to `strict: true`: a PR branch must contain main's latest commits before it can merge. Replaces D4 |
| **D7** | Enable `allow_update_branch: true` on the repo |

Cost (accepted): merge queue is only available on organization repos; this repo belongs to a personal account, so it cannot be used. Every merged PR turns the other open PRs BEHIND, auto-merge stalls until someone runs update-branch and passes one more CI round (`check` measured ~5–6 minutes). At the daily merge pace of 12 / 22 merges on 10-14 / 10-15, many lanes queue up serially.

Process: when a PR shows BEHIND, run update-branch. `gh run rerun` reuses the old merge ref and does not solve BEHIND.

### Read-back verification (2026-10-16)

| Item | Read-back value | Source |
|---|---|---|
| strict | `true` | `gh api repos/xiechimon/pacman/branches/main/protection` |
| main required checks | `["check", "pack-smoke", "e2e-gate"]` | same as above |
| enforce_admins | `false` | same as above |
| Repo update branch | `allow_update_branch: true` | `gh api repos/xiechimon/pacman` |
| Repo auto-merge | `allow_auto_merge: true` | same as above |

### Amendment (2026-10-21, after #1435)

#1435 was auto-merged before the user's decision landed: the lane attached `--auto` per D3 right at PR open, the orchestrator checked the two empty Acceptance boxes green before asking the user whether the wording was acceptable, and GitHub merged the moment `check` turned green. At that time `pr-evidence` was not in the required checks, and the PR had no machine-readable "human decision pending" state. Three changes:

| Item | After the change | Source |
|---|---|---|
| main required checks | `["check", "pack-smoke", "e2e-gate", "pr-evidence"]`, all four pinned to the GitHub Actions app (`app_id` 15368, so no write-permissioned party can fake them with a commit status) | `gh api repos/xiechimon/pacman/branches/main/protection/required_status_checks` |
| Decision state | Label `needs-decision`: `pr-evidence` goes red when it sees the label; while the label is on, every run disarms auto-merge (triggers include `labeled` / `unlabeled` / `auto_merge_enabled`); the workflow adds the label itself when Acceptance has unchecked items. Removing the label is a human action | `.github/workflows/pr-evidence.yml` |
| D3's premise | Before asking the user anything: `gh pr merge <n> --disable-auto` first, then add the label, then ask; once the decision lands, re-arm `--auto`. An agent may only remove the label with `PACMAN_DECIDED=1`; `gh pr merge --admin` is no way out (blocked by the local PreToolUse hook) | `AGENTS.md` "Issues and PRs" |

`enforce_admins` is unchanged: it only blocks the bypass button on the web UI and merges with `--admin`, and the agent side is already blocked by the hook; whether to also close the human bypass is a separate discussion.

### Premortem

| Failure mode | Guardrail |
|---|---|
| BEHIND PRs get no update and auto-merge stalls forever | Lane wrap-up and Auto-fix events check `mergeStateStatus`; when BEHIND, run update-branch |
| Queue gets too long at high merge frequency | Two-way gate: `gh api -X PATCH repos/xiechimon/pacman/branches/main/protection/required_status_checks -F strict=false` returns to D4 |
