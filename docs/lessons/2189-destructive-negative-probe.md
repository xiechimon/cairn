---
Category: A negative-control probe for "this token cannot write X" sent a real state-changing write, so a token wider than expected would have caused the damage the probe was checking for
Source: #2189 (2026-10-30)
Level: 2
Safeguard: scripts/ops/secret-reach/token-scope-probe.mjs holds the only probe list; token-scope-probe.test.mjs fails when a write probe is not a bodyless DELETE of an absent resource, and when the PUT on main branch protection reappears
Intercepts: 0
Recurrences: 0
Notes: The first omarchy check of the broker token sent PUT /repos/xiechimon/cairn/branches/main/protection with a body that clears every required check. It returned 403 and protection was read back unchanged, but a token with administration write would have removed the protection. Negative control: the old PUT added to the list turns two tests red (docs/verify/2189/probe-gate-red.log); the committed list is green. A 404 on an absent resource now means the write was authorized and fails the probe run.
---
