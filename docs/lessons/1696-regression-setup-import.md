---
Category: Regression setup failed before reaching the target path: a scheduler import was missing and a monotonic clock was passed to an epoch-based tick
Source: #1696 (2026-10-25)
Level: 2
Safeguard: Server typecheck and the large-corpus scheduler integration test
Intercepts: 2
Recurrences: 0
Notes: The missing import raised ReferenceError; the wrong clock skipped GC and falsely passed. With the import and Date.now(), the original implementation took 271 ms against a 100 ms bound. No new gate was introduced.
---

