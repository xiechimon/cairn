# Pre-push review and review evals

Status: design only. ian decided the direction in chat on 2026-11-11. This page does not change a hook, a workflow, or Langfuse. Claims are observed (read or queried here), derived (from that), or unverified. Review-gate prior art and the night of 2026-11-11 are in [the research note](../research/review-gate-prior-art-2026-11-11.md). Do not weaken the P0/P1 check that note describes.

## Decision

Run one cheap, fresh-context, diff-only review before push, and measure review quality in the existing self-hosted Langfuse. The cheap review is not the required review. Codex cloud review on the head remains that check.

First slice, and the only one this design authorizes next: the pre-push hook, its prompt `scripts/prepush-review.md`, and the `AGENTS.md` sentence below. No Langfuse write, no dataset key, no `pr-evidence` change. The eval slice waits until ian provisions a dataset-write key on the host. CI never holds that key.

## Part 1: cheap pre-push review

`pnpm prepush` already runs from `.husky/pre-push`. Add the review only to the local plan in `scripts/prepush.mjs`. `pnpm prepush --ci` (what `.github/workflows/ci.yml` runs) must not call `pi`. A skill step in `pr-cairn` is a second place an agent can skip; the hook is the one trigger. The same implementation PR updates the forbid-local-review sentence in `AGENTS.md` and `.claude/skills/pr-cairn/SKILL.md`.

Trigger when either is true, on the committed diff from the merge base with `origin/main` to `HEAD`. Unstaged and untracked content is not part of the push, so the hook never reads it:

- a path matches `protected` or any `humanQueue` list in `packages/shared/merge-gate-paths.json`
- counted lines exceed 300

Counted lines are `scripts/pr-size.mjs` lines: additions plus deletions, tests and `GENERATED_PATHS` left out. Raw GitHub additions are the wrong N. On the 13 author PRs in the research note, raw size jumps from 835 to 7665 because of tests, while counted lines stay in 104–802.

| PR | Counted | Path trigger | Failed heads (research note) |
| --- | ---: | --- | ---: |
| #3978 #3977 #3965 #3966 #3969 | 118, 148, 113, 133, 265 | no | 0, 1, 6, 8, 8 |
| #3974 | 356 | no | 4 |
| #3981 #3979 #3987 #3997 #3992 #3994 #3989 | 104, 124, 309, 408, 584, 747, 802 | yes (drizzle or credentials) | 0, 0, 0, 5, 2, 3, 7 |

