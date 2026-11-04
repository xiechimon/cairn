---
Category: A push omitted the canonical TMPDIR used by its preceding prepush run and temporary CLI tests returned no output
Source: #2081 follow-up (2026-10-28)
Level: 2
Safeguard: scripts/lessons-ledger-gate.test.mjs checks actual CLI output and normal prepush blocks silent entry-point execution; operator push commands preserve TMPDIR=/private/tmp through the Git hook; since 2026-10-28
Intercepts: 1
Recurrences: 0
Notes: The explicit prepush passed 66 tests, but the first push omitted TMPDIR and its hook failed three CLI-output checks. The unchanged source passed all 66 checks when the normal push inherited the canonical temporary directory. On this Mac /tmp resolves to /private/tmp, while the CLI entry-point compares module and argument URL text. No test or hook was bypassed and no product source was changed.
---
