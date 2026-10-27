# PR #1881 CI triage

Measured on 2026-10-26. No product code was changed.

## Branch and main

The branch is `lane/1782`, at `79006c5f64770c1603eff7424e177d1d0e299cef`.
Both `origin/main` and the live remote main ref are
`0117480ad956c1b0bc6b1f5cef149fdd11a9802f`, which is HEAD's parent.
The branch is already based on current main; no rebase is necessary.
All existing `docs/lessons.md` rows were retained.

The branch changes only `integration/eval/skills-routing/cases.json` and
`integration/eval/skills-routing/grade.mts`. The failing tests, server code,
database migrations, roster snapshot, and dependency lockfile match main.

## Local reproduction

Run from the lane root:

```sh
set -o pipefail
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts apps/server/test/trajectory-reflect.test.ts 2>&1 | tee /tmp/cairn-1782-repro.log
```

[Branch output](ci-branch-repro.log): 1 failed, 13 passed.
The roster assertion reproduces CI's exact 162 derived vendors versus 157
snapshot vendors. All 12 trajectory-reflect cases pass.

An isolated `git archive origin/main` extraction at `/tmp/cairn-1782-main`
was linked to the installed workspace dependencies. Running the same command
with that directory as the working directory produced the same result:
[main output](ci-main-repro.log), 1 failed, 13 passed. Installed
`@earendil-works/pi-ai` is version `1.4.0`.

Measured conclusion: the roster snapshot mismatch exists on main with the
installed catalogs. For example, the catalogs include `claude-haiku-5-5` and
`gemini-4-argon`, which the snapshot lacks, while the snapshot includes
`gpt-5.2-chat-latest`, which the derived roster lacks. This branch did not
introduce that mismatch.

The dismissed-candidate case was also repeated 20 times:

```sh
set -o pipefail
flock /tmp/cairn-heavy.lock bash -c 'for attempt in $(seq 1 20); do pnpm exec vitest run apps/server/test/trajectory-reflect.test.ts -t "a dismissed candidate" --reporter=dot || exit; done' 2>&1 | tee /tmp/cairn-1782-dismiss-repeat.log
```

[Repeat output](ci-dismiss-repeat.log): 20 passes, no failures.

## CI evidence and limits

