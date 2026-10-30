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

## Write it plainly

The body is read by someone who did not watch the work. Apply the `unslop`
rules to it, and write like a person reporting what they did.

- No em dashes. Use a period or a comma. Rule 13.
- No AI vocabulary: crucial, delve, robust, seamless, leverage, showcase,
  landscape, testament, tapestry. Use the plain word. Rules 7 and 31.
- No "not just X, but Y", no rule of three, no synonym cycling. Rules 9, 10, 11.
- No bold label followed by a restatement of the label. Write the sentence. Rule 16.
- No chatbot lines, no closing pleasantries. Rules 20, 22.
- No metaphor nouns: substrate, surface, harness, ratchet, primitive, north
  star. Name the thing. Rule 26.
- Sentence case headings. Straight quotes. Rules 17, 19.
- One idea per sentence. If a sentence needs a second read, split it. Rule 28.
- Say what the change does, not how it feels. A number or a symbol beats an
  adjective. Rules 27 and 30.
- Describe the current state only. Do not write that something was removed,
  retired, dropped, or "used to be" something else; the reader never saw the
  old version, so the note is noise. Delete the thing and say what stands now.

The same rules apply to ticket bodies, commit messages, code comments and
lane briefs.

## The four required sections (exact headings)

### `## What`

In two to four sentences, explain what changed and why, the ticket it
answers, and the overlap lookup result. Name files and symbols instead of
describing them.

### `## Proof`

For code, paste both halves verbatim: the command run on the old code with
its actual failing output, then the same command on this change with its
passing output. Include lint, typecheck and relevant e2e results. A claim
that "without this change X would fail" is not evidence.

For UI changes, use a before / after / unchanged screenshot table. Embed
reachable image URLs with `![label](url)`; committing screenshots under
`docs/verify/<ticket>/` is optional, and a committed file needs a SHA-pinned
raw link pushed before the body is written.

Pick the proof by what the change touches. This table follows 56 merged
backend PRs in eight agent-heavy repositories (t3code, background-agents,
opencode, pi, inbox-zero, rakazo, optio, codex; sampled 2026-10-30); a test
that fails on main and passes here was the proof in 24 of them, and no PR
used a standalone curl transcript.

| Change | Proof |
|---|---|
| Logic, data or protocol bug | Name the test, quote its one-line failure on main, show it passing here |
| Concurrency, leases, retries, crash recovery | A test on a real database, or one that kills the process mid-flight, with the symptom on main |
| Database write, migration, query | A real-database test over every migration; the wrong row on main or the fixed row; a plan assertion for query changes |
| Performance | A before / after table with data size, runs and warmup, and whether results are identical |
| Process, daemon, CLI, deploy | A short real-run transcript: the reproduction command with output before and after |
| External provider or model behavior | A live call matrix with numbers before and after, and the targets not covered |
| HTTP endpoint | An integration test asserting status and body; a curl transcript is optional |
| Visible UI | The before / after / unchanged screenshot table above |

End Proof with one `Not verified:` line: what was not run, and tests that
already fail on main for unrelated reasons. "Tests pass", a test count, a CI
link or a bot summary is not proof. Paste the failure text itself; do not
paraphrase it. HTML comments do not count as an answer. A legacy
`## Verified` heading satisfies Proof. A complete legacy six-section body
may omit Review; a body using Proof must include Review.

### `## Review`

Record the reviewer vendor and model, whether the context was fresh, the
reviewed head SHA, number of rounds, verdict, and unfixed findings with
reasons. Review findings still open must be visible here.

### `## Risk`

State whether this is a one-way or two-way door, the blast radius and the
runs that checked it, and whether the owner must merge under pr-gate's
protected-path routing.

### Optional `## Upstream`

Include this only when the PR adds a mechanism. Does an equivalent exist
in the current dependencies (pi / claude-agent-sdk / code already in this
repo)? If an equivalent was rejected, give the checkable reason (security
boundary, different data source, different interaction semantics);
"more controllable" or "fits our model better" do not qualify.

