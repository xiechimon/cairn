---
Category: A new private helper is called only once; single-use-helper-gate goes red first
Source: #1626 (2026-10-25)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs`; negative control: with `stripReportLocationNote` standing alone the gate reports 1, inlined it turns green
Intercepts: 3
Recurrences: 0
Notes: Caught by the machine check. #1666 same class: `parseCodeowners` and `compareFile` in `apps/server/test/codeowners.test.ts` each called once, gate reported 2, green after inlining. #1683 same class: `freePort` in `container-mode.test.ts` called once, gate reported 1, green after inlining
---