[Attempt 1](https://github.com/xiechimon/cairn/actions/runs/40371865077/attempts/1)
failed both tests. The dismissed-candidate assertion failed at line 582:
the dismiss CLI exited 1 with the generic database/input/output error.

[Attempt 2](https://github.com/xiechimon/cairn/actions/runs/40371865077/attempts/2)
passed the entire trajectory-reflect file unchanged, including the dismissed
case in 5407 ms, and still failed the roster test.

Inference: the trajectory failure is intermittent rather than a demonstrated
regression from this branch. The exact underlying exception is unconfirmed:
the CLI catch handler replaces unexpected exceptions with a generic message.
Local passes do not establish that the flake is fixed.

## Round 2: run 40384180835 attribution

Measured on 2026-10-26 with the branch at `b78a6c11` (parent `0117480a`).
Current `origin/main` is still `0117480a`, the branch parent, so the rebase
is a no-op and every `docs/lessons.md` row is retained. The branch commit
message keeps its single `Closes #1782` line.

The failing `check` run for this head,
[40384180835](https://github.com/xiechimon/cairn/actions/runs/40384180835),
fails exactly one test: the roster snapshot assertion. Repeated locally
under the heavy lock: [round 2 output](ci-roster-round2.log),
1 failed | 1 passed.

Remote evidence that the failure comes from main, not from this branch:

- `ci` on main at `0117480a` failed the same test with the identical
  162-versus-157 assertion:
  [run 40351380688](https://github.com/xiechimon/cairn/actions/runs/40351380688).
  `ci` on main at `10a26f29`, the commit before it, was green; `0117480a`
  is the commit that introduced both the snapshot and the test, so the
  mismatch was born on main.
- `0117480a` is the squash of PR #1818 (issue #1774). PR #1818's head
  `ad97a60d` still resolved `@earendil-works/pi-ai` to 1.0.4, and its green
  `check`,
  [run 40297978027](https://github.com/xiechimon/cairn/actions/runs/40297978027)
  (2026-10-26 09:14 UTC), ran against the 1.0.4 catalogs, which is where the
  checked-in 157-vendor snapshot came from. PR #1824 (issue #1808) upgraded
  pi to 1.4.0 on main at 12:32 UTC. The squash merge at 15:38 UTC combined
  the 1.0.4-derived snapshot with the 1.4.0 catalogs, and main's
  post-merge `ci` run went red on the merge commit.
- The locally derived diff matches CI's counts exactly: 13 ids gained (for
  example `claude-haiku-5-5`, `gemini-4-argon`) and 8 ids lost (for example
  `gpt-5.2-chat-latest`, `open-mixtral-8x7b`), so 157 + 13 - 8 = 162, the
  vendor count CI reported.

The snapshot refresh is owned by another lane: issue #1855 tracks the
mismatch and PR #1861 (open, every check green, MERGEABLE) refreshes the
snapshot from the 1.4.0 catalogs and also teaches the roster that
`zai-glm-*` and `glm-5-2` ids are Z.ai models relayed through Mistral.
Duplicating those file changes on this branch would collide with PR #1861
at merge time, so this lane records the attribution and leaves the change
to that PR. Once PR #1861 merges, rebasing this lane onto main should
turn `check` green with no change of its own.

The PR's `pr-evidence` check passed. No product code was changed and no PR
body edits were made in this round; this evidence is committed on
`lane/1782` and nothing was pushed.

## Round 3: run 40415834061 attachments grant-signature flake

Measured on 2026-10-26. The branch was rebased onto `origin/main` at
`4713294f` (one commit ahead; every `docs/lessons.md` row retained, the
commit message keeps its single `Closes #1782` line). Main's `e41b4add`
roster refresh is now in the branch base, so the round-1/round-2 roster
failure no longer reproduces (`merge-gate-model-roster.test.ts` passes on
the rebased branch).

The failing `check` run for the pre-rebase head,
[40415834061](https://github.com/xiechimon/cairn/actions/runs/40415834061),
fails exactly one test: `apps/server/test/attachments.test.ts >
attachments -- upload side > grant signature altered -> 401`, asserting
`expected 409 to be 401`. Every other job in the run is green, including
`pr-evidence`.

### Mechanism

The test tampers the grant as `sig.slice(0, -2) + 'AA'`. A 32-byte
HMAC-SHA256 MAC encodes to 43 base64url characters, and the final
character carries two padding bits that Node's base64 decoder discards.
When the second-to-last character is `A` and the last character is one of
`A`/`B`/`C`/`D`, the replacement decodes to the identical 32 bytes, so
`verifyAttachmentGrant` still accepts the "tampered" grant. The upload
then proceeds past verification to the consistency checks: the test sends
1 byte against a grant issued for 8, so the server answers 409
`uploaded size 1 ≠ grant 8`, which is the observed assertion. That is the
only route to a 409 in this test: `uploadFile` verifies the grant before
the size/mime/ext checks, and the test's mime and filename match the
grant, so a 409 proves the grant still verified.

The weak-tail probability is `(1/64) * (4/64) = 1/1024` per grant.
[Simulation](ci-attachments-tail-simulation.log): 169 of 200000 random
MACs (0.0845%) have the weak tail.

### Reproduction

A throwaway script (kept out of the repository) signs payloads with the
test server's own secret box until the MAC has the weak tail, then
uploads 1 byte with the tampered grant through the real
`/api/uploads/upload` endpoint:

- [Branch output](ci-attachments-flake-branch.log): weak tail found after
  13 signed payloads; `verifyAttachmentGrant` accepts the tampered grant;
  the upload returns HTTP 409 `uploaded size 1 ≠ grant 8`, reproducing
  the CI assertion exactly. The full `attachments.test.ts` file (27
  tests) passes on the rebased branch.
- [Main output](ci-attachments-flake-main.log): the same reproduction on
  a `git archive origin/main` extraction of `4713294f` (the Tailscale
  commit, which touches none of `attachments-token.ts`,
  `services/attachments.ts`, or the test file), weak tail found after
  1827 signed payloads, same HTTP 409.

### Attribution

The failure is a flake in the test's tamper recipe, not a regression
from this branch and not from main's `4713294f`:

- The branch diff adds no `apps/` code; it only adds
  `integration/eval/skills-routing/`,
  `integration/test/skills-routing-grade.test.ts`, docs, and
  `scripts/prepush*` changes.
- The grant payload is randomized per boot (ephemeral secret box, random
  `attachmentId`/`key`/`exp`), so the weak tail appears at random with
  probability 1/1024 per run. The test has run in every `check` since it
  was added in `e72ab42b` (2026-09-27). The seventeen failed `ci` runs on
  main between 2026-10-25 and 2026-10-26 (including the roster failure at
  `0117480a`) were scanned; none failed on this test, so PR #1881 drew
  the one-in-1024 tail.
- The signature check itself is sound: any MAC byte actually altered is
  rejected with 401. Only a tamper that decodes to identical bytes can
  survive, and only this test recipe produces such a tamper.

The one-line fix belongs to the main-owned test code: a tamper that
always changes the decoded MAC, for example replacing the first signature
character instead of the last two. This lane records the attribution and
leaves the test change to main, following the round-2 pattern; no product
or test code was changed in this round.
