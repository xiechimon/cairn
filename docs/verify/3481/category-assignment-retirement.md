# #3481 · Generic category assignment retirement

## Scope and invariant

All current task-category assignment writers are removed. Retired `tagIds` fail before creating or changing tasks, cited requests, classification, associations, schedules or builds. Existing legacy reads/classification and validated move cleanup remain until final data removal. Dedicated GitHub labels, ordinary naming, owner edits, Coordinator summary authority and unrelated ignored REST/MCP keys remain unchanged. No schema/dependency change.

## Runtime proof

[Before card](assignment-live-before/card-requests.md) ran actual production `apps/server/src/index.ts` at base `8fea96eac6bd131d1880038496482c7ab0bba02a` in a separate detached checkout, not reverted implementation code. [After card](assignment-live-after/card-requests.md) ran the implementation. Inspected screenshots are on asset-only commit `191ba0503eae954c362a4c85863d26656195c5b8`; text identifiers are redacted. Raw transcripts remain scratch-only.

| Path / state | Baseline / negative control | After |
|---|---|---|
| REST create with `tagIds: []` | 201; task count 2 to 3 | 400; task count 2 to 2 |
| REST update with title and `tagIds: []` | 200; title/version change and explicit unassignment | 400; exact existing title/version/classification preserved |
| REST create/update malformed/empty/populated assignments | Former writer retained | 8 direct HTTP rejections, complete state unchanged |
| MCP create/update | Source audit: update accepted category assignment; create ignored the unsupported key | 8 actual SDK HTTP `tools/call` errors; task state unchanged |
| Coordinator create/update relay | Source audit: update accepted assignment; create was already strict | 8 authenticated machine HTTP rejections with 400 |
| Claude SDK Coordinator create/update | Negative control with the retired field removed: SDK raw shape strips it | 8 real SDK in-memory calls reach production HTTP rejection with 400 |
| Valid plain creation and owner edit | Supported | 201/200; placeholder derivation and unrelated-key compatibility preserved |
| Valid Coordinator SDK summary | Supported | 200; full owner request unchanged except intended title attribution |
| Legacy correction and dedicated label | Existing data retained | Both legacy memberships/classification and dedicated label retained; completion 409; private flag absent from public record |
| Foreign keys | Clean | Clean |

Only the first two rows have live base captures; the other rows are after-state checks or the separately executed SDK negative controls.

The old assignment was intentionally supported: removing its legacy category cleared classification. This is a before-state observation, not a claim of an unauthorized guard bypass. The new contract rejects that stale field instead of treating it as an unassignment.

[Before observations](assignment-live-before/result.json), [after observations](assignment-live-after/result.json) and the [reproducible probe](assignment-probe.mts) contain no credentials. The production probe and its stronger full-request assertion were rerun successfully in an independent scratch home. MCP uses an actual scoped API key; Coordinator HTTP uses an enrolled machine token and a directly inserted claimed-step fixture. No model, Claude CLI or GitHub request ran. A real model-driven Coordinator turn and authenticated external-browser access are not claimed.

Reproduce from the checkout root: inspect `lsof -iTCP:18798 -sTCP:LISTEN`, leave any holder running and choose another `ASSIGNMENT_PROBE_PORT` if needed. Set isolated `CAIRN_TEST_TEMP_ROOT` and run `node apps/server/node_modules/tsx/dist/cli.mjs docs/verify/3481/assignment-probe.mts after`. Copy the same probe to the same relative path in the pinned base checkout and run `before` for the negative control. Dependencies were installed there with scripts disabled and a frozen lockfile. The probe uses owned processes and checks API identity against its scratch database before writes. Never target a user's live server. Redact runtime identifiers before publishing generated text and run the staged public-content gate.

## Regression proof

- First red: 14 failures across actual REST, Coordinator, request-helper, service, MCP and discovery paths; two existing compatibility cases already passed.
- With canonical guards but the old MCP registration, exactly both SDK calls still failed: input stripping bypassed rejection. With the old Claude host registration, both Coordinator forwarding cases failed with the missing `tagIds` in the relay spy.
- Twelve task-write entry points now reject four stale shapes for ordinary and sealed-owner records, comparing complete tasks, category/label rows and links, schedules and builds. Real MCP SDK, Claude SDK, installed server Pi validation and authenticated ACP transport are covered.
- Targeted suite: 376 tests /16 files pass; ACP bridge: 5 /1 pass. The related changed run passes 489 tests /22 files. Its first attempt timed out around shared-slot admission and is not claimed green. The shared snapshot changes only the removed create-body field and translated REST note.
- Scoped affected browser suite: 43 tests /10 specs pass. Shared-contract full-selector fallback remains a CI responsibility, not a claimed local full-suite run.
- Lint, typecheck, spec parsing, generated feature maps, VP self-test and 24 prepush checks pass. Current-head CI and cloud review remain required after publication.

Two-way code rollback; no data conversion or deletion. Deploy server and daemon together to retain stale arguments through every SDK boundary. Final category storage/model removal remains a separate segment and this segment does not close #3481.