Closing keywords belong only in commit messages. For a multi-segment ticket,
state under What which segment closes it; only that segment's commit message
carries the parent ticket's closing keyword.

No checklist is required. Any unchecked task anywhere in the body outside
fenced code and HTML comments keeps pr-evidence red.

## Mechanics

- Before opening a PR, follow `docs/agent-overlap.md`: search open issues, open PRs, and PRs merged in the last seven days, including PRs touching the changed files. Put the numbered overlap list and disposition under What. Extend an existing PR for the same ask. Explain intentional removal of recently merged work and name its PR for `silent-revert-gate`.

- Write the body to a temp file; never inline multi-line markdown as
  `--body`.
- Create from a worktree lane:
  `gh pr create --repo xiechimon/cairn --head xiechimon:<branch> --body-file /tmp/pr.md`.
- Run both gates locally before opening:
  `python3 scripts/pr-evidence-gate.py /tmp/pr.md` — exit 1 names each
  problem (`missing-section` / `empty-section` / `not-embedded` /
  `unreachable`); then `python3 scripts/pr-tasks-gate.py /tmp/pr.md` —
  exit 1 names `unchecked-task` (a task still open anywhere in the body,
  with its line number). A body with no tasks passes.
  A section whose only content is a fenced block counts as empty: put at
  least one prose line above the fence (#1785).
- Editing an open PR: `gh pr edit` breaks on Projects-classic GraphQL
  errors; use `gh api -X PATCH repos/xiechimon/cairn/pulls/<n> -F
  body=@/tmp/pr.md`, then re-read with `gh pr view <n> --json body` and
  compare.
- Read the stored body back after creating or editing the PR to check that image links render.
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
- Never add the `needs-decision` label to a PR. When a PR needs a decision, decide by your own recommendation, say in the chat what you chose and why, and keep going; only payments, the owner's own credentials and the steps `AGENTS.md` routes to a person go to the owner. Before asking a person about a PR whose auto-merge is armed, disarm it with `gh pr merge <n> --disable-auto`. A label that is already on keeps pr-evidence red and disarms auto-merge until it is removed.
- Before enabling any merge, require a pr-gate verdict of go with `mergedBy: 'auto-merge'` (`AGENTS.md`, "Current merge state"; every other PR goes to ian), no unchecked tasks anywhere in the body and no `needs-decision` label; an unchecked item keeps pr-evidence red until it is checked.
- Read the PR opener and every commit author: `gh pr view <n> --json author,commits`. Follow `docs/ops/agent-bot-identity.md` for the identity checks.
- Bot-opened PRs require exactly one commit authored by `Cairnwright` before a rebase merge. Use the dispatcher's `~/.cairn/tools/merge-pr.sh`; inspect its source and usage on the dispatch host before invoking it. If the helper is unavailable or the commit identity is wrong, stop and return the PR to the dispatcher.
- Human-opened PRs use `gh pr merge <n> --squash --auto` after verifying their commits contain no `cairnwright[bot]` author. After a merge, read the main commit author and the `commit-author` Actions result.
- Prepare commits outside the App token wrapper, following `docs/ops/agent-bot-identity.md`. Verify that neither the author name nor email of any prepared commit contains `cairnwright[bot]` before pushing.
- If main's author check fails, follow the recovery procedure in `docs/ops/agent-bot-identity.md`. Preserve main history. A subsequent compliant push checks its own `BEFORE_SHA..HEAD` range; verify the actual main commit author and Actions result after merging.

## Gate facts — what is actually enforced

| requirement | enforced by |
|---|---|
| `## What`, `## Proof`, `## Review`, `## Risk` answered (legacy `## Verified` aliases Proof; Upstream is optional) | pr-evidence (required check) |
| image links embedded + HTTP 200 | pr-evidence (required check) |
| no unchecked tasks anywhere outside fenced code and HTML comments; no tasks required | pr-evidence (required check, pr-tasks step) |
| no `needs-decision` label on the PR (a person's decision is pending) | pr-evidence (required check); while the label is on, each run also disarms auto-merge |
| body is English (Chinese only inside backticks or fences) | pr-evidence (required check, language step) |
