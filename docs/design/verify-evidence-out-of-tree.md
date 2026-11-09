# Verify evidence outside user repositories

Ticket: #3511 (dogfood rehearsal 2026-11-08, fix 3). Status: design for review; no code lands before this is accepted.

## Problem

The verify step writes its evidence into `docs/verify/<ticket>/`, commits and pushes it to the PR branch, and pastes raw links into the PR body (`packages/shared/src/records/verify.ts`). In a user's repository that puts cairn's working files into the user's history: the rehearsal sandbox PR carried 16 `docs/verify/1/` files and a pasted verification section. Two layers cause it: the prompt asks for it, and the daemon runs `commitAll` and pushes after every non-review step (`apps/daemon/src/runner.ts`), so anything the verify agent leaves in the worktree ships even if the prompt changes.

Decision already made (coordinator, 2026-11-08): in repositories other than `xiechimon/cairn` the verify step never commits or pushes; evidence goes through `attach_file` into cairn's attachment store; the merge gate accepts attachments for those repositories. `xiechimon/cairn` keeps `docs/verify/`.

## Evidence store per repository

`verifyEvidenceStoreOf({owner, repo})` in `packages/shared` returns `repository` for `xiechimon/cairn` (case-insensitive) and `attachments` for every other repository. One function, used by the prompt builder, the daemon (through the prompt meta line) and the gate. Forks and renamed copies of cairn are `attachments`.

## Invariants

1. **No evidence in user repositories.** In `attachments` mode a verify step produces no commit and no push, whatever the agent leaves in the worktree.
2. **Verdict bound to the judged head.** A verify verdict counts only when its reported head equals the dispatched head and its digest equals the gate's digest, as today (`bindGateVerdict`, `readiness.ts` `at()`). `attachments` mode must not weaken this; it removes the evidence-only push path instead of widening it.
3. **Fail closed.** A missing, unreadable or unbound piece of evidence blocks; it never passes.
4. **Recording proof stays required.** When the patch needs a recording (`recordingRequired`), the gate passes only with a recording that the passing verify step produced for the current digest: a present raw link under `docs/verify/<ticket>/` in `repository` mode, an attachment created by that verify step in `attachments` mode.
5. **cairn unchanged.** `repository` mode keeps today's prompt, commit, PR body links, blockers and CI gates byte for byte.
6. **One mode per build.** The mode is decided once, at verify enqueue, from the project's repository, and travels in the prompt meta line (`{"kind":"verify","expectedHeadSha":…,"evidence":"attachments"}`); the daemon and the gate do not re-derive it differently.

## Entry points and failure modes

| Entry point | Today | `attachments` mode | Failure mode to guard |
|---|---|---|---|
| Verify prompt (`buildVerifyStepPrompt`) | write `docs/verify/<t>/`, commit, push, `gh pr edit` | write under `.cairn-verify/` in the worktree, upload each file with `attach_file`, do not touch the repository or the PR; recordings are `.gif` (attachment types exclude video) | prompt still mentions `docs/verify` or PR edits; mode missing from the meta line |
| Daemon after the step (`runner.ts`) | `commitAll`, push, report head | no `commitAll`, no push; rewind the worktree to the step start (`restoreCheckpoint`, as review checkouts do) so `.cairn-verify/` cannot leak into the next build step's commit; report the start head | agent-made files committed by the next step; head not reported, so the verdict is unbound; agent pushing on its own (prompt-only guard, see Risks) |
| Verdict binding (`persistGateVerdict`, `bindGateVerdict`) | evidence-only push allowed under `docs/verify/<t>/` | no push, so reported head equals expected head; the evidence-only path is not used | none new; the existing rule already rejects a moved head |
| Attachment store (`attachWorkerFile`) | used for UI screenshots | holds every verify evidence file, `createdBy = step:<verifyStepId>`, `todoId`, `sha256` | upload rejected (type, size 10 MiB, quota): the agent must report it, and `passed` stays truthful; recording over 5 MiB does not count |
| Gate inputs (`merge-gate-run.ts` views) | verdict rows | each verify view gains `recordingAttached`: the step created a `.gif` attachment of at most 5 MiB | attachment from another step or build counted; size or type not checked |
| `recording-missing` (`readiness.ts`) | needs a present raw link under `docs/verify/<t>/` in the PR body | needs a passing verify verdict at the current digest with `recordingAttached`; raw links are ignored | a link in the PR body or an attachment from a stale digest satisfying it |
| `evidence-outside-ticket`, `evidence-executable` (`paths.ts`) | fire on `docs/verify/` files in the diff | unchanged; in `attachments` mode such files only appear if the author (not verify) committed them, and they still block the same way | none new |
| `verify-evidence-invalid` | readiness reads `evidence_invalid` verdicts; no producer exists today | unchanged | none new; noted so nobody assumes it guards attachments |
| Patch digest (`digest.ts`, daemon `local-merge.ts`) | excludes `docs/verify/` files | unchanged; nothing is added under `docs/verify/` in user repositories | none new |
| Evidence presence reads (`github-facts.ts`) | lists linked raw paths at the head | skipped in `attachments` mode (no links to read), saving GitHub calls | none new |
| PR body and CI (`pr-evidence`, `silent-revert-gate`) | cairn-only workflows | not present in user repositories; nothing changes | none |

## TLA+ model impact (`verify-merge-gate`)

`MergeGate.tla` keeps evidence links and the recording requirement as per-read predicates outside the model (Bounds), so P1, P2, P5 and P6 keep their meaning. `PushEvidence` (an evidence-only push that moves the head but not the digest) cannot occur in `attachments` mode, which narrows the reachable traces; it does not add an action. The change touches covered files (`readiness.ts`, `builds.ts`, `github-facts.ts` read path), so the PR runs `scripts/run.sh` and records that all twelve configurations still match `expected.txt`, with the drift list reviewed per the skill's update procedure. No property changes.

## Tests (red on `origin/main` first)

1. Shared: an `attachments` prompt never contains `docs/verify`, `git add` or `gh pr edit`, asks for `attach_file` under `.cairn-verify/` and a `.gif` recording, and its meta line carries `evidence: attachments`; `repository` prompts are unchanged.
2. Shared: `verifyEvidenceStoreOf` is `repository` only for `xiechimon/cairn` in any letter case; `cairn-dogfood-sandbox` and `someone/cairn` are `attachments`.
3. Server: a green PR in `octo/demo` enqueues a verify step whose prompt meta is `attachments`.
4. Daemon: an `attachments` verify step runs no `commitAll`, no push, rewinds to the step start and reports the start head with `hasChanges: false`; a `repository` verify step still commits.
5. Gate (pure readiness), non-cairn repository: a recording-required patch blocks with `recording-missing`; a passing verify verdict with `recordingAttached` at the current digest clears it; a raw link alone does not; an attached recording on a stale digest does not.
6. Gate, cairn: an attached recording does not replace the `docs/verify` link.
7. Gate inputs: `recordingAttached` is true only for a `.gif` of at most 5 MiB created by that verify step.
8. Model: `run.sh` output unchanged against `expected.txt`.

## Risks and limits

- The daemon cannot stop an agent from running `git push` itself during the step; the prompt forbids it and the rewind discards local commits, but a pushed commit would reach the branch. Closing that needs the step to run without push credentials, which is a daemon credential change outside this fix.
- Attachments are visible in cairn only; reviewers on GitHub do not see them. That is the intended trade for user repositories.
- Video recordings are not attachable; `.gif` is the only recording format in `attachments` mode.
