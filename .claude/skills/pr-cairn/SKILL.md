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

1. `## Proof`, screenshot first (D117): real screenshots of the running
   product or of the API tool, taken from the live verify-cairn stack, never
   from a fixture page (`?scenario=`) or hand-made HTML. For UI, a before /
   after / unchanged table with one value line under each image, as in t3code
   #27472. For backend changes, the evidence card below. Text request and
   response blocks and the test name are a supplement, not the proof. End
   with the three coverage lines (below).
2. `## What`: one line explaining the change, why, and any existing ticket or known overlap.
3. `<details><summary>Review and risk</summary>` containing `## Review` and
   `## Risk`, separated from the HTML tags by blank lines and closed with
   `</details>`. Keep this block collapsed.

For code changes, the Codex cloud review on the PR head is the required
review. Protected paths, documentation included, need it too, with no
unresolved P0/P1. A security surface also needs `/security-review` findings
fixed or recorded in Risk; that does not send the PR to ian or add
`coordinator-hold`. Other docs-only changes need no code review. Review convergence (whole bug class
per push, one push per round, P2/P3 deferral to a real issue, the round-3
stop) follows `AGENTS.md`, "How to work".
Review links the Codex cloud review on the head SHA, states its verdict and
lists unfixed findings with reasons. Risk states one-way or two-way
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

The `pr-size` check fails a PR above 3000 changed lines outside the generated
paths in `GENERATED_PATHS` of `scripts/pr-size.mjs` (feature maps,
`.mergify.yml`, lockfiles, snapshots, drizzle meta, `docs/verify/**`), and
lists the largest files. Split such a PR into independent PRs off `main`.
To re-report a head without pushing, run
`gh workflow run pr-size.yml -f pr=<n>` (no input re-reports every open PR).
The same workflow labels each PR `size:XS` to `size:XXL`, also leaving out
tests, for context only.
A section containing only fenced code or HTML comments is unanswered.

A legacy `## Verified` aliases Proof. The complete legacy six-section shape
(What, Verified, Upstream, Risk, Acceptance and Issues, with an answered
Upstream and an Acceptance task) may omit Review and is exempt from the cap.
Use the new shape for new bodies. Any unchecked task outside fenced code and
HTML comments still makes the task gate red, including inside details.
Closing keywords belong in commit messages. For a multi-segment ticket,
only the closing segment's commit message carries the parent closing keyword.

## Evidence card (backend and API changes)

The `pr-evidence` gate requires this card whenever the diff changes
`apps/server/src/routes*.ts`, in the style of the schema table. Put it under
`## Proof`, outside code fences and comments:

```markdown
### Requirement

[#3104](https://github.com/xiechimon/cairn/issues/3104)

> what the user typed ... must survive closing the app and reopening it on any device

### Requests

![Request and response](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/3110/calls.png)

| Clause | Request | Response | Rows before to after | ok |
|---|---|---|---|---|
| Before | `GET /api/teams/$T/drafts/todo:x` | `404` | table absent | - |
| survives close | `PUT .../drafts/todo:x` `{"content":"a"}` | `200 {"content":"a"}` | 0 to 1 | yes |
```

- Requirement: an internal source is a link to an issue, PR or plan decision
  (`Dxxx`) plus a quoted excerpt. A third-party API needs an embedded
  screenshot of the official doc; mark it with a `Third-party:` line. Any link
  outside this repository also counts as third-party.
- Requests: an embedded screenshot of the real call with request and response
  visible (Swagger, Postman or the app), and a table with one row per
  requirement clause. A new endpoint or behavior change needs a Before row;
  one 404 or the old response is enough. The Before row comes from the
  base branch or production, never a reverted copy of your own change. At least one row names an HTTP status.
- Generate the table, transcript and screenshots instead of copying them by
  hand: `node .claude/skills/verify-cairn/scripts/vp.mjs drive api-evidence-card card -- <spec.json>`
  (`.claude/skills/verify-cairn/features/api-evidence-card.md`).
- The gate checks the card's shape. Whether it matches the requirement is
  the review's judgment.

## Coverage lines (every PR that changes more than docs)

