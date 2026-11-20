# PR review scorecard (#1080)

> The form is borrowed from pi's `.pi/prompts/pr.md` (a version-controlled fixed six-section scorecard + five-step process). The author-side standard already lives in `.github/PULL_REQUEST_TEMPLATE.md` (the template's four required sections: What / Proof / Review / Risk, with optional Upstream) and `scripts/pr-evidence-gate.py` (the form gate) — what this file adds is **the written standard for reviewers**: what to read in what order when reviewing a PR in this repo, and what shape the output takes. It is a basis for judgment, not a mechanically decidable gate; mechanical checks belong to CI, see "Mechanical checks are not the reviewer's job" below.

## Five-step process (execute in order; skipping a step means reviewing blind)

Independent review follows `AGENTS.md`, "Code Review Rules": another agent in a separate, read-only context, with no requirement to change models. The read-only boundary and current-head evidence still apply.

1. **Claim the review**: say in chat which PR you are reviewing before you start, so two reviewers do not duplicate work.
2. **Read everything**: the PR body, all comments, all commits, all changed files — not one missing before you start writing the review.
3. **Read the linked issues**: the full text (including comments) of every issue referenced in the body / comments / commit messages / cross-links. Understand "what is being asked for" before judging "is what is given that thing".
4. **Read the diff without switching branches**: use only `gh pr view` / `gh pr diff` / `gh api` / `git show <ref>:<path>` (after fetch); if you need a PR file's contents, write it to a one-off file and read that. **Never `gh pr checkout`, never `git switch`** — this repo runs many lanes in parallel for the long term, each building in its own worktree; the moment a reviewer checks out, the worktree jumps onto someone else's branch and smashes the construction site; reviewing is a read-only action and changes no working-tree state.
   - Code files touched by the diff are read **in full** (no truncation) before being compared against the diff; code paths the diff does not touch but that verifying the behavior requires (callers, the other end of an interface, shared surfaces) are read as well.
5. **Check whether docs need to stay in sync**: when existing behavior changed or a new mechanism was added, check whether document surfaces like `docs/spec/` (layering responsibilities, acceptance criteria), `.claude/skills/verify-cairn/feature-map.json` (the feature registry: entry points, research and design links; a new route or page needs a row), `apps/web/src/components/ui/INVENTORY.md`, and `.claude/skills/verify-cairn/SKILL.md` should change with it. Record gaps under `Bad` or `Tests`; do not fix them for the author on the spot.

## Six-section scorecard (fixed output form)

For each reviewed PR, output six sections with fixed names:

| Section | Content |
|---|---|
| **What it does** | One short paragraph: what this change does and what its intent is |
| **Good** | Choices or improvements that hold up |
| **Bad** | Concrete problems: regressions, missing tests, risks |
| **Ugly** | Hidden or high-impact problems |
| **Tests** | What is covered, what is missing, whether existing tests are enough |
| **Open questions** | Only things that **block the merge decision and need the user to decide** |

Output format (one block per PR):

```
PR: <url>
What it does:
- ...
Good:
- ...
Bad:
- ...
Ugly:
- ...
Tests:
- ...
Open questions:
- ...
```

Three hard rules:

- **If Bad / Ugly find nothing after checking, say so explicitly in that section** — "no issues found (checked X / Y surfaces)" — that is a conclusion, not filler; the forbidden form is a bare heading with a perfunctory "none".
- **If there are no Open questions, omit the whole section**, heading included. General problems found in review belong in Bad / Ugly. Follow `AGENTS.md`, "Merge routes": decide by recommendation and explain it in chat. For a decision routed to ian, keep the PR a draft, disarm its auto-merge (`gh pr merge <PR> --disable-auto`) and ask in chat.
- All six sections carry real entries; a section you cannot fill with a real entry is not written.

The review verdict lands as a **PR comment** (`gh pr comment`; write long content to a one-off file and use `--body-file`), not by editing the PR body — the body is the author's evidence surface, and the review does not change it.

## Merge method and commit identity

Every PR merges by squash, whoever opened it. A squash commit is authored by the PR opener, so an App-opened PR lands on main as `cairnwright[bot]` and an ian-opened PR as ian. Inside the PR, every commit on a branch of this repository is authored by `cairnwright[bot]` or by ian, and a fork PR carries neither identity; the `commit-author` check enforces this from `packages/shared/commit-identity.json`, and `docs/ops/agent-bot-identity.md` explains the identity.

## Mechanical checks are not the reviewer's job (do not be a CI parrot)

lint / typecheck / spec:parse / vitest / e2e are covered by the CI `check`, `pack-smoke` and `e2e-gate` jobs. The reviewer spends judgment where machines cannot see:

- **Semantic conflicts**: two parallel PRs each change the same thing and each runs green (git merges cleanly, typecheck exposes it late or not at all) — compare against open PRs in flight and check `gh pr diff --name-only` for file collisions.
- **Seam discipline**: whether dependencies locked by `biome.json`'s `noRestrictedImports` are being reached around the thin bridge modules (`apps/daemon/src/backend/` is the GitOps / MCP / LLM provider seam).
- **Snapshot surfaces**: when the wire schema in `packages/shared` changes, whether `snapshot.test.ts` was updated in sync (a changed JSON projection with no snapshot update = guaranteed CI red).
- **Closing-tag discipline**: judge whether a change that says `Closes #N` really finishes ticket N, and whether a segment **mistakenly carries** the whole ticket's `Closes #N` instead of `Part of #N`.
- **Evidence quality**: check that the stated verification demonstrates the requested behavior; a checked box alone is not proof. No review is required before a change lands (`AGENTS.md`, "Ship").
