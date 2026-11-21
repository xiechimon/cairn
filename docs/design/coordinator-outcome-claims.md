# Coordinator outcome claims (#5426)

The Coordinator told the owner the change was merged at 06:32 while the merge step it had just requested only finished at 06:38. `merge_builds` had returned `{"merged": [buildId]}` at request time, and nothing checked the sentence the model then wrote. The earlier fix (`3306b7972`) added a sentence to the settle wake ("a done task does not itself mean the branch or PR is merged"); it held only for the settle turn and only for the model's willingness to obey, which is why the same mistake came back through a different turn.

## Bug class

An outcome claim without a state transition: a surface reports, or lets the model report, a terminal state (`merged`, `landed`, `pushed`, `deployed`, `tests passing`, `cancelled`) that the server has not recorded. Siblings found in the same search:

- `merge_builds` in `chief-tools.ts` and `mcp-face.ts` returned `{merged}` for a merge that was only queued; the GitHub path threw away `result.kind`, so an unclear answer also came back as `merged`.
- the MCP face had the same payload;
- `cancel_builds` reported `cancelled` for a build whose running step only had a stop delegated;
- `ask_user` put the same unchecked prose in front of the user as question text;
- prose anywhere in a Coordinator turn could assert any of these states.

## States and who writes them

| outcome | recorded state | written by |
|---|---|---|
| merged / landed | `autonomous_merge_admission.state='merged'`, or `thread_pr.state='merged'`, or `step.kind='merge' AND step.status='done'` **only when the step is not a local merge and the build is not PR-linked** | the merge step's report (`machine-finish-step.ts`, `applyLocalMergeReport`), the GitHub merge (`build-github-merge.ts`), PR reconciliation |
| merge in flight | a merge step in `pending`/`claimed`/`waiting_quota`; a done merge step on a PR-linked build whose PR is not yet recorded `merged` | `requestMerge` (`enqueueStep`, `enqueueLocalMerge`); the settle path defers to GitHub reconciliation |
| merge failed | a merge step `failed`/`stopped`, or a done local-merge step with no `merged` admission (the machine refused or held) | `applyStepFailure`, `applyStoppedStep`, `stopStepKeepPhase`, `applyLocalMergeReport` |
| pushed | a `done` step carrying `checkpointCommit` | `machine-finish-step.ts` |
| deployed | no record for a task | — |
| tests passing | no record for a task | — |

A merge step `done` is not itself proof of a merge: `applyLocalMergeReport` marks the step `done` for refused outcomes too (the `merged` admission is the record), and a step on a build whose PR is on GitHub defers the truth to `thread_pr` / the admission, which reconciliation writes.

## Paths

1. **Tool result** (`apps/server/src/services/build-merge-request.ts`): `requestMerge` now returns `{state:'merged'|'requested'|'unconfirmed'}` plus the PR number, commit or merge step id. `merge_builds` returns `{merges:[…], note}` and never a bare `merged` array. `cancel_builds` returns `{cancels:[{buildId,state}], note}` with the real `cancelBuild` outcome (`stopped`/`delegated`/`released`) instead of `cancelled`. The REST route keeps its `202 {delegated:true}` wire for the web.
2. **Tool gate** (`notify_user`, `ask_user`): `assertGroundedClaims` refuses the call with `409` when the message or the question asserts an outcome the record does not confirm, and names the recorded state in the error so the retry is grounded.
3. **Prose, stored** (`storedChiefMessage` in `chief.ts`): every assistant text block passes `rewriteTerminalClaims` before it is stored, and `chiefMessageStored` compares against the same rewrite so idempotency does not break. The row the browser renders is the grounded one.
4. **Prose, streamed** (`reportTranscriptDelta` in `machines.ts`): a per-step shield holds only the suffix that could still complete a claim — a proper prefix of a claim phrase, or a latin claim whose word boundary is undecidable — so ordinary prose paints immediately while a claim split across deltas is still caught and replaced before `publishTextDelta`; the shield flushes into the stream whenever any row for that step arrives.
5. **Transition card** (`merge-announcement.ts`): when a merge settles — step done (landed, or "the PR's state is the source of truth"), failed, stopped, or a local merge the machine refused — the server writes a `chief_notice` into the Coordinator thread, so the owner learns the outcome at the moment it happens instead of from the model. The notice resolves the coordinator thread read-only (`chief-rows.ts`): a team with no coordinator thread has no surface reading coordinator prose, so the card is skipped rather than creating a thread to hold it.

Classification (`packages/shared/src/records/terminal-claims.ts`) is phrase based, Chinese and English, and skips fenced code. A claim that names its source ("the task report says…") is allowed only for outcomes the server cannot record (`tests`, `deployed`); a merge, landing or push claim needs the record itself, because attribution would otherwise be an escape hatch for exactly this bug.

## Failures

- No task can be resolved from the turn (no `todo:` reference, no recent thread reference): facts are empty, so a terminal claim is treated as unbacked — the safe direction.
- A claim the record confirms passes untouched.
- A rewrite only replaces the phrase; the surrounding sentence keeps its meaning and the recorded state is spelled out (in flight / failed / not started).

## Tests

- `apps/server/test/coordinator-merge-claim.test.ts` replays the 06:32 turn: the tool result carries `requested` and the queued step, `notify_user` with the recorded 06:32 sentence is refused with the recorded state, the stored assistant row and the delta stream never show the merged phrase, the same reply passes once the step reports done, the transition card exists, a push claim without a recorded commit is refused, and a done-but-refused local merge or a done merge step on a PR-linked build still cannot back a merged claim. All fail on the pre-fix code.
- `packages/shared/test/terminal-claims.test.ts` covers detection, attribution, rewrites and the streaming shield.
- `apps/server/test/pr-merge-api.test.ts`, `chief-dispatch.test.ts` and `local-merge-landing.test.ts` pin the new `requestMerge` outcome per path (GitHub merged, unclear, queued step).

## Known limits

- The model can still repeat a task report's wrong claim if it attributes it ("the task report says the merge finished"). The record-backed classes are ours; report content is the thread's.
- A claim phrased outside the phrase list ("the change is already running in prod") is not caught; the list is the place to extend when a new phrasing shows up.
- The shield is best effort for paint order; the stored row is the authoritative text.
