---
Category: CLI tests that spawn subprocesses hand-wrote timeouts case by case; the one case missing a timeout ate the default 5 seconds and flaked in full runs
Source: #1514 (2026-10-24)
Level: 1
Safeguard: `trajectory-export.test.ts` sets `vi.setConfig({ testTimeout: 30_000 })` at file level and `push-startup.test.ts` sets a 40-second file-level budget for its two 15-second startup waits; the per-case timeout parameters are deleted, so new tests in the same file cannot miss it
Intercepts: 1
Recurrences: 1
Notes: Negative control: "selects builds by creation time" spawns two subprocesses with no timeout parameter and measured 4851ms, close to the 5-second cap, going red once in a full run; with the file-level timeout lowered to 100ms that case goes red, all green again at 30 seconds. On #1686 the production startup test timed out at the default 5 seconds; its file-level budget now covers both startup attempts
---
