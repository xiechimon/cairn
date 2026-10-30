---
Category: A security invariant test read a parsed or partial view of a workflow file, and reviews bypassed it with YAML layouts and escapes the check did not decode
Source: #2179 (2026-10-30)
Level: 2
Safeguard: scripts/release-config.test.mjs pins the whole of .github/workflows/release.yml as exact text, and 22 single-edit fixtures, one per reviewed bypass, must each be rejected by the same comparator; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: Two heads shipped partial checks. The first hand-parsed YAML by indentation and missed comments, flow steps, quoted keys, continuation lines, extra jobs, shell, env, container, with inputs and other SHAs. The second compared the header and publish job as text but scanned config and pack for substrings, and the escaped keys "\x70ermissions" and "id-\x74oken" granted pack an OIDC token with every check green. Negative control: docs/verify/2179/gap.log shows main's assertions accepting 21 of 22 fixtures, and green.log shows the pin rejecting all 22. Level 1 is not available: the same pull request can edit the workflow and its pin, so the pin is a tripwire reviewed by the owner on a protected path, and branch-run publishing needs a deployment environment (separate ticket).
---
