# Model chips — test parity and Devin effort migration

## User scenario

Open Settings → Models with an already connected account. Each runnable model gets ▶; a nonempty runnable row gets Test all. Clicking spends one short model turn per tested chip, using the chosen account's existing quota. Test all runs those turns sequentially on the same Runner. No new accounts, keys, settings, approvals, or paid upgrades are requested. Results stay in the popover; no task, history entry, or account verification is written.

## Scope

1. **Spacing.** The shared chip keeps its 24px hit targets, with at most 4px between ▶ and × instead of 6px. No change to row layout, account verification, visual hierarchy, sign-in, or picker interaction.
2. **Test parity.** The existing C22 control and result are shared across the five providers. Existing HTTP diagnostics are unchanged. New Devin/Antigravity diagnostic routes run a fixed, isolated one-turn ACP check on an authorized online Runner. Host login may use only its pinned Runner; OAuth and API key and Devin use the selected account, never a host login fallback. Use the cost tooltip and the explicit Test all click, like Claude: N chips means up to N independent quota-consuming calls; no automatic diagnostic on render, and no additional confirmation or pricing changes.
3. **Identity.** Devin's wire ID encodes effort. Normalize the three SWE families at catalog ingestion and put effort in the existing thinking field. Keep saved variants and historical invocations distinct. Normal task claims continue to carry qualified wire IDs, also to older Runners; only the new diagnostic is capability-gated. These are separate implementation/test slices covered by one plan because the Devin ▶ must run the precise variant for the newly grouped chip, and both changes roll out together. No other providers' routing changes.

## State and ownership

