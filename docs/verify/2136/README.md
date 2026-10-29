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

The #2136 documentation assertion failed before the ops section named the rejected SHAs and pending production acceptance:

- [red-recovery-tests.txt](red-recovery-tests.txt)

After the guidance update, recovery and author-policy suites pass:

- [green-recovery-tests.txt](green-recovery-tests.txt)
- [green-all-author-tests.txt](green-all-author-tests.txt)

The executable fixture still preserves trailers and historical commit bytes, accepts a subsequent push range, and rejects rerunning the historical bot range. The author predicate and workflow shell are unchanged.

## Overlap

Open #2128 (`lane/2127`) also edits `docs/ops/agent-bot-identity.md` and `docs/lessons/2024-bot-pr-squash-authorship.md` for the product merge-API safeguard (#2127). This recovery appends #2136 incident text under Incident recovery and a recurrence note in the lesson without replacing #2128's product-API paragraphs. Preserve those changes at merge time. Recently merged #2121 recovery coverage and #2099/#2090 identity guidance remain intact; no recently merged additions are removed.

## Production acceptance boundary

Local green tests do not recover main. After an authorized identity-aware merge, inspect the resulting main commit author and the subsequent `commit-author` Actions result. Until that green run is recorded, #2136 recovery remains pending. Historical commits `c683123a` and `78b85594` stay in history; rerunning their failed ranges must still fail.
