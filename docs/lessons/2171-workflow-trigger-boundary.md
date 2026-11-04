---
Category: Broad text rewrites crossed YAML and JavaScript fixture boundaries
Source: #2171 (2026-10-30)
Level: 2
Safeguard: `scripts/ci-job-structure-gate.mjs` validates the jobs boundary and `scripts/prepush.test.mjs` pins the existing trigger block; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: The rewritten workflow initially put job definitions under on. The structure regression suite rejected every missing baseline job. Restoring the trigger block and jobs boundary made all ten structure tests pass; the classifier workflow test also pins both boundaries and its job reader now starts inside jobs. Diff review also caught a global import insertion inside two JavaScript fixture strings; those fixtures retain their original content.
---
