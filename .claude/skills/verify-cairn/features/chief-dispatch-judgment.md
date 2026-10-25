# chief dispatch judgment (#903 / ADR 0014)

Whether chief's `run_builds` dispatches a task plan-first or fix-directly = **chief's per-dispatch judgment** (the judgment belongs to the chief, no team settings slot; history in ADR 0014 "old ruling reversal record").
The server-side only mechanical guarantee = the default fail-safe: the `withPlan` parameter defaults to true plan-first (the unclear direction is "ask once more"). "Fix directly" only skips the plan-confirmation gate, the review gate is on the merge path and unrelated to this parameter (structurally unskippable). The judgment reason takes the `dispatchReason` parameter: it lands in the transcript (chief_message) with the tool call for audit, the response echoes it back verbatim; the prompt orders the chief to write "I judge fix-directly / plan-first, because X" in the receipt, the user can overturn it with one sentence in place and it only affects this once.
The criterion = the static charter prose of the system-prompt dispatch-judgment section (the Mika judgment-discipline original sentence + three judgeable signals), not a code rule table, not synthesized from any settings. The server-side failure modes are pinned in `apps/server/test/chief.test.ts` (#903 five tests: the PATCH slot dead state / the judgment-section static four elements / default plan-first / explicit false + reason echo / explicit true + reason echo), `orchestration-source.test.ts` B1, `packages/shared/test/chief-tools.test.ts` (the run_builds definition shape); the fixture face pinned in `apps/web/e2e/chief-settings.spec.ts` (the Agent tab no `派发方式` row zombie-control negative pin).

## Sub-features

- `settings-slot-dead` — the settings slot dead state, three faces: the settings Agent tab has no dispatch-mode row (the neighbor machine/compression-model rows alive); the GET chief envelope has no `dispatchWithPlan` key; PATCH that key alone -> 400 (five-slot refine), mixed with a legal slot -> the key stripped by zod.
- `judgment-prompt-section` — the claim payload `chief.systemPrompt`'s dispatch-judgment section + dispatch-receipt section: static text (unchanged across user charters), containing the Mika judgment-discipline original sentence ("ask only when the information would materially change the result, the method, the permissions or safety; otherwise decide yourself, and say what you decided"), three judgeable signals, the review gate always present, the dispatchReason obligation, the in-place one-sentence overturn only affecting this once; the full text has no hardcoded `withPlan:false` direct-execute instruction, no "dispatch mode (team settings" synthesis residue.
- `tool-judgment-params` — the claim payload's remoteTools `run_builds` definition properties contain `withPlan` + `dispatchReason` (both optional), required is only `['todoIds']` (absent = the judgment semantics, must not be required).
- `dispatch-effect` — the judgment effect's persisted face: `build.withPlan` + the first step's `step.kind` (plan-first = a plan step stopping at the confirm gate; fix-directly = a build step). The response echoes `withPlan` + `dispatchReason` (the default leg reason = null).

## How to get to it (user POV)

- Board `开始` -> the orchestration round -> chief judges the dispatch mode per dispatch, the receipt writes the judgment and reason.
- The user disagrees with the judgment -> overturn it with one sentence in the session (chief cancel_builds then re-dispatches the opposite mode).
- The chief-settings Agent tab no longer has a `派发方式` row (judgment is not a config item).
- Driving: this feature has no current case; all registered are judged stale, refused without `--force` (prints the reason on refusal), `vp.mjs list chief-dispatch-judgment` lists usage:
  - `vp.mjs drive chief-dispatch-judgment dispatch-judgment`: creating an agent without machineId 400s since ADR 0019.

## Driving it with drive-903-dispatch-judgment.mjs

Preconditions: `launch.mjs` already started the isolated stack (fresh DB); proxy env all unset.

- One-command full chain (12 assertions): `env -u http_proxy -u https_proxy -u all_proxy
  VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-903-dispatch-judgment.mjs`
  -> console PASS/FAIL + `evidence:<dir>` (result.json + 1 screenshot + 5 API/SQLite JSON).
- Chain: the browser pins the settings-slot dead state (U1) -> REST pins PATCH 400 + the envelope no-key (A1/A2) ->
  three legs each open a chief thread: the fake machine claims the chief step (E1 takes the systemPrompt judgment section +
  the tool-definition artifacts) -> relay run_builds (E1 default / E2 false+reason / E3 true+reason) ->
  response echo cross-check + SQLite build.withPlan/first-step kind cross-check -> relay cancel_builds
  closes the lane -> done chief step.
- Seeding all public REST (provider + agent + PATCH chief bind + project + three todos +
  api-key + machine enroll); zero daemon zero LLM, the chief-round data face same shape as a real machine
  (the drive-agent-identity seeding law).

## Gotchas

- The claim response is double-wrapped `{step:{step:{...}, chief, remoteTools}}` (the machine-wire law);
  the chief-step discriminator = `step.kind === 'chief'`, claiming a worker step = wrong order (each leg closes with
  done chief step then closes the worker step).
- The relay endpoint body = `{name, params}` (not `{arguments}`), the response = `{text}` (a JSON string,
  needs a second parse) - `routes-machine.ts`'s relay shape splits in the same path as the transcript delta/activity/row
  three shapes, discrimination by the params/id/kind keys.
- Each leg's run_builds first step (plan or build) is a pending worker step, not closed it gets taken by
  the next leg's claim (FIFO by createdAt). **Closing = within this leg's chief step relay
  `cancel_builds`** (the pending step DB direct-write marked failed); do not use "claim +
  done failed" - a machine reporting failed goes through finishStep's retry/replan semantics, generating a new
  pending step that pushes the next leg's claim askew (measured: E2 claim took the plan retry step).
- **The plan-first leg's relay must carry `assignment.plan`**: the plan step's executing agent resolves per
  assignment.plan, a step without a modelId is skipped by tryClaim ("unassigned Agent =
  not executable", machines.ts) - the step stays pending forever, any claim long-polls until the probe's 8s
  AbortSignal timeout, the symptom = DOMException TimeoutError not an assertion FAIL (hit in the
  first run).
- The prompt-judgment-section assertion uses the **original sentence substrings** (the JUDGMENT_MUSTS array),
  changing the prompt wording must sync the probe and chief.test.ts / orchestration-source.test.ts, the three canon sites.
- The negative pin on the `withPlan:false` literal: the judgment-section prose deliberately describes the parameter
  with the "withPlan=false" equals shape - the colon shape is the fingerprint of the #892 disease instruction, the two
  canon sites (unit test + probe) both pin not-contain, do not bring the colon shape back when changing the prompt.