End Proof with three non-empty lines. Put them in a ```` ```text ```` fence so
they stay out of the 600-character cap; the gate also accepts them as plain
lines:

```text
Live: isolated verify stack on <sha>, SQLite read with sqlite3 -readonly.
Mocked: none. Auth was off (CAIRN_AUTH=off).
Not covered: attachment tokens, two real browsers, the 30-day expiry.
```

`Not verified:` was merged into `Not covered:`. An optional fourth line, `Rollback:`, says how to undo
the change and what that costs; use it for migrations, auth and billing. The
gate does not require it. The gate reds a code PR that lacks any of the three
lines and says which.

## Glance card by change type

Put one glance card under Proof so a reviewer sees the change without reading the diff:

- Migrations (`apps/server/drizzle/**`): paste the output of `node scripts/schema-glance.mjs --base "$(git merge-base origin/main HEAD)" --head HEAD`, heading included. When the PR changes `apps/server/drizzle/**` since its merge base, the `pr-evidence` gate reds it if its `### Schema changes` rows differ from the script's output from that merge base to the PR head.
- After any push that changes the schema, do not hand-edit the table: run `node scripts/pr-schema-sync.mjs <pr-number>`, which prints a body file with `### Schema changes` rewritten from the PR head, then apply it with `gh pr edit <pr-number> --body-file <that file>` in a separate call.
- API changes (`apps/server/src/routes*.ts`): the evidence card below; the gate enforces it.
- Cross-component flows: a Mermaid `sequenceDiagram`.
- `scripts/ops/**`: the command and its run output.

## Screenshots

Store images on `pr-assets/<pr-number>`, created from main or as an orphan.
Use a separate checkout so the implementation branch stays on its own work.
For a new branch from main, the commands in that checkout are:

```sh
git switch -c pr-assets/123 origin/main
mkdir -p docs/verify/2206
cp /tmp/before.png /tmp/after.png /tmp/unchanged.png docs/verify/2206/
git add docs/verify/2206/before.png docs/verify/2206/after.png docs/verify/2206/unchanged.png
~/.cairn/tools/app-token/as-bot.sh git commit -m "docs(2206): add PR screenshots (#123)"
~/.cairn/tools/app-token/as-bot.sh git push origin HEAD:pr-assets/123
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

## Snapshot baselines

When the diff adds or modifies any `*-snapshots/*.png` baseline, the workflow passes the list to the gate as `--changed-baselines`, and `baseline-evidence` reds the PR until the body shows every one of them. Per baseline, give either a table row naming the file with two embedded images, old baseline then new render, or a `<file>: <verdict>` line saying what changed and whether it is intended (a ```` ```text ```` fence keeps long lists out of the cap). Name the file exactly, with or without `.png`. Do not accept a baseline you have not looked at; if no one read it, the verdict says so.

```markdown
| Baseline | Old baseline | New render |
| --- | --- | --- |
| `pr-card-dark-linux.png` | ![old](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/<n>/pr-card-dark-old.png) | ![new](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/<n>/pr-card-dark-new.png) |
```

## UI reference comparison

A PR that changes `apps/web/src` adds a reference table under Proof, one row per state that has a reference shot (D120):

```markdown
| State | Reference | Ours | Verdict |
| --- | --- | --- | --- |
| Empty composer | ![Claude.ai](https://raw.githubusercontent.com/xiechimon/cairn/<sha>/docs/verify/<n>/empty-compare.png) | (right half of the same image) | Matches the single composer; model chip still sits left of the mode label |
```

- Make one side-by-side image per state (`magick montage`, see `.claude/skills/verify-cairn/SKILL.md`, "UI reference comparison") from `docs/design/references/<surface>/` and a live capture; store it like the other screenshots.
- The verdict is one sentence, and says what is still worse than the reference. Fixture-only pairs say `fixture`.
- Name the surface, the reference product, and the `apps/web/DESIGN-RULES.md` ids checked, in a line under the table. The `Not covered:` line lists states with no shot.
- A PR with no reference for its surface says so and links the owner's decision; do not substitute another product.
- Sentences in the verdict column are table text and stay outside the 600-character cap.

## Review

Do not run a local `codex exec` or `claude -p` review before pushing. Codex cloud code review (`chatgpt-codex-connector[bot]`) reviews every push through the review gate. Never write `@codex` in a PR body: Codex reads it as a task request, answers that the repository has no environment, and skips the automatic review. Fix confirmed findings and record skipped ones with reasons under Review.

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
- `coordinator-hold` means the coordinator asked for changes or a person's decision is pending: `.mergify.yml`, `coordinator-merge.mjs` and `merge-pr.sh` all refuse the PR while it is on. Keep it on until you have pushed the requested work or ian gave the decision, then ask the coordinator to remove it.
- Agents decide by their own recommendation, say what they chose and why in chat, and continue; decisions routed to ian follow `AGENTS.md`, "Merge routes". Before asking ian about a PR whose auto-merge is armed, disarm it with `gh pr merge <n> --disable-auto`.
- Before an agent enables merge, require passing CI checks on the head, a Codex cloud review with no unresolved P0/P1, and a pr-gate verdict of go with `mergedBy: 'auto-merge'` (`AGENTS.md`, "Merge routes"). Protected-path PRs enter the merge queue with every other green PR, including security surfaces and PRs that used to be owner-routed. Path class does not add `coordinator-hold` and does not keep a PR on ian's route. A security surface also needs `/security-review` findings fixed or recorded in Risk, and `pr-evidence` fails until the body has a line outside fenced code, `Security review (<40-hex head>): fixed` or `Security review (<40-hex head>): recorded`. The queue requires that check. No unchecked tasks anywhere in the body. ian may admin-merge; an agent uses `--admin` only on a PR ian named in chat, after every required check passes on its head (`AGENTS.md`, "Merge routes").
- Agent sessions on a host with the App key commit, push and open PRs as the App: `~/.cairn/tools/app-token/as-bot.sh git commit ...`, `as-bot.sh git push origin HEAD:<branch>` and `as-bot.sh gh pr create ...`. The commit is authored and committed by `cairnwright[bot]` with `Co-authored-by: xiechimon`, and the push is a plain push with the usual hooks. The pre-commit and pre-push hooks and the `commit-author` check reject any other identity, except a Claude Code cloud session, which has no App key and commits with plain git as `Claude <noreply@anthropic.com>` and opens its PR through the GitHub connector; `docs/ops/agent-bot-identity.md` has the rule.
- PRs that `.mergify.yml` admits (green `review-gate` from GitHub Actions, `merge-route` and `pr-size` checks, with no `coordinator-hold`) enter the Mergify merge queue automatically, including a PR opened by `cairnwright[bot]`: never `gh pr merge` them; the required `Mergify Merge Queue` check refuses a direct merge while a PR is queued. That check and `Mergify Merge Protections` list any unmet condition; a new push dequeues the PR and it re-enters once CI passes again. Path class does not keep a PR on the human route and does not add `coordinator-hold`.
- PRs that Mergify does not admit merge by squash on the route `AGENTS.md` gives them (`~/.cairn/tools/merge-pr.sh` on the dispatch host). After a merge, read the main commit author and the `commit-author` Actions result.

## Gate facts — what is actually enforced

| requirement | enforced by |
|---|---|
| `## Proof`, `## What`, `## Review`, `## Risk` answered, including headings inside details (legacy `## Verified` aliases Proof; Upstream is optional) | pr-evidence (required check) |
| at most 600 visible prose characters outside tables, images, code, comments and details; complete legacy six-section bodies exempt | pr-evidence (required check) |
| image links embedded + HTTP 200 | pr-evidence (required check) |
| a diff touching `apps/server/src/routes*.ts` carries `### Requirement` (internal link plus quote, or a doc screenshot; third-party needs the screenshot) and `### Requests` (a call screenshot, a Before row, a row with an HTTP status) | pr-evidence (required check, `--changed-files`) |
| a diff changing more than docs has non-empty `Live:`, `Mocked:` and `Not covered:` lines | pr-evidence (required check, `--changed-files`) |
| every added or modified `*-snapshots/*.png` baseline has an old / new image pair row or a `<file>: <verdict>` line (`baseline-evidence`) | pr-evidence (required check, `--changed-baselines`) |
| no unchecked tasks anywhere outside fenced code and HTML comments; no tasks required | pr-evidence (required check, pr-tasks step) |
| body is English (Chinese only inside backticks or fences) | pr-evidence (required check, language step) |
