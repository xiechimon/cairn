---
Category: An ad hoc verifier compiler invocation missed TypeScript 7 configuration and Node type resolution requirements
Source: PR #2073 repair of #2047 (2026-10-28)
Level: 2
Safeguard: The runtime observer lives under `integration/eval/git-push-proof/`, included by the mandatory integration typecheck through `integration/tsconfig.json`
Intercepts: 0
Recurrences: 0
Notes: The standalone invocation first failed with TS5112 and then TS2688. Putting the verifier in the existing compiler include removes its dependence on manually assembled flags and typeRoots; no compiler configuration is weakened.
---
