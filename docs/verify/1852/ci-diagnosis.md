# PR #1867 CI diagnosis

## Observed CI failure

The failing `check` job runs the light Vitest project. Its only failing test is
`apps/server/test/merge-gate-model-roster.test.ts`, titled
`the checked-in snapshot matches the installed pi model catalogs`.
The installed catalogs derive 162 vendors, while the checked-in roster contains
157. The PR run reports 5,147 passing tests and one failing test.

First observed PR run:
https://github.com/xiechimon/cairn/actions/runs/40363210173
Latest PR run on the pre-rebase head, same single failure:
https://github.com/xiechimon/cairn/actions/runs/40389687127

## Root cause: a pi-ai 1.0.4 roster under pi-ai 1.4.0 catalogs

The checked-in roster is the pi-ai 1.0.4 derivation. Deriving a roster from
the published `@earendil-works/pi-ai@1.0.4` tarball's catalogs with this
repository's own `deriveModelRoster` yields exactly 157 vendors and 3 aliases,
deeply equal to `MODEL_VENDORS` and `MODEL_ALIASES` in `model-roster-data.ts`.

Main commit `241205d7` (`daemon(1808): upgrade pi from 1.0.4 to 1.4.0`) bumped
`@earendil-works/pi-ai` to 1.4.0 after the lane/1774 branch point. The squash
merge of PR #1818 (commit `0117480a`) therefore pairs the 1.0.4-derived roster
with the 1.4.0 catalogs, and the 1.4.0 derivation counts 162 vendors:

- 13 ids only in the 1.4.0 derivation: `claude-haiku-5-5`, `codestral-2508`,
  `gemini-4-argon`, `gemini-pro-latest`, `glm-5-2`, `labs-leanstral-1-5-1`,
  `minimax-m3.1-flash`, `ministral-14b-2512`, `ministral-3b-2512`,
  `ministral-8b-2512`, `mistral-large-4`, `muse-wonder-1.0`,
  `voxtral-small-2507`
- 8 ids only in the checked-in roster: `gpt-5.2-chat-latest`,
  `gpt-5.3-chat-latest`, `mimo-v2.5`, `mimo-v2.5-pro`,
  `mimo-v2.5-pro-ultraspeed`, `open-mistral-7b`, `open-mixtral-8x22b`,
  `open-mixtral-8x7b`
- aliases are equal (3 on both sides), so only `MODEL_VENDORS` lags.

## Attribution

The failure is inherited from main, not introduced by issue #1852, and it is
deterministic, not a flake: the test reads only checked-in files plus
`node_modules` installed from a frozen lockfile this branch does not touch.

PR #1818's own `check` was green because it ran on the branch head
`ad97a60d`, whose lockfile still pinned pi-ai 1.0.4
(run https://github.com/xiechimon/cairn/actions/runs/121488611222, completed
2026-10-26T09:24:08Z with success). The squash `0117480a` landed on main at
15:38:52Z, and the push-triggered `check` on that commit failed at 15:45:23Z
with the same 162-versus-157 assertion:

Main run: https://github.com/xiechimon/cairn/actions/runs/40351380688

So main was red from the roster landing until the fix below. The branch
`lane/1852` was a single commit on top of `0117480a`; its diff touched none
of `apps/server/src/services/merge-gate/`, `apps/server/test/`, or
`pnpm-lock.yaml`.

Issue #1855 (`main red: check on 0117480a`, opened by main-watch at
2026-10-26T15:55:20Z) tracked the main-side fix: regenerate `MODEL_VENDORS`
from the installed 1.4.0 catalogs. Fixing it inside PR #1867 would have
entangled an unrelated feature branch, so the earlier rounds reported it
instead, and this round picks up the fix by rebasing.

`pr-evidence` passed on the PR. Its body has the required six sections and
checked acceptance items, so this is not a PR-body failure.

## Resolution on main

Main fixed the roster in squash `2ca0e7cd`
(`server(1798): export trajectories daily from the server process`; its
message lists `server(1798): sync model roster snapshot with installed pi
catalogs`): `MODEL_VENDORS` gained the 13 catalog-only ids above and dropped
the 8 roster-only ids. The `ci` run on `2ca0e7cd` is green
(https://github.com/xiechimon/cairn/actions/runs/40391625295, created
2026-10-26T19:59:22Z with success), and issue #1855 was closed at
2026-10-26T20:08:18Z.

## Rebase on origin/main

`git fetch origin main` moved `origin/main` from `0117480a`, the branch's
original parent, to `2ca0e7cd`. `git rebase origin/main` replayed the single
branch commit on top with no conflicts: the files main changed between
`0117480a` and `2ca0e7cd` (`apps/server/src/index.ts`,
`apps/server/src/services/merge-gate/model-roster-data.ts`,
`apps/server/src/services/scheduler.ts`, three server test files, and
`docs/lessons.md`) do not intersect the branch diff, so every
`docs/lessons.md` row from main is kept verbatim. The branch's drizzle
migration `0059_claude_rate_limits` still follows main's tail `0058`. The
rebased commit message still ends with the single `Closes #1852` line.

## Local reproduction

Command:

```sh
set -o pipefail
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee docs/verify/1852/model-roster-repro.txt
```

Before the rebase, at the branch head sitting on `0117480a` with pi-ai 1.4.0
installed from the lockfile, the run failed with exit code 1 and the same
162-versus-157 assertion as the PR `check` runs (three earlier rounds plus
this round's pre-rebase run). After the rebase onto `2ca0e7cd`, the same
command passes with exit code 0 and both tests green. The latest output is
saved in `model-roster-repro.txt` beside this file.

## Scope and checks

The roster fix is main's, not this branch's: no product code, dependency,
test, or lessons ledger changes were made here, and the branch still touches
no roster or lockfile surface. The existing roster assertion already detected
this inherited failure while it was red, so no additional regression test or
process safeguard belongs on this branch. This round rebased the branch onto
the fixed main and refreshed this evidence. On the rebased tree the CI
`check` entry point passes locally:

```sh
flock /tmp/cairn-heavy.lock pnpm prepush --ci
```

Eight checks (lint, typecheck, spec:parse, the affected vitest set, the
e2e-affected coverage gate, the language gate, and the reach registries) all
pass, and the roster reproduction is green.
