# Verify evidence outside user repositories

Ticket: #3511 (dogfood rehearsal 2026-11-08, fix 3). Status: accepted with changes (coordinator review on #3513): the evidence store is a project setting, and a passing verify posts one PR comment. Implementation lands in the PRs listed under Rollout.

## Problem

The verify step writes its evidence into `docs/verify/<ticket>/`, commits and pushes it to the PR branch, and pastes raw links into the PR body (`packages/shared/src/records/verify.ts`). In a user's repository that puts cairn's working files into the user's history: the rehearsal sandbox PR carried 16 `docs/verify/1/` files and a pasted verification section. Two layers cause it: the prompt asks for it, and the daemon runs `commitAll` and pushes after every non-review step (`apps/daemon/src/runner.ts`), so anything the verify agent leaves in the worktree ships even if the prompt changes.

Decision (coordinator, 2026-11-08): in `attachments` projects the verify step never commits or pushes; evidence goes through `attach_file` into cairn's attachment store; the merge gate accepts attachments there. The cairn project keeps `docs/verify/`.

## Evidence store is a project setting

`project.evidenceStore`: `'attachments' | 'repository'`, not null, default `'attachments'`. It is part of the project record and editable through the existing project settings API (`PATCH /api/projects/:id`). No code compares repository names. The migration that adds the column sets `repository` once for the existing cairn project (the project whose `githubRepo` is cairn's repository); that one-time data step is the only place the name appears, and a self-hoster or fork starts on `attachments` like every other project.

## Invariants

1. **No evidence in user repositories.** In `attachments` projects a verify step produces no commit and no push, whatever the agent leaves in the worktree.
2. **Verdict bound to the judged head.** A verify verdict counts only when its reported head equals the dispatched head and its digest equals the gate's digest, as today (`bindGateVerdict`, `readiness.ts` `at()`). `attachments` mode must not weaken this; it removes the evidence-only push path instead of widening it.
3. **Fail closed.** A missing, unreadable or unbound piece of evidence blocks; it never passes.
4. **Recording proof stays required.** When the patch needs a recording (`recordingRequired`), the gate passes only with a recording that the passing verify step produced for the current digest: a present raw link under `docs/verify/<ticket>/` in `repository` projects, an attachment created by that verify step in `attachments` projects.
5. **`repository` projects unchanged.** They keep today's prompt, commit, PR body links, blockers and CI gates byte for byte.
6. **One mode per build.** The verify enqueue reads `project.evidenceStore` once and writes it into the prompt meta line (`{"kind":"verify","expectedHeadSha":…,"evidence":"attachments"}`); the daemon reads the meta line, and the gate reads the same project field. Nothing re-derives the mode from a repository name.
7. **GitHub reviewers still see the verdict.** After a passing verify in an `attachments` project, cairn posts one text-only PR comment: verdict, judged head SHA, what was checked (the verdict conclusion), and a link to the thread in cairn (`${webOrigin}/app?thread=<todoId>`). A comment is not repository history, so invariant 1 holds.

## Entry points and failure modes

| Entry point | Today | `attachments` project | Failure mode to guard |
|---|---|---|---|
| Project setting (`project.evidenceStore`) | none | default `attachments`; cairn project migrated to `repository` | a new project in cairn's repository silently on `attachments` (acceptable: the owner sets it; documented) |
| Verify prompt (`buildVerifyStepPrompt`) | write `docs/verify/<t>/`, commit, push, `gh pr edit` | write under `.cairn-verify/` in the worktree, upload each file with `attach_file`, do not touch the repository or the PR; recordings are `.gif` (attachment types exclude video) | prompt still mentions `docs/verify` or PR edits; mode missing from the meta line |
| Daemon after the step (`runner.ts`) | `commitAll`, push, report head | no `commitAll`, no push; rewind the worktree to the step start (`restoreCheckpoint`, as review checkouts do) so `.cairn-verify/` cannot leak into the next build step's commit; report the start head | agent-made files committed by the next step; head not reported, so the verdict is unbound; agent pushing on its own (prompt-only guard, #3514) |
| Verdict binding (`persistGateVerdict`, `bindGateVerdict`) | evidence-only push allowed under `docs/verify/<t>/` | no push, so reported head equals expected head; the evidence-only path is not used | none new; the existing rule already rejects a moved head |
| Attachment store (`attachWorkerFile`) | used for UI screenshots | holds every verify evidence file, `createdBy = step:<verifyStepId>`, `todoId`, `sha256` | upload rejected (type, size 10 MiB, quota): the agent must report it, and `passed` stays truthful; recording over 5 MiB does not count |
| PR comment after a passing verify | none (the PR body carried links) | one comment per passing verify verdict, keyed by verify step id so a retry does not post twice; GitHub write failure is logged and never changes the verdict | comment repeated on every poll; comment carrying file contents or attachment tokens; a failing verdict announced as passing |
| Gate inputs (`merge-gate-run.ts`) | verdict rows | `GateInputs` gains `evidenceStore` from the project; each verify view gains `recordingAttached`: the step created a `.gif` attachment of at most 5 MiB | attachment from another step or build counted; size or type not checked |
| `recording-missing` (`readiness.ts`) | needs a present raw link under `docs/verify/<t>/` in the PR body | needs a passing verify verdict at the current digest with `recordingAttached`; raw links are ignored | a link in the PR body or an attachment from a stale digest satisfying it |
| `evidence-outside-ticket`, `evidence-executable` (`paths.ts`) | fire on `docs/verify/` files in the diff | unchanged; such files only appear if the author (not verify) committed them, and they still block the same way | none new |
| `verify-evidence-invalid` | readiness reads `evidence_invalid` verdicts; no producer exists today | unchanged | none new; noted so nobody assumes it guards attachments |
| Patch digest (`digest.ts`, daemon `local-merge.ts`) | excludes `docs/verify/` files | unchanged; nothing is added under `docs/verify/` in `attachments` projects | none new |
| Evidence presence reads (`github-facts.ts`) | lists linked raw paths at the head | skipped for `attachments` projects (no links to read) | none new |
| PR body and CI (`pr-evidence`, `silent-revert-gate`) | cairn-only workflows | not present in user repositories; nothing changes | none |

## TLA+ model impact (`verify-merge-gate`)

`MergeGate.tla` keeps evidence links and the recording requirement as per-read predicates outside the model (Bounds), so P1, P2, P5 and P6 keep their meaning. `PushEvidence` (an evidence-only push that moves the head but not the digest) cannot occur in `attachments` projects, which narrows the reachable traces; it does not add an action. The PR comment is a GitHub side effect after the verdict is stored and does not feed the gate. Every PR that touches a covered file (`readiness.ts`, `builds.ts`, `github-facts.ts`) runs `scripts/run.sh` and records that all twelve configurations still match `expected.txt`, with the drift list reviewed per the skill's update procedure. No property changes.

## Tests (red on `origin/main` first)

1. Setting: a new project reads `evidenceStore: 'attachments'`; the migration sets `repository` only on the existing cairn project row; `PATCH /api/projects/:id` changes it and rejects other values.
2. Shared: an `attachments` prompt never contains `docs/verify`, `git add` or `gh pr edit`, asks for `attach_file` under `.cairn-verify/` and a `.gif` recording, and its meta line carries `evidence: attachments`; `repository` prompts are unchanged.
3. Server: a green PR in an `attachments` project enqueues a verify step whose prompt meta is `attachments`; a `repository` project's prompt is unchanged.
4. Daemon: an `attachments` verify step runs no `commitAll`, no push, rewinds to the step start and reports the start head with `hasChanges: false`; a `repository` verify step still commits.
5. Gate (pure readiness), `attachments`: a recording-required patch blocks with `recording-missing`; a passing verify verdict with `recordingAttached` at the current digest clears it; a raw link alone does not; an attached recording on a stale digest does not.
6. Gate, `repository`: an attached recording does not replace the `docs/verify` link.
7. Gate inputs: `recordingAttached` is true only for a `.gif` of at most 5 MiB created by that verify step.
8. PR comment: a passing verify in an `attachments` project posts one comment with verdict, head SHA, conclusion and thread link; a second poll or retry posts nothing; a failing verdict and a `repository` project post nothing; a GitHub error leaves the verdict stored.
9. Model: `run.sh` output unchanged against `expected.txt`.

## Rollout

Separate PRs, each off `main` after the previous one merges, each under about 1000 changed lines:

1. Project setting: column, migration, project record and settings API (tests 1).
2. Verify step: prompt, enqueue, daemon (tests 2 to 4). Until PR 3 lands, an `attachments` project whose patch needs a recording stays blocked by `recording-missing`; that is fail-closed.
3. Gate acceptance: gate inputs and `recording-missing` (tests 5 to 7, model run).
4. PR comment after a passing verify (test 8).

## Risks and limits

- The daemon cannot stop an agent from running `git push` itself during the step; the prompt forbids it and the rewind discards local commits, but a pushed commit would reach the branch. Accepted for now; tracked in #3514 (run verify steps without push credentials).
- Attachments are visible in cairn only; the PR comment gives GitHub reviewers the verdict and a link, not the files.
- Video recordings are not attachable; `.gif` is the only recording format in `attachments` projects.
