# Provider connection checks

## Plan

Keep the assigned session branch and open a replacement PR saying Supersedes #3101. Main was fast-forwarded before changes. Reuse the useful route and runtime bridge from #3101 without merging its unrelated history or evidence. Return exactly status and reason, never model identifiers, counts, bodies, headers or latency. All result strings pass through redactSecrets, with literal stored-key removal before pattern redaction. Owner authorization precedes decryption and outbound traffic.

Failure modes: native authentication differs by protocol; compatibility configuration can be lost; HTTP 200 can contain invalid data; errors and success metadata can carry credentials; non-owners must not send requests; extra response fields can leak upstream data. Also cover timeouts, thrown failures, missing configuration, rate limiting and keyless gateways.

Write route-level tests before production changes, run them against the current main-based head, then reuse stepProvider and pi-ai Models.complete through coordinator/runtime. Validate only the parsed result, not a second HTTP protocol. Test wire requests with deterministic transports and exercise the real HTTP server and settings button on an isolated stack. Run lint, typecheck, spec parsing, related Vitest, focused affected e2e and prepush. Push only the session branch; track CI and cloud review.

## Overlap (2026-11-08)

1. Open issues #3418 and #3094 are this request. Reuse them. #1854, #2284 and #2285 have different goals.
2. Open PR #3101, head server/provider-test-connection, is the same ask. Proceed on the session branch under explicit user authorization to supersede it rather than push its branch.
3. Recent merged matches #3416, #3377, #2703, #3164 and #2880 concern attribution, retry classification, provider model selection, routing rules and screen access. None delivers this endpoint. No recently merged work is intentionally removed.
4. File overlap is only #3101 for the planned route, runtime bridge, service, shared contract and provider editor. No additional matching open PR. Recheck the final file list before creation.

## Decisions

| Decision | Reason |
| --- | --- |
| Only status and reason | Latest task supersedes the original issue's larger summary. |
| No upstream metadata | Omission is safer than echoing scrubbed model identifiers. Provider failures map to server-authored reasons; even scrubbed SDK errors can contain raw bodies or arbitrary model strings. Every outgoing result string still passes through redactSecrets with the stored credential. |
| Reuse D114 stepProvider | It is the production authentication and compatibility materializer within the approved seam. |
| Single settings row | Draft exempt under P2; reuse SettingsRow and Button. |

## UI brief

Surface: settings. Goal: test a saved connection without exposing credentials. Rules: C1, C5, V1, V4, V10, T1, A1, R1. Reference: docs/design/references/settings/t3code-providers.png, opened before UI implementation; take the divided settings rows and quiet inline status. Draft exempt: single setting. Test row states: idle, loading, success, failure, offline request failure, long reason, narrow viewport and dark theme. Pending question is not applicable because this action never asks a question. Use plain localized status and a scrubbed reason in details, not raw HTTP diagnostics. Live screenshots are in provider-evidence (success, failure and loading; light/dark; 1440/390). All 12 captures have no horizontal overflow. Reference comparisons are in provider-comparisons. Offline request failure is covered by focused browser regression, not a live screenshot. Long-content screenshots and axe remain unverified.

## Verification

- Baseline a2e2ebb51: new route regression suite failed 12 of 13 tests because the endpoint returned 404 instead of executing a check. This covers all six requested cases; the not-found negative control already passed.
- UI tests preceded UI code: both failed waiting for the absent Test button. Initial affected run refused a port held by another worktree; its process was left running. A separate free base port was used.
- A later disclosure negative control failed once when the SDK error text was returned, then passed after upstream text was omitted in favour of safe server-authored reasons.
- Focused Vitest: 112 tests passed in provider connection, provider configuration, shared snapshot and translation coverage files. The changed selector also passed (89 tests before the extra edge cases).
- Focused affected browser tests: 2 passed. The broader provider editor selection passed 294 and failed 2 gallery screenshot cases; those tests compare many unrelated specimens. No baselines were changed or accepted; CI must adjudicate the environment-dependent visual differences.
- Live isolated HTTP server, SQLite and browser: 3 API checks passed (streamed success, 401 with credential-bearing error and malformed HTTP 200); 12 UI captures; all wire assertions passed for native Bearer and max_completion_tokens = 8 without max_tokens. Provider boundary is a local HTTP stub, not a real provider. Auth was off on that isolated stack; owner/non-owner and missing-session checks are deterministic route tests.
- pnpm lint, pnpm typecheck, pnpm spec:parse and pnpm prepush passed. The first prepush caught formatting in the test, fixed before rerunning. No lockfile changes are included.
- Before evidence: the main-based route regression is an in-process server observation, not a second live baseline stack. The original PR's archived before request is available separately; do not claim a new live before capture.

## Review follow-up

Cloud review raised one P2 authorization mismatch: the server refused non-owners but the button remained visible. New owner-capability assertions failed twice in the route tests; two new browser regressions failed with the button still visible for false or missing capability. The providers envelope now exposes canTestConnection from the same isOwner predicate, and the UI hides the action unless it is explicitly true. All four browser cases pass. The 112 focused unit tests still pass, including both owner states. The isolated HTTP/browser probe was relaunched on the changed code and again passed all three API cases and twelve captures.

CI also caught an omitted route-vocabulary registration in wire.test.ts; register the new, user-requested POST as an inferred route without weakening the vocabulary check. Local broader gallery failures did not reproduce in the first CI e2e run. The repository autonomy brake currently blocks pr-evidence before its body checks; do not bypass or clear it.

## UI comparison

| State | Reference | Ours | Verdict |
| --- | --- | --- | --- |
| Connected | t3code-providers.png | provider-evidence/ok-light-1440.png | Same divided rows and quiet status; Cairn's connection hint wraps more. |
| Failed | t3code-providers.png | provider-evidence/denied-light-1440.png | Status and recovery action remain inline; Cairn folds the safe reason into details. |
| Loading | t3code-providers.png | provider-evidence/slow-light-1440.png | Same row composition; reference has no active probe state, Cairn disables the pending action. |
