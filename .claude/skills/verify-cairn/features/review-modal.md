# AI review launch full chain (detail-page composer, #312)

Users launch a round of AI review from a confirm- or review-gate todo's detail page: the composer shows an `AI 审核` button -> clicking opens the 560-wide modal (a search row + agent rows + an optional focus textarea + a `开始审核` primary button) -> pick an agent and launch -> the composer's placeholder is replaced with `AI 审核进行中…` and a launch row is inserted into the timeline. This is the second live surface of the detail page in the map. The launch + enqueue is provable through the API alone (drive-review.mjs, no daemon needed); **a real daemon executing the review step (claim -> done -> the verdict persisted) and the blocking auto-revision loop are covered by drive-review-blocking.mjs (see the Cross-reference at the end)**.

## Sub-features

- `review-button-visible` the `.composer-ai-review` renders clickable in the confirm/review phases; it does not render in other phases.
- `review-dialog-opens` clicking opens the 560-wide modal (a `[role="dialog"]` panel containing `style.width=560px`; since #952 the `.dlg-shell` class name retired, the exit-visibility bridge inlined as a utility on the component), with the title `AI 审核`, a subtitle, a search row, the agent-row list, an optional focus textarea, and the `开始审核` primary button centered.
- `agent-list-source` the agent rows = the members read surface's `memberType:"agent"` rows, avatars = initials (no actor-avatar surface), subtitles = `modelId ?? '默认'`.
- `selected-row-style` the selected row wears `data-on="true"` with bg-indigo-500/10 (r8 §2.5 measured).
- `focus-textarea-optional` the focus textarea may be left empty (dialog-scope `getByRole('textbox')`; since #951 the `.review-focus-input` class hook retired), an empty string is treated by the server as unfilled (the REV-ticket-A focus-trim semantics).
- `review-submitted` clicking `开始审核` -> POST `/api/builds/{id}/steps {action:'review', agentId, focus?}` -> the modal closes -> the composer placeholder is replaced with `AI 审核进行中…` -> a `REVIEW_ANNOUNCEMENT` row appears at the top of the transcript + a `kind:'review'` step is enqueued in the step table + the phase does not move.
- `phase-guard-409` calling that endpoint outside the confirm/review phases -> 409 (`todo/queued/planning/building/done/failed/closed` are all refused).

## How to get to it (user POV)

- The task detail page (`/app/todo/:id`) in the confirm or review phase -> the `AI 审核` button at the composer's bottom-right (the only entry; it does not render in other phases).
- Driving (`vp.mjs list review-modal` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive review-modal empty-review`: the review and merge rows of an empty-change task (carries the post-fix switch `--expect=after` by default).
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive review-modal failed-review-restore` (agent creation without machineId, 400 since ADR 0019); `vp.mjs drive review-modal review-launch` (its dependency setup-review-seed.mjs creates the agent without machineId, 400 since ADR 0019).

## Driving it with verify-cairn

Preconditions (simpler than stop-button, no daemon + gated stub needed):

1. `launch.mjs` brings the isolated stack up (server + web), `doctor.mjs` fully PASS.
2. Seed (provider/agent/project/todo + a machine walking the plan to completion):
   - `GET /api/teams` for the teamId;
   - `POST /api/teams/{t}/providers` `{providerId:"stub-gw",label,baseUrl:"http://127.0.0.1:9/v1",api:"openai-completions",authHeader:true,compat:{supportsDeveloperRole:false},models:[{id:"stub-model",name:"stub-model"}]}` (need not be reachable, just the seed data surface);
   - `POST /api/teams/{t}/agents` `{displayName:"verify-builder",provider:"stub-gw",modelId:"stub-model"}`;
   - `POST /api/projects` + `POST /api/projects/{p}/todos` to create the probe task (note the todoId);
   - `POST /api/projects/{p}/builds` to start the build (with a plan);
   - `POST /api/machine/enroll` to register the machine -> take the machineToken;
   - `POST /api/machine/tasks/claim` to claim the plan step;
   - `POST /api/machine/upload-urls/{stepId}` for the upload URL + PUT the plan.md content;
   - `POST /api/machine/done/{stepId}` to mark the plan succeeded -> the phase advances to confirm.

- **Full chain.** Run `REVIEW_MACHINE_TOKEN=<the seed's machineToken> node <skill>/scripts/drive-review.mjs <todoId>` (run from the repo root so @playwright/test resolves). **The token is mandatory** — the last two machine-side checks (claim the review step + done) go through the real endpoints; without the token, `Authorization: Bearer undefined` claims no step and the two go red (stepped on in practice, do not misjudge it as a product defect). It walks the full chain: the detail page loads -> `.composer-ai-review` appears (screenshot 01) -> click to open the modal, asserting the 560 width + the title + the visible agent rows (screenshot 02) -> select the default agent (screenshot 03) -> click `开始审核` -> the modal closes, the composer placeholder is replaced with `AI 审核进行中…`, a REVIEW_ANNOUNCEMENT row appears at the top of the transcript (screenshot 04) -> three-surface truth: the API (`GET /api/builds/{id}/steps` contains the kind:'review' pending step + the phase is still confirm) + SQLite (the `step` table contains a kind='review' row + at least one REVIEW_ANNOUNCEMENT row) -> the API terminal state: simulate the machine claiming + done(success) -> the REVIEW_COMPLETE_PLACEHOLDER message lands + the phase is still confirm. Evidence `result.json` 12 checks.
- **Close.** `cleanup.mjs` reaps the stack (there is no fourth process). The scratch home needs no manual cleanup.

## Gotchas

- The modal's 560 width is the r8 §2.5 explicit-width rule (the detail/composer detail-dialog family is the 448 family, the review modal is its own 560 family): assert `style.width === '560px'`, not a library default.
- The agent rows are the `memberType:"agent"` rows; the `memberType:"user"` row (Owner) is not shown — do not count by `members.length`.
- The `开始审核` primary button: the copy must strictly match `开始审核` (the i18n zh default); en.ts has the synced key `Start review`. A phase-wrong click = the endpoint 409s (no local interception needed).
- The composer-placeholder switch is not the button being disabled — the button stays visible; the placeholder-text switch is the only visual signal of the in-review state (there is no progress-bar surface).
- The transcript REVIEW_ANNOUNCEMENT row = `role:'user'` + `content === REVIEW_ANNOUNCEMENT` (the shared/records single-source constant); do not look for the copy in the endpoint logs.
- The terminal-state closed loop needs enroll + claim + done all walking the machine API once (the probe carries its own helper); do not skip it — otherwise the placeholder closed loop before real findings ship is not proven.
- **The closing contract is the verdict JSON, not the copy** (measured calibration): a review-step done lands a JSON-encoded system message of `{"kind":"review_verdict","verdict":{conclusion,findings}}` (#330/PR #332 replaced the pure-copy placeholder `AI 审核已完成` from the #312 era); when the daemon does not return findings, the empty-verdict fallback applies (conclusion = `审核未返回结论`). The probe once asserted the old copy and was rewritten on 2026-09-28 after measuring that only the verdict JSON exists in the DB — do not treat "cannot find `AI 审核已完成`" as a defect again.
- Re-verification = relaunch + re-seed + a new probe task (the provider/agent/api-key idempotency is not guaranteed, do not reuse an old stack).

## Cross-reference

- **The blocking auto-revision loop (#330/#332)** = this feature's downstream extension, with its own dedicated probe `scripts/drive-review-blocking.mjs` (needs the `REVIEW_MACHINE_TOKEN` env, output by the seed). It verifies: the review step claimed -> done by a real daemon -> the findings contain a blocking verdict -> the `REVIEW_VERDICT_KIND` message row lands (conclusion + numbered findings) -> the phase turns planning (the auto-revision loop) -> the edit_plan adjustment-summary row. Evidence `2026-09-27T02-46-23-223Z-review-blocking/result.json` (23 checks allOk=true).
- **A real daemon executing the review step** (not an API simulation): measured in this session on 2026-09-28 — a confirm-phase todo -> the UI launches the review -> the `review` step goes `claimed` -> `done` in the daemon -> the conversation lands a `{"kind":"review_verdict",...}` message. When the stub has no real findings, verdict = `审核未返回结论` with findings=[], the phase stays confirm and does not trigger revision (triggering revision needs drive-review-blocking's special stub responses).
- Selector note for the launch surface: the button's aria-label for `review-button-visible` = `AI 审核` (`button[aria-label="AI 审核"]`), not the `.composer-ai-review` class (drive-review.mjs locates it by aria-label).
