# Issue #2136 recovery

## Incident

Main tip `78b85594328fe2c26680060d1ad9dfa28e97d76b` (#2135 squash) and prior `c683123a69b8737ba7f2dac4cf404408e4cd4d5d` (#2134 squash) were authored as `cairnwright[bot]`. The `commit-author` workflow rejected both pushes. Branch tip authorship for #2135 used the allowed `Cairnwright` identity (`0f8799e9`); squash still wrote the bot opener onto main.

Measured authorship: [main-tip-authorship.txt](main-tip-authorship.txt).

Failed Actions:

- [c683123a run 40801882028](https://github.com/xiechimon/cairn/actions/runs/40801882028) — [actions-c683123a-red.log](actions-c683123a-red.log)
- [78b85594 run 40803636122](https://github.com/xiechimon/cairn/actions/runs/40803636122) — [actions-78b85594-red.log](actions-78b85594-red.log)

## Commit preparation

Use the durable recipe in [Incident recovery commit preparation](../../ops/agent-bot-identity.md#incident-recovery-commit-preparation). Explicit `GIT_AUTHOR_*` and `GIT_COMMITTER_*` assignments to `Cairnwright <348051526+cairnwright@users.noreply.github.com>` override inherited bot identity. Keep co-author trailers. Do not force-push main. Do not squash a bot-opened recovery PR.

## Local regression

Round 2 reproduced the finding with `git ls-tree -r --name-only HEAD -- COMMIT_MSG.txt` empty, then the documented verification command failing with `ENOENT` on `COMMIT_MSG.txt` in a tree without that untracked file. The trailer check now reads the durable input it is about, the HEAD commit message, and asserts a standalone `Closes #2136` line, which matches the prepared message even with co-author trailers after it.

The current HEAD `fb576501ca36228eb62ba9eb711a9aaed69e0f2d` already contains that correction. This round reproduced the old dependency by temporarily restoring only the trailer test's `readFileSync` call, ran the full command with no `COMMIT_MSG.txt` present (28 tests, 1 ENOENT failure), then restored the HEAD test byte for byte and ran the identical command (28 tests, 0 failures). Both logs were regenerated before writing the dispatcher handoff file. No production test or author policy changed this round.

After restoring the correction, the full verification command passes without `COMMIT_MSG.txt`:

- [green.log](green.log) (28 tests, 0 failures)

The executable fixture still preserves trailers and historical commit bytes, accepts a subsequent push range, and rejects rerunning the historical bot range. The author predicate and workflow shell are unchanged.

## Review corrections

Round 1 (gate comment on `ee201147`) removed the hand-written PR 2134 recurrence event, including its invalid PR-number episode. The frozen ledger baseline remains unchanged. Automated collection owns recurrence counters and escalation; the incident narrative is not an escalation event. It also removed the five incident wording assertions from the production recovery test. The existing isolated Git fixture still executes the documented recipe under inherited bot identity, preserves trailers and historical commit bytes, accepts the subsequent push range, and rejects the historical range.

Round 1's round-trip evidence used the verification command below; `recipe-negative-control.log` is its negative control, with only the recovery recipe's author assignment temporarily changed to the forbidden bot identity. The executable recovery fixture fails on the resulting Git metadata. The document was restored immediately afterward.

Round 2 (gate comments on `ee201147` and `db94bf28`) removed the trailer check's dependency on `COMMIT_MSG.txt`, an untracked scratch file, so the same command now passes in a clean checkout; see Local regression for the current run.

```sh
node --test scripts/commit-author.test.mjs scripts/commit-author-policy.test.mjs scripts/commit-author-recovery.test.mjs docs/verify/2136/review-check.test.mjs
```

The three review checks inspect the corrected handoff artifacts; they do not claim to test recovery behavior.

## Validation

`pnpm lint`, `flock /tmp/cairn-heavy.lock pnpm typecheck`, and `pnpm spec:parse` passed. Spec parsing collected 1387 web cases and parsed 60 integration test files. `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` exited 0 with no related Vitest tests (`vitest.log`); the relevant tests use Node. English-only, single-use-helper and comment-discipline gates each reported 0, and the lessons ledger check passed. Heavy commands ran sequentially. No servers were started.

## Overlap

Open #2128 (`lane/2127`) also edits `docs/ops/agent-bot-identity.md` and `docs/lessons/2024-bot-pr-squash-authorship.md` for the product merge-API safeguard (#2127). This recovery appends #2136 incident text under Incident recovery and a recurrence note in the lesson without replacing #2128's product-API paragraphs. Preserve those changes at merge time. Recently merged #2121 recovery coverage and #2099/#2090 identity guidance remain intact; no recently merged additions are removed.

## Production acceptance boundary

Local green tests do not recover main. After an authorized identity-aware merge, inspect the resulting main commit author and the subsequent `commit-author` Actions result. Until that green run is recorded, #2136 recovery remains pending. Historical commits `c683123a` and `78b85594` stay in history; rerunning their failed ranges must still fail. The dispatcher cause is unverified. No push, merge or server startup was performed.