N=300 is the gap above the docs cluster (max 265) and below the only non-protected multi-round code PR (#3974, 356 counted, 4 failed heads). N=400 would miss that PR. N=100 would review every design doc; those rounds were implementation notes, not code defects. The path trigger already covers the seven protected diffs, including #3981 at 104 counted lines. Five of the 13 would not be reviewed. That is the point.

Send only the counted diff of the commits in the push, protected hunks first, and only after the public-content gate has already run. Every byte sent is content this same push publishes to the public repository and to Codex cloud review, so the scan below is a tripwire for an accidental secret, not a confidentiality boundary. A suspected secret never blocks the push and is never sent: the hook withholds that file from the payload and prints `prepush-review: withheld (possible secret) <path>`, without the matched text. A file is suspect when a sent line hits `redactSecrets` (the patterns in `packages/shared/src/secret-redaction.ts`), contains a PEM header, or, in a config or prose file only (`.md`, `.yaml`, `.yml`, `.toml`, `.json`, `.jsonl`, `.ini`, `.conf`, `.cfg`, `.properties`, `.env*`, `.txt`, shell), has a key whose name contains `password`, `passwd`, `secret`, `token`, `api_key`, `apikey`, `private_key`, `access_key` or `credential` (case-insensitive) followed by `:` or `=` and a value that is not empty, not a `${...}` or `$VAR` reference, and not one of `example`, `changeme`, `<...>`, `xxx`, `***`. Source files in every language get only the `redactSecrets` and PEM scans, so `token: string` in `.ts`, `apiKey: string` in `.mts` and `let token: String` in Swift are sent. A hit withholds one file and nothing else: a false positive costs review coverage of that file, and no rule in this paragraph can stop a push. If the shared scan cannot run, nothing is sent and the hook prints `skipped (secret scan unavailable)`. Bodies of files on the `credentials` list are never sent; the hook prints `skipped (credential path) <path>` and reviews the rest, and Codex cloud review, which already sees the PR, is the review for that file. String literals and comments are sent as written. Cap input at 24,000 tokens (about 20 tokens per counted line, derived, plus an 800-token prompt). Tonight's largest triggered diff is 802 counted lines, about 17,000 tokens, so the cap covers that night unless lines are unusually long. Over the cap, send a prefix and print `truncated`. A `count: 0` on a truncated diff is not full coverage and does not block. Output cap 1,500 tokens. Time cap 90 seconds, a kill in this step, not the 15-minute node-test timeout.

Command, observed flags from `pi --help` on this host: `pi --no-session --no-tools -p --mode json`, prompt file as the system prompt, diff on stdin. Model order, all present in `pi --list-models`: `workbuddy/deepseek-v4.1-flash`, then `workbuddy/hy4free`, then `anthropic/claude-haiku-5-5`. Not GPT. Not `deepseek-v4-flash`: that id is in `BANNED_MODEL_IDS` and is a different string. This process is host `pi`, not a lane, and it must not be added to the role table. Pass a thinking-off suffix if that `pi` accepts one. Unverified which suffix, so the 90-second kill stands either way. One pass. No tools. No session. On a later push, send only the delta since the last reviewed sha, plus findings already reported, so the model does not re-report them.

The prompt allows only a defect that breaks behavior, loses data, or opens a hole. Each finding is `file:line: bug-class: one sentence`. The reply ends with `count: N`. Zero findings must also contain the line `no issues`. No nits, no style, no "consider". A finding whose line is not in the sent diff is dropped and does not count.

Failure. Infra (missing `pi`, missing key, 404, timeout, unparseable output) prints `prepush-review: skipped (<reason>)` and exits 0. Findings block the push until each one is gone from the diff or named by a `Pre-push-review-answer:` trailer on a commit in the push. The trailer is the record that exists before a PR body does. The PR body lists `count: N` and each answer. A `pr-evidence` check for that list is a later slice, because that check is a CI gate. A trailer does not resolve a Codex thread and does not make `review-gate` green.

`AGENTS.md` sentence to replace the current forbid-local-review line:

> `pnpm prepush` runs one diff-only review before push when the committed diff touches a protected or security path, or exceeds 300 counted lines. It is `pi --no-session --no-tools -p`, one pass, prompt `scripts/prepush-review.md`. Do not run `codex exec` or `claude -p`. This review is not the required review. Codex cloud review on the head remains the required review. Fix each finding, or answer it with a `Pre-push-review-answer: <path>: <bug-class>: <reason>` trailer on a commit in the push, and list `count: N` plus each answer in the PR body. A trailer does not resolve a Codex thread and does not make `review-gate` green. A model failure prints `prepush-review: skipped` and does not block the push.

Cost per review uses DeepSeek's published `deepseek-flash` list price (version DeepSeek-V4.1-Flash-1017, cache-miss input $0.15/M off-peak and $0.30/M peak, output $0.60/M and $1.20/M). Peak is 01:00–04:00 and 06:00–10:00 UTC, weekdays. The workbuddy relay price is unverified; treat list price as a ceiling, not an invoice. `hy4free` has no published price; it is only the second try. Haiku 5.5 at or under 100k prompt tokens is $0.10/M input and $0.50/M output, cheaper at list than flash cache-miss, and the fallback so the Anthropic key is not the default. Planning figure: 20 tokens per counted line plus 800, output charged at the 1,500 cap.

| Case | Flash off-peak | Flash peak | Haiku 5.5 |
| --- | ---: | ---: | ---: |
| One review at the triggered mean (429 counted lines) | $0.0023 | $0.0046 | $0.0017 |
| Eight triggered PRs, one review each | $0.019 | $0.037 | $0.014 |
| Upper bound: one review per failed head plus the green head (29 reviews) | $0.077 | $0.155 | $0.056 |

A night like that one stays under $0.16 even if every triggered push is re-reviewed at peak list price. Prefer flash first so the default does not spend the Anthropic key `docs/ops/langfuse.md` already caps for shadow judges.

## Part 2: review evals in Langfuse

Langfuse here is the self-hosted v4.68.0 stack in `ops/langfuse/`. It is not Cloud, and it is not a merge input. `docs/ops/langfuse.md` already posts numeric scores with `POST /api/public/scores` from `apps/server/src/trajectory-shadow.ts`, and enqueues annotation items with `POST /api/public/annotation-queues/:id/items` from `apps/server/src/trajectory-failure-replay-queue.ts`. Nothing in cairn reads those scores. Keep that. The loopback bind means a GitHub Actions runner cannot reach the stack and must not be given a key. The weekly job is a systemd user timer on omarchy, `scripts/ops/systemd/cairn-review-metrics.timer`, beside `cairn-eval-weekly.timer`. If Langfuse is down the timer logs a skip and exits 0. It does not file an issue and it does not block merge.

Installed `@langfuse/client` 6.1.1 has `dataset.get(name, { version })` and `dataset.runExperiment`. The v4.68.0 tree has `/api/public/experiments`, `/api/public/scores`, and the annotation-queue items route. Use those. Do not call the legacy ingestion paths `langfuse.com/llms.txt` says Cloud retires on 2026-11-16. Dataset versioning, JSON schema on input and expected output, and local evaluators that become scores are the current dataset and experiments-via-SDK docs. Categorical scores are in the scores-via-SDK doc; confirm the enum on the running 4.68 stack before relying on it. If it is missing, store a numeric code and put the label in the comment, as `cost_z` already does. GenAI semantic conventions, and `packages/shared/src/genai-conventions.ts`, name model and tool operations. They are not the score store. Do not put review labels on product traces.

Dataset `review-incidents`, written only by the host. Item input is the `reviewerInput` shape in `integration/eval/review` (diff, subject, PR number, no answer). Expected output is a union on `kind`: `incident` carries path, line range, and bug class; `clean` carries no other field and marks a queue-confirmed clean control. Schema on both. Pin `version` before an experiment. Sources, all candidates until a human marks the queue item completed:

- reverts and fix-forwards: `scripts/escape-trace.mjs` (`revert-body` and resolved traces). A revert is not automatically a bug.
- review-found bugs: a Codex or pre-push thread whose reply names a fixing commit. The research note did not re-verify those diffs. The queue does.

Pending items never become dataset items. Same rule as `integration/eval/failure-replay`. New queue `review-incidents`, not the failure-replay queue. The collector refuses a candidate whose diff hits `redactSecrets` or a `credentials` path body, and does not enqueue a redacted copy. Intake does not commit cases into `integration/eval/` from the timer. A human PR does that, as the failure-replay README already requires.

Experiment, later slice, not this one: `dataset.runExperiment` on the pinned version. The task is the review prompt under test, tools off, expected output not in the prompt. Evaluators are local functions, not an LLM judge. Recall: items with at least one finding on the expected path, whose line overlaps the expected range, and whose bug class matches the expected class after lowercasing and stripping spaces and hyphens. A same-line finding of a different class is not a hit. An unmatched finding on an incident item is not a false positive: the label is one location, not an exhaustive list, so a second real defect must not count against the reviewer. False positives are findings on `kind: clean` items only, reported as a count and as a rate. A rate alone hides a flood. An unmatched finding becomes a false positive only after a human labels that item exhaustive and still unmatched. Run it on the host before a review-system PR merges. Not a required check until a later design says so. Not in CI.

Comment outcomes, weekly, from `gh` review threads. One score per comment, id derived from the comment node id so a re-run does not duplicate (same idea as shadow's stable score id). Name `review.outcome`. Value, from reply text, not a re-read of the diff: `fixed` (names a commit), `rejected` (the author disputes it: not a bug), `accepted-unfixed` (the author agrees it is real and records or defers it, such as `Recorded, not fixed` or `valid, out of scope for this PR, tracked in #N`), `intentional` (by design), `did-not-matter` (resolved with no reply, outdated, or no code change and none of the other labels). Weekly aggregates on one trace per ISO week: `review.revert_rate` (revert commits on main divided by merge commits, 7 days) and `review.cycles_to_pass` (median of review-gate failed heads before the first green, the research note's method). These scores do not gate merge.

Scripts. `scripts/review-metrics.mjs` collects candidates, enqueues, and posts the weekly scores. `integration/eval/review/experiment.mjs` is the scorer. A PR that changes `scripts/ops/review-gate/`, `scripts/prepush-review.mjs`, or `scripts/prepush-review.md` must not also change `integration/eval/review/`. The independent review already blocks a head it marks as an eval-ruler change (`apps/server/src/services/merge-gate/readiness.ts`). Do not add a glob: the scorer lives under the existing ruler.

## What is protected, and what is not owner-routed

Observed in `AGENTS.md` on this branch: path class does not keep a PR on ian's route and does not add `coordinator-hold`. Protected paths enter the queue with every other green PR. "Require review from Code Owners" is not enabled (`docs/ops/agent-bot-identity.md`). So none of the paths below are owner-routed. They are still protected. None of them is a security surface. `scripts/security-review-disposition.mjs` builds that list only from `credentials`, `machineAndCommandBoundary`, and `externalEntryAuth`. `releaseAndControlPlane` is protected, not that list.

| Future path | Class | What the PR needs |
| --- | --- | --- |
| `scripts/prepush-review.mjs`, `scripts/prepush-review.md`, `scripts/prepush.mjs`, `AGENTS.md`, `.claude/skills/pr-cairn/SKILL.md` | `protected` | Codex review, no unresolved P0/P1 |
| `scripts/ops/systemd/cairn-review-metrics.*` | `protected` (`scripts/ops/**` is also `humanQueue.releaseAndControlPlane`) | Codex review, no unresolved P0/P1. Not a security surface, so no disposition line |
| `integration/eval/review/experiment.mjs` | eval ruler (`integration/eval/**`) and `CODEOWNERS` `@xiechimon` | must not share a PR with a review-behavior change |
| this file, `docs/design/*.md` | `autoMerge` (`docs/**/*.md`) | this PR only; it edits no gate |

The ruler a review-system PR must not edit is the eval globs in `packages/shared/merge-gate-paths.json`: `integration/eval/**`, `.claude/hillclimb/**`, `apps/server/src/trajectory-export.ts`, `apps/server/src/trajectory-export-cli.ts`, `apps/server/src/trajectory-outcome.ts`, `packages/shared/src/trajectory-pack.ts`. The dataset itself lives in Langfuse, which a PR cannot commit. `pr-gate.js` runs from `origin/main`, so a PR cannot edit the gate that judges it.

## What we copy, and what we do not

| Source | Take | Leave |
| --- | --- | --- |
| [Datasets](https://langfuse.com/docs/evaluation/experiments/datasets.md), [experiments SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk.md) | version pin, schema, local evaluators as scores | UI prompt experiments, LLM-as-a-judge as the recall scorer |
| [Scores](https://langfuse.com/docs/evaluation/evaluation-methods/scores-via-sdk.md), [annotation queues](https://langfuse.com/docs/evaluation/evaluation-methods/annotation-queues.md) | `POST /api/public/scores`, human complete-before-intake | a second queue mixed with failure-replay |
| [GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) (page moved; local attributes in `packages/shared/src/genai-conventions.ts`) | model calls stay `gen_ai.*` | review outcomes as span attributes |
| Claude Code team summary in the task brief | one pass, name the bug class, do not re-report, pre-existing does not count, a bot review does not approve | a required human approval; cairn's approval count is not that, and this slice does not add one |
| Research note | keep the P0/P1 check; N and cost from that night's 13 PRs | its queue-rule and round-cap edits; out of scope here |

## Failure modes the first slice must test

| Failure | Required behavior |
| --- | --- |
| `pi` missing, key missing, 404, 90s timeout, output without `count:` | exit 0, print `skipped`, push continues |
| finding on a line not in the sent diff | drop it, do not count it, do not block |
| finding with no fix and no `Pre-push-review-answer:` trailer | exit non-zero |
| `count: 0` and `no issues` | exit 0 |
| diff over 24,000 input tokens | send protected hunks first, print `truncated`, do not block on truncation alone |
| key-value scan hits a config or prose line (`password: hunter2`) | withhold that file, print `withheld (possible secret) <path>`, never print or send the line; the push proceeds |
| `token: string` in `.ts`, `apiKey: string` in `.mts`, `let token: String` in Swift | not a hit; the file is sent |
| `redactSecrets` or a PEM header hits a file | withhold that file, print `withheld (possible secret) <path>`, send no redacted copy; the push proceeds |
| the shared scan cannot run | send nothing, print `skipped (secret scan unavailable)`, exit 0 |
| unstaged or untracked content | never read, never sent |
| diff includes a `credentials` path body | do not send that body; print `skipped (credential path) <path>`; review the rest |
| `--ci` | this step is absent |

Tests for that table belong in the implementation PR, next to `scripts/prepush.test.mjs`, and fail on current main before the hook exists. This PR adds none.
