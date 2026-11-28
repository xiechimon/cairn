# Done in Production: Evidence-Gated Task Completion — plan, 2026-11-28

Research: [`docs/research/done-in-prod-evidence-2026-11-28.md`](../research/done-in-prod-evidence-2026-11-28.md). Builds on [`docs/design/task-guidance-plan-2026-11-27.md`](task-guidance-plan-2026-11-27.md) and [`docs/design/stall-monitor.md`](stall-monitor.md) (#19).

## User scenario

When a newcomer creates a Cairn task to fix a bug, change an API/CLI/library, or update the UI, the task runs end-to-end inside its single `session` harness (no separate verifier agent or extra pipeline step). Before a non-doc change task can settle as `done`, `evaluateStepAcceptance` treats uploaded `attach_file` artifacts as the human-reviewable proof record alongside four deterministic verification bindings:

1. **Post-edit target execution**: every non-doc code edit (including UI edits) must run a meaningful passing post-edit command (`c.idx > lastEditIdx`, not lint-only) so re-uploading an old screenshot or stale file without running the app fails.
2. **Delivered version / commit binding**: when `expectedCommit` (>= 7 hex chars) is present, any post-edit output reporting deployed SHAs must match `expectedCommit`, and any post-edit probe against a remote (non-loopback) `http://`/`https://` URL, `/api/server/deploy`, or deployed/production verification claim must observe `expectedCommit` in post-edit tool output; standalone local tasks without a remote target or deploy claim bind to the local running target.
3. **Affected-path binding**: non-health API edits reject probes hitting only `/health`, `/healthz`, `/ping`, or `/ready`, and mixed UI + API edits must pass every changed surface.
4. **Assertion-outcome binding**: the latest post-edit verification output must pass cleanly without `AssertionError`, `FAIL `, or HTTP 5xx markers (`HTTP/1.1 5` / `HTTP/2 5`).

Pure doc/config-only edits continue using post-edit read-back/validation without redundant uploads, and info/report or read-only checks keep their existing behavior. The user needs zero new accounts, API keys, settings, or `CAIRN_*` env vars; proof files live in `attachment` and appear inline in the thread. If any binding or fresh non-empty (`sizeBytes > 0`) proof fails, Cairn keeps the task out of `done`: it nudges the same `session` harness once, and if still missing or blocked opens a `needs_input` `QuestionCard` while showing what is still missing in one line on the task row and thread status line.

| Scenario | What the user sees | What the system does | Wait & cost |
|---|---|---|---|
| **Code change verified on target with all 4 bindings + attached proof** | Thread finishes `done` with inline screenshot, request/response, DB row, or run output; zero `verify` steps. | `evaluateStepAcceptance` confirms post-edit execution, non-health affected route, clean assertion output, matching deployed SHA (when remote/deploy-claimed), and a fresh (`call.idx > lastEditIdx` or `createdAt > lastEditAt`) non-empty (`sizeBytes > 0`) `scope = 'message'` attachment from the current attempt. | 0 extra steps. |
| **Missing, 0-byte, stale, fixture-only, health-only, 5xx/AssertionError, or wrong/unverified-version proof** | Task stays in `building` showing `Missing: <one-line reason>`, gets 1 bounded nudge in the same `session`, then pauses in `needs_input` if still missing. | `build-step-complete.ts` enqueues at most 1 `continue` turn (`isAcceptanceNudgePrompt`) and pushes live `hub.publishTodoDoc`; on 2nd failure opens `acceptance-blocked-<stepId>`. | Max 1 extra turn; 0 verifier agents. |
| **Environment/push blocker (`spawn EPERM`, `attach_file` blocked, unpushed auth)** | Task enters `needs_input` immediately with one-line `Missing: ...` and actionable `QuestionCard`. | Non-retryable evaluation opens `acceptance-blocked-<stepId>` immediately (0 wasted nudges), protected from abandoned sweeps by `isStepWaitingPermission`. | 0 wasted retries. |
| **Verification retry stalls mid-check (#19 reuse)** | 1st silence requeues once with missing-evidence note; 2nd silence stays `claimed` and posts one alert naming what is missing so user can inspect/steer/stop. | `sweepStallMonitor` (`stall-monitor.ts`) appends `parseMissingEvidenceLine` context on claimed `isAcceptanceNudgePrompt` steps. | Reuses 60s sweep. |
| **Pure doc/config edit, info/report task, or read-only check** | Doc edits settle `done` after read-back/validation; info/report tasks settle `review`; read-only checks settle `done`. | Preserves `docOnly`, `isInfoOutput(input.output)`, and `!madeCodeOrDocEdits` paths without forcing hollow uploads. | Unchanged. |

## Scope

1. **Shared acceptance contract (`packages/shared/src/records/acceptance.ts`, `packages/shared/src/records/todo.ts`, `packages/shared/src/records/index.ts`)**:
   - Extend `AcceptanceFailureReason` with `'missing-evidence' | 'stale-evidence' | 'stale-deployed-target' | 'unverified-deployed-target'`, add `sizeBytes?: number | undefined` to `AcceptanceAttachment`, add `expectedCommit?: string | null | undefined` to `EvaluateStepAcceptanceInput`, and add single-line `missingLine: string` (no newlines, <= 140 chars) to failed `AcceptanceEvaluation` results. Export `parseMissingEvidenceLine(text)` to extract a sanitized single-line reason from `Missing:` or `Missing real acceptance:`.
   - Enforce `typeof a.sizeBytes === 'number' && a.sizeBytes > 0` fail-closed on all acceptance attachments (`missing-ui-screenshot` / `missing-evidence`).
   - Enforce post-edit execution on every non-doc code change (including UI edits: `attach_file` alone with zero post-edit execution commands fails) and fail `failing-check` if the latest post-edit verification command output contains `AssertionError`, `FAIL `, `HTTP/1.1 5`, or `HTTP/2 5` even when `isError` is false.
   - Enforce non-health API probes: if `effectivePaths` touches API paths other than health/ping/ready files, post-edit HTTP/command probes that hit ONLY `/health`, `/healthz`, `/ping`, or `/ready` fail with `unverified-api`.
   - Enforce deployed-target SHA binding when `expectedCommit` (>= 7 hex chars) is present:
     - `stale-deployed-target`: if post-edit tool outputs report deployed SHAs (`"deployedSha"`, `"deployed_sha"`, `DEPLOYED_SHA=`, or `/api/server/deploy` `"deployed":{..."sha":"..."}`) and none prefix-matches `expectedCommit`, fail with `missingLine: 'Deployed target is running an older commit; wait for deploy and re-verify'`.
     - `unverified-deployed-target`: if any post-edit command probes a remote (non-loopback) `http://`/`https://` URL, probes `/api/server/deploy`, or assistant prose / `attach_file` caption claims deployed/production verification (`verified in prod`, `deployed to prod`, `checked deployed target`, `已在生产验证`, etc.), yet no post-edit tool output observed `expectedCommit` (prefix >= 7 hex chars), fail with `missingLine: 'Claimed or probed deployed target without observing the expected commit SHA'`.
   - Enforce strict attempt freshness (`call.idx > lastEditIdx` for transcript-matched `attach_file` calls; fallback `att.createdAt > lastEditAt` when unmatched) so same-millisecond pre-edit uploads cannot pass.
   - Require fresh non-empty step-scoped attachments for UI (`isUiPath`), API (`isApiPath`), CLI/daemon/script (`isCliPath`), and other non-doc code edits (e.g. `packages/shared/src/*`). Run ALL applicable checks on mixed edits (e.g. UI + API checks both run independently). Keep `docOnly`, `isInfoOutput`, and `!madeCodeOrDocEdits` paths free of forced file uploads.
   - Add `missingEvidence: z.string().nullable().optional()` to `todoRecordSchema` in `packages/shared/src/records/todo.ts` (and update `packages/shared/test/__snapshots__/snapshot.test.ts.snap`).
2. **Unified single-harness prompts (`packages/shared/src/records/prompts.ts`, `apps/daemon/src/step-prompt.ts`)**:
   - Archive current `SESSION_BRIEF` and `SESSION_REWORK_BRIEF` into `LEGACY_SESSION_BRIEFS` and `LEGACY_SESSION_REWORK_BRIEFS` so `backfillTranscriptOrigins` continues tagging historical rows `synthetic`.
   - Update `SESSION_BRIEF`, `SESSION_REWORK_BRIEF`, `buildAcceptanceNudgePrompt`, and `composeWorkerSystemPrompt` so the task's own `session` step verifies the running/deployed target (confirming the delivered commit/change is live), walks the changed journey, and attaches proof (`attach_file`: screenshot, redacted request/response, DB row, or run output) without any separate verifier agent.
3. **Server completion, attempt scoping, authoritative `missingEvidence` projection, and stall-monitor (#19) reuse (`apps/server/src/services/`)**:
   - `build-step-complete.ts`:
     - Scope `attemptStepIds` strictly to the current attempt (`buildSteps.slice(rootIdx).filter((s) => isBuildStepKind(s.kind)).map((s) => s.id)` where `rootIdx` walks back only across contiguous `isAcceptanceNudgePrompt` steps); scope `buildMessages` to `>= attemptRoot.createdAt` when `rootIdx > 0` or scheduled, else after `lastPlanFinishedAt`; query `attachment` filtered by `eq(attachment.todoId, todoRow.id)` and `eq(attachment.scope, 'message')` selecting `sizeBytes`.
     - Pass `expectedCommit: stepRow.checkpointCommit` to `evaluateStepAcceptance`.
     - When enqueuing an acceptance nudge step (`buildAcceptanceNudgePrompt`), publish updated `TodoRecord` via `deps.hub.publishTodoDoc(todoRow.teamId, fresh)` inside post-commit effects even when `todoRow.phase` remains `'building'`.
   - `build-undelivered.ts`: format `Missing: ${evaluation.missingLine}` in `askAcceptanceBlockedOnce`. Do NOT modify `build.reportLine` (keeps `thread_report` as its sole writer).
   - `todos.ts`: derive `missingEvidence` in `todoRelations` ONLY when `row.phase` is `'needs_input'`, `'building'`, or `'queued'`:
     - `needs_input`: newest pending `message` on `latestBuildId` with `id LIKE 'acceptance-blocked-%'` and `status === 'pending'`, parsed via `parseMissingEvidenceLine` (fallback: first non-empty line <= 140 chars).
     - `building` / `queued`: newest `pending`/`claimed` `step` on `latestBuildId` matching `isAcceptanceNudgePrompt`, parsed via `parseMissingEvidenceLine`.
     - Always `undefined` on `done`, `closed`, `failed`, `stopped`, `review`, `todo`.
   - `stall-monitor.ts`: when posting a stall recovery or alert note on a claimed worker step matching `isAcceptanceNudgePrompt(current.prompt)`, append the `parseMissingEvidenceLine` context so stalled verification retries show what evidence is still missing; pending `acceptance-blocked-*` waits remain protected by `isStepWaitingPermission`.
4. **Web UI one-line missing indicator (`apps/web/src/`)**:
   - Map `missingEvidence` in `apps/web/src/fixtures/records.ts` and `apps/web/src/api/mappers.ts`.
   - Render `还缺：{missing}` (`Missing: {missing}` in `apps/web/src/i18n/en.ts`) in `tasks-sections.ts` (`taskRowCopy`), `tasks-panel.tsx` (`showWhat`), and `side-chat.tsx` (via pure helper `statusLineMeta`), preserving priority: retry / quota / platformWait > `missingEvidence` > coordinator / updates / default copy, and showing nothing when `done` or absent.
5. **Explicit scope boundaries (unchanged)**:
   - Worker task completion (`completeStep` on `isBuildStepKind`) is the boundary enforced here; external GitHub PR merge reconciliation (`ci-pr-rounds.ts`, `ci-grind-outcome.ts`, `build-github-merge.ts`), manual `markDone`, `build.reportLine`, and legacy `ci-pr-rounds.ts` cleanup remain untouched. Zero DB migrations, zero new `CAIRN_*` env vars/settings, zero new board phases/columns.

## States, readers, writers, and exits

- **Single authoritative missing reason:** Derived in `apps/server/src/services/todos.ts` from `acceptance-blocked-<stepId>` (`message` written once by `build-undelivered.ts`, cleared to `answered`/`cancelled` by `worker-questions.ts` or `build-steer.ts`) or active `isAcceptanceNudgePrompt` (`step` written by `build-step-complete.ts`, ended by `finishStep` / `applyStepFailure` / `applyStoppedStep`). Never persisted in a duplicate column and never written into `build.reportLine`.
- **Live UI sync:** `publishTodoDoc` fires on phase entry (`setTodoPhase` on `needs_input`/`done`) AND explicitly in `build-step-complete.ts` when an acceptance nudge step is enqueued while `phase === 'building'`, plus on `settleQuestionAnswers` / `sendBuildSteer` resume.
- **UI precedence:** `tasks-sections.ts` (`working`: `retryPhrase` > `quotaWait` / `waitingOn.quota` > `missingEvidence` > `owner === 'coordinator'` > default; `needs_input`: `confirm` > `missingEvidence` > default); `side-chat.tsx` (`StatusLine`: `platformWait` > `retryText` > `quotaHeld` > `missingEvidence` > `updates` / `relativeTime`).
- **Preserved invariants and exits:** Unanswered `QuestionCard` remains `needs_input` with `missingEvidence`; answering and unblocking finishes `done` and clears `missingEvidence`; answering while still blocked opens a fresh `acceptance-blocked-<newStepId>` and hands off to the owner on Coordinator repeat (`coordinatorAcceptanceBlockedExhausted`); pending ordinary worker questions or undelivered answers skip acceptance checks; `Not delivered` and blocker precedence stay intact; worker `failed`/`stopped`, archive, stop, stale build, duplicate `/done` replay, no-runner (`waitingOn: machine`), `waiting_quota`, `docOnly` read-back, read-only `!madeCodeOrDocEdits`, and `info`/`report` -> `review` flows remain intact.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| UI edit attaching a screenshot with zero post-edit execution, or 0-byte / `sizeBytes: undefined` upload | Fails closed (`missing-ui-screenshot` / `missing-evidence`) with single-line `missingLine`, never settles `done` | `packages/shared/test/done-in-prod-acceptance.test.ts` | this change |
| Non-health API edit probed only via `/health` + `health.json`, observed `deployedSha` mismatches `expectedCommit`, remote URL probe or prod claim without observing `expectedCommit`, or post-edit output with `HTTP/1.1 500` / `AssertionError` | Rejected with `unverified-api`, `stale-deployed-target`, `unverified-deployed-target`, or `failing-check` and single-line `missingLine`; passes when matching SHA, clean assertion, and non-health probe are observed | `packages/shared/test/done-in-prod-acceptance.test.ts` | this change |
| CLI/script/general code (`packages/shared/src/...`) edit without attachment, same-ms pre-edit upload (`idx <= lastEditIdx`), or mixed UI+API partial proof vs `docOnly` read-back | Non-doc code requires post-edit execution + fresh non-empty proof across every changed kind; same-ms pre-edit fails (`stale-evidence`); `docOnly` passes on read-back | `packages/shared/test/done-in-prod-acceptance.test.ts` | this change |
| `parseMissingEvidenceLine` + updated `SESSION_BRIEF` / `SESSION_REWORK_BRIEF` + archived `LEGACY_*` | Single-line missing reason parsed cleanly; prompts instruct single-harness deployed-target verification + `attach_file`; old briefs stay in `LEGACY_*` | `packages/shared/test/done-in-prod-acceptance.test.ts` | this change |
| Live SSE push on nudge (`building`), `missingEvidence` projection on `GET /api/todos` & `GET /api/tasks` in `building`/`needs_input`, cleared on `done`, `reportLine` untouched | Task list & thread receive `missingEvidence` via SSE during retry and in `needs_input`, preserve `reportLine`, and clear `missingEvidence` once `done` (0 `verify` steps) | `apps/server/test/done-in-prod.test.ts` | this change |
| Attempt isolation: prior `plan` step, earlier rework round, other todo, `deliverable` scope, or 0-byte attachment vs `attachWorkerFile` upload | Stale/deliverable/other-todo/0-byte attachments never satisfy current edit attempt; fresh `attachWorkerFile` settles `done` | `apps/server/test/done-in-prod.test.ts` | this change |
| Stall monitor (#19) on acceptance-retry step: 1st silence requeues with `missingEvidence`, 2nd silence stays `claimed` with deduped alert naming what is missing, plus `LEGACY_SESSION_BRIEFS` backfill `synthetic` | Stall notes include missing-evidence context without infinite restarts; archived previous briefs backfill `synthetic` | `apps/server/test/done-in-prod.test.ts` | this change |
| Web UI `toDisplayTodo`, `taskRowCopy`, `statusLineMeta`, and `EN` translation for `missingEvidence` | Task row and thread `StatusLine` show `还缺：{missing}` / `Missing: {missing}` with retry/quota/platformWait precedence and omit when `done` or absent | `apps/web/test/done-in-prod-ui.test.ts` | this change |

## Out of scope

- Any Drizzle schema migration or new database columns.
- Any new `CAIRN_*` env vars, settings toggles, board columns, or task phases.
- Separate verifier agents or re-enabling `step.kind = 'verify'`.
- External GitHub PR merge reconciliation (`ci-pr-rounds.ts`, `ci-grind-outcome.ts`, `build-github-merge.ts`) or `ci-pr-rounds.ts` legacy cleanup.
- Shipping owner-personal deploy scripts or machine addresses in product prompts; standalone local tasks bind to the local running target, and waiting for unregistered external deploy pipelines or semantic UI depth beyond deterministic assertions remains prompt-guided and human-reviewed via attached proof.

## Review

- Verdict: PASS
- Plan-SHA256: f242ef85c5e9a68f449587533181dfd039649f0c2cdac0a1d8812e9b4aaae534
- Author-Model: gemini-4-neon
- Reviewer: pi-codex-low
- Reviewer-Model: openai-codex/gpt-6.2-sol
- Findings: 0 blocking remaining; all 7 findings from initial plan review addressed and confirmed
