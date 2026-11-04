---
Category: An e2e test asserted a request-count array with a non-retrying `expect(sent).toHaveLength(1)` right after pressing Enter, so on a loaded CI runner it read the array before the react-query mutation had fired and failed with "Expected length: 1 / Received length: 0"; the branch touched no web file and the test predated it
Source: PR #2050 (#1625, 2026-10-28)
Level: 2
Safeguard: `apps/web/e2e/composer-slash.spec.ts` asserts the send count with `await expect.poll(() => sent.length).toBe(1)`; the repo already used this idiom for async request counts (`account-controls.spec.ts`, `agent-detail.spec.ts`) while every other `sent` assertion in the file is the `toHaveLength(0)` case, which passes vacuously because the array starts empty
Intercepts: 0
Recurrences: 0
Notes: Negative control on the real failure: adding a 400ms delay inside the POST route handler made the old assertion red 2 of 2 runs with the identical CI message, and the poll-based assertion green 3 of 3 runs under the same delay. A machine check is not feasible at level 1 or 2: the defect is the choice of matcher rather than a value a lint rule can distinguish, since `expect(...).toHaveLength(0)` is legitimate and 15 call sites in the same specs use it
---