- Diagnostic: `routes-resources.ts` checks owner and team, then the selected subscription service validates the saved model. `subscription-model-turn.ts` reserves a 30 s cooldown per account/model, shared across browser tabs and users, with no result sharing. `runner-probe-queue.ts` either fails immediately (no eligible or free connection) or reserves one connection slot and starts a 35 s server timer before delivery. There is no waiting queue. `routes-machine.ts` permits one claim and one result on the original live connection after checking authorization again. Disconnect, abort, deadline, and completion clear the reservation; stale replies are rejected. The Runner's 30 s limit covers startup, model selection and prompt together. A nonempty assistant reply and a normal stop are required. Credentials, model output and raw errors never enter the result. Closing a popover or switching account does not cancel a turn already sent or copy a result to the new account. `scripts/product-surface-registry.json` registers the diagnostic capability independently of ordinary task claiming.
- Storage: `devin-subscriptions.ts` writes curated IDs; reads and Model Sources group them for the picker without changing historical records. `routing-rules.ts` hydrates each saved fallback independently and is the only fallback writer; it writes the ordered qualified IDs for pre-upgrade readers. Edits to unrelated fields do not resave fallbacks. Removing a *catalog choice* removes that curated family, not a routing override or any fallback. Saved fallbacks remain independent even when the live catalog shrinks. Project, task, and frequent choices keep their own effort and never inherit it from another saved record. `top-models.ts` reads and writes its own choices; exact qualified lookups precede canonical aliases. Historical run/usage/try IDs stay immutable; model labels can display a family while metering and retry keys remain the actual variant. This is a boundary translation, not a second persisted format or a temporary copy.
- Execution: `machine-claim-payload.ts` applies the same encoding for regular Coordinator and task claims. An existing qualified ID passes through. In `acp.ts` the Runner selects that exact model and surfaces upstream refusal if it is absent, rather than substituting a different effort. A plain upstream ID matching a known base is not counted as a second effort variant; the normalizer stays specific to the three SWE bases, not arbitrary provider IDs.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Spacing, desktop/mobile, light/dark, long name | Adjacent 24px hit targets; layout remains stable. On the parent, the measured gap is 6px, above the 4px bound. | `apps/web/e2e/provider-test-connection.spec.ts` — model chip actions sit together without shrinking their targets | this change |
| Closing a pending report | The reply can settle, but Escape keeps the popover closed; the parent reopened it. | `apps/web/e2e/provider-test-connection.spec.ts` — C22: dismissed model test report stays closed when the result arrives | this change |
| Model and batch controls, slow reply | Antigravity can send the named model, its held request displays checking, and completion displays the result; the parent had no button. | `apps/web/e2e/providers-antigravity-subscription-models.spec.ts` — Antigravity models have the same test action as other providers | this change |
| Test all has mixed success, failure, and cooldown | Each model reports its result; an immediate repeat returns not-run, never another request's result. The button itself is the explicit trigger for up to one turn per listed model. | `apps/web/e2e/providers-antigravity-subscription-models.spec.ts` — Antigravity Test all reports partial failure and a cooldown response per model | this change |
| Change subscription while a reply is pending | The old result stays scoped to the first selection; the new account's control starts its own request. | `apps/web/e2e/providers-antigravity-subscription-models.spec.ts` — switching subscriptions while an Antigravity probe is in flight does not leak its result | this change |
| No Runner or provider catalog only | A saved entry does not pass without a live Runner. Show the connect/update failure; do not try another account. | `apps/server/test/antigravity-subscriptions.test.ts` — a model test reports an unavailable Runner rather than passing from the saved catalog | this change |
| Bound host, duplicate from another tab or caller | Only the original connection can claim it. A duplicate request gets 429 while the first receives its own result. | `apps/server/test/antigravity-subscriptions.test.ts` — duplicate host model checks from separate requests are throttled rather than sharing the first result | this change |
| Account removed after Runner claim | The browser receives an auth failure; the Runner's success is rejected. | `apps/server/test/antigravity-subscriptions.test.ts` — deleting a host account mid-turn rejects the Runner result and fails the waiting request | this change |
| Wrong connection or authorization lost before claim | No credential crosses connections or leaves the server after authorization is withdrawn. | `apps/server/test/antigravity-subscriptions.test.ts` — wrong machine and stale connection cannot claim or finish another request; account revocation before claim or result prevents disclosure and success | this change |
| Runner disconnect and late reply | The slot becomes free; the late reply cannot complete a replacement test. | `apps/server/test/antigravity-subscriptions.test.ts` — disconnect releases the slot and a late reply cannot finish the replacement request | this change |
| ACP start delayed | The server's 35 s limit begins at dispatch, not at claim; the late result cannot change the timed-out report. | `apps/server/test/antigravity-subscriptions.test.ts` — total queue deadline starts at dispatch, not when the Runner claims the prompt | this change |
| Empty or malformed reply | An empty normal stop fails, rather than passing on successful initialization. | `apps/daemon/test/devin-acp.test.ts` — uses the selected model and requires a reply | this change |
| One or several published effort variants | The catalog sends one row per SWE family; the existing effort selector is hidden when there are no alternatives. | `apps/daemon/test/devin-acp.test.ts` — the Runner publishes SWE families without baking effort into their model identity | this change |
| Legacy curated ID | Read it as a family plus the original default effort; the parent returned the qualified ID. | `apps/server/test/devin-subscription-models.test.ts` — a legacy curated SWE variant is read as a model plus its original default effort | this change |
| An old Runner takes a task pinned to canonical model and effort | The seeded task sends `swe-2` plus high; the actual claim contains `swe-2-high` without requiring new Runner code. | `apps/server/test/devin-claim.test.ts` — an old Devin Runner receives the exact upstream ID for a canonical model and effort | this change |
| Two fallback efforts of one model | Medium, high, Adaptive remain separate and re-encode in that order even after an unrelated edit. | `apps/server/test/routing-rules.test.ts` — legacy Devin fallback order survives an unrelated route edit and saving the hydrated list | this change |
| A saved effort disappears from the active catalog | The selector may hide if only one choice remains; that does not erase a saved variant or its order. If selected and refused, the existing task failure and fallback path applies; choose a supported effort in Settings. | `apps/server/test/routing-rules.test.ts` — catalogue dropping a Devin fallback variant does not merge or remove stored variants | this change |
| Legacy case and off/none aliases hydrate to the same effort | Resaving keeps the original spelling of each existing entry; same-effort aliases are matched in prior order. | `apps/server/test/routing-rules.test.ts` — hydrated fallback aliases retain each original wire spelling in submitted order | this change |
| Old main model saved without a separate effort | The Settings response shows the family and its pinned effort; the stored row is not rewritten by a read. | `apps/server/test/routing-rules.test.ts` — a saved Devin model variant reads as a family with its pinned effort | this change |

## Out of scope

- Enrollment, sign-in, picker interaction, add-provider toast, quota accounting, unrelated aliases, and historical record rewrites. Existing fallback editing surfaces are unchanged; no new fallback editor.

## Review

- Verdict: PASS
- Fix-check: PASS
- Fix-check-Plan-SHA256: 0e14e5412ce0633bc1c579d88429086bc6ec3fdd18772782c865988435465c6b
- Plan-SHA256: 0e14e5412ce0633bc1c579d88429086bc6ec3fdd18772782c865988435465c6b
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: Pi fresh-context follow-up review at be77d913dafccfe350fd0b54c93e1aff5f76130e
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: All ten prior findings closed; no new security or data-loss findings.
