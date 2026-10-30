---
name: pr-cairn
description: Use when writing a PR body for this repo. Carries the cairn PR body contract (four required sections from .github/PULL_REQUEST_TEMPLATE.md, checked by the pr-evidence CI gate) and replaces the global show-me template (Summary/Evidence/Merge Danger), which fails the gate here.
---

# pr-cairn — writing a PR body in cairn

The body is a hard contract, not a style suggestion: the `pr-evidence` CI gate
checks the section names and the links. The global `pr` skill (Humanlayer
show-me: `## Summary` / `## Evidence` / `## Merge
Danger`) does not pass this repo's gate — four lanes in one day each followed
it, failed, and hand-rewrote the body (#1100, #1103, #1105, #1111; issue
#1110). When writing a PR body in this repo, follow this skill; do not use
the global template even if it also matches.

## Body contract

Start from `.github/PULL_REQUEST_TEMPLATE.md`. Write in English for a reader
who did not watch the work. Use this order:

1. `## Proof`: for UI, a before / after / unchanged screenshot table with one
   value line under each image, as in t3code #27472. For backend changes, one
   line naming the test that fails on main, quoting its failure text, and
   stating that it passes here. End with one `Not verified:` line naming
   checks not run or unrelated failures on main.
2. `## What`: one line explaining the change, why, and any existing ticket or known overlap.
3. `<details><summary>Review and risk</summary>` containing `## Review` and
   `## Risk`, separated from the HTML tags by blank lines and closed with
   `</details>`. Keep this block collapsed.

For code changes, use one review round. A fresh, other-vendor independent
review is required only for protected or security paths; docs-only changes
need no code review. After three rounds, rethink or hand the PR to ian.
Review records the review performed, its verdict and unfixed findings with
reasons; when independent review is required, include vendor, model, fresh
context and reviewed head SHA. Risk states one-way or two-way
door, blast radius and whether the owner must merge. Put longer overlap
results and optional Upstream analysis inside the details block. Include
Upstream only when adding a mechanism; name an existing equivalent or the
checkable reason for rejecting it.

The gate allows at most 600 visible characters of prose outside Markdown
tables, image embeds, fenced code, inline code spans, HTML comments and
complete details blocks. It counts heading text and link labels, spaces
within lines, and decoded HTML entities; formatting and whitespace between
lines do not count. Over the limit, it reports
`too-long: <n> characters of prose outside tables, images, code and details (limit 600)`.
Keep Proof and What short; put supporting output in tables or code blocks.
A section containing only fenced code or HTML comments is unanswered.

A legacy `## Verified` aliases Proof. The complete legacy six-section shape
(What, Verified, Upstream, Risk, Acceptance and Issues, with an answered
Upstream and an Acceptance task) may omit Review and is exempt from the cap.
Use the new shape for new bodies. Any unchecked task outside fenced code and
HTML comments still makes the task gate red, including inside details.
Closing keywords belong in commit messages. For a multi-segment ticket,
only the closing segment's commit message carries the parent closing keyword.

## Screenshots

Store images on `pr-assets/<pr-number>`, created from main or as an orphan.
Use a separate checkout so the implementation branch stays on its own work.
For a new branch from main, the commands in that checkout are:

```sh
git switch -c pr-assets/123 origin/main
mkdir -p docs/verify/2206
cp /tmp/before.png /tmp/after.png /tmp/unchanged.png docs/verify/2206/
git add docs/verify/2206/before.png docs/verify/2206/after.png docs/verify/2206/unchanged.png
git commit -m "docs(2206): add PR screenshots (#123)"
git push origin HEAD
git rev-parse HEAD
```

Substitute the actual PR and ticket numbers. Stage only the images. Embed
links using the pushed asset commit's full SHA:

```markdown
| Before | After | Unchanged |
| --- | --- | --- |
| ![Before](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/2206/before.png)<br>Value: 0 items | ![After](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/2206/after.png)<br>Value: 1 item | ![Unchanged](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/2206/unchanged.png)<br>Value: 2 items |
```

Use the side-branch commit SHA, never the implementation head or a branch
name. Push before linking and never merge the asset branch. Keep the branch
so the images remain reachable. Images belong outside code fences.

## Mechanics

- Small changes need no issue or overlap lookup. Reuse an existing issue or PR for the same ask; record known overlaps under What or inside details.

- Write the body to a temp file; never inline multi-line markdown as
  `--body`.
- Create from a worktree lane:
  `gh pr create --repo xiechimon/cairn --head xiechimon:<branch> --body-file /tmp/pr.md`.
- Run both gates locally before opening:
  `python3 scripts/pr-evidence-gate.py /tmp/pr.md` — exit 1 names each
  problem (`missing-section` / `empty-section` / `too-long` / `not-embedded` /
  `unreachable`); then `python3 scripts/pr-tasks-gate.py /tmp/pr.md` —
  exit 1 names `unchecked-task` (a task still open anywhere in the body,
  with its line number). A body with no tasks passes.
  A section whose only content is a fenced block counts as empty: put at
  least one prose line above the fence (#1785).
- Editing an open PR: `gh pr edit` breaks on Projects-classic GraphQL
  errors; use `gh api -X PATCH repos/xiechimon/cairn/pulls/<n> -F
  body=@/tmp/pr.md`, then re-read with `gh pr view <n> --json body` and
  compare.
- Read the stored body back after creating or editing the PR to check the full SHA-pinned image embeds.
- After opening a PR and after each push, read `mergeable_state` once
  (`gh api repos/xiechimon/cairn/pulls/<n> -q .mergeable_state`). A `dirty`
  PR runs no `pull_request` workflows, so no CI event ever arrives to say
  so; merge `origin/main` in and push (#1785 sat conflicted for 15 minutes).
- Image links must be the embedded `![label](url)` form and must not sit
  inside fenced code blocks — a link in a fence renders nowhere.
- Bodies are in English, with no Chinese mixed in. Quote a Chinese UI label
  or file path in backticks. The pr-evidence check runs
  `node scripts/english-only-gate.mjs --text <body>` and reds otherwise;
  run it locally on `/tmp/pr.md` before opening.
- Never add the `needs-decision` label to a PR. Agents decide by their own recommendation, say what they chose and why in chat, and continue; decisions routed to ian follow `AGENTS.md`, "Merge routes". Before asking ian about a PR whose auto-merge is armed, disarm it with `gh pr merge <n> --disable-auto`.
- Before an agent enables merge, require passing CI checks and a pr-gate verdict of go with `mergedBy: 'auto-merge'` (`AGENTS.md`, "Merge routes"; protected-path PRs and every other route go to ian), with no unchecked tasks anywhere in the body. ian may admin-merge; agents may not use that authority.
- Read the PR opener and every commit author: `gh pr view <n> --json author,commits`. Follow `docs/ops/agent-bot-identity.md` for the identity checks.
- Bot-opened PRs require exactly one commit authored by `Cairnwright` before a rebase merge. Use the dispatcher's `~/.cairn/tools/merge-pr.sh`; inspect its source and usage on the dispatch host before invoking it. If the helper is unavailable or the commit identity is wrong, stop and return the PR to the dispatcher.
- Human-opened PRs use `gh pr merge <n> --squash --auto` after verifying their commits contain no `cairnwright[bot]` author. After a merge, read the main commit author and the `commit-author` Actions result.
- Prepare commits outside the App token wrapper, following `docs/ops/agent-bot-identity.md`. Verify that neither the author name nor email of any prepared commit contains `cairnwright[bot]` before pushing.
- If main's author check fails, follow the recovery procedure in `docs/ops/agent-bot-identity.md`. Preserve main history. A subsequent compliant push checks its own `BEFORE_SHA..HEAD` range; verify the actual main commit author and Actions result after merging.

## Gate facts — what is actually enforced

| requirement | enforced by |
|---|---|
| `## Proof`, `## What`, `## Review`, `## Risk` answered, including headings inside details (legacy `## Verified` aliases Proof; Upstream is optional) | pr-evidence (required check) |
| at most 600 visible prose characters outside tables, images, code, comments and details; complete legacy six-section bodies exempt | pr-evidence (required check) |
| image links embedded + HTTP 200 | pr-evidence (required check) |
| no unchecked tasks anywhere outside fenced code and HTML comments; no tasks required | pr-evidence (required check, pr-tasks step) |
| body is English (Chinese only inside backticks or fences) | pr-evidence (required check, language step) |
