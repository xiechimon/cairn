---
Category: CLI tests that spawn subprocesses hand-wrote timeouts case by case; the one case missing a timeout ate the default 5 seconds and flaked in full runs
Source: #1514 (2026-10-24)
Level: 1
Safeguard: `trajectory-export.test.ts` sets `vi.setConfig({ testTimeout: 30_000 })` at file level and the per-case timeout parameters are deleted, so new tests in the same file cannot miss it
Intercepts: 1
Recurrences: 0
Notes: Negative control: "selects builds by creation time" spawns two subprocesses with no timeout parameter and measured 4851ms, close to the 5-second cap, going red once in a full run; with the file-level timeout lowered to 100ms that case goes red, all green again at 30 seconds
---

