---
Category: A new private helper is called only once; single-use-helper-gate goes red first
Source: #1626 (2026-10-25)
Level: 2
Safeguard: `scripts/single-use-helper-gate.mjs`; negative control: with `stripReportLocationNote` standing alone the gate reports 1, inlined it turns green
Intercepts: 4
Recurrences: 2
Notes: Caught by the machine check. #1666 same class: `parseCodeowners` and `compareFile` in `apps/server/test/codeowners.test.ts` each called once, gate reported 2, green after inlining. #1683 same class: `freePort` in `container-mode.test.ts` called once, gate reported 1, green after inlining. #1878 same class: restoring the deleted `machines-shell-switch.spec.ts` fixture helper `machine()` carried only one of its two call sites into `machines-concurrency-control.spec.ts`, the CI gate reported 1, inlining `LOCAL` left 0. #1905 same class: the single-use `githubFetch` arrow const in a new `github-writeback.test.ts` case was reported by the CI gate (prepush was not run before the push), inlining it into the `bootServer` call left 0 #1794 recurrence: the normal pre-push check reported five private helpers after fixture edits and a partial parser relocation; inlining the fixture wrappers and parser helpers left zero. The original and current parser matched across 259 inputs and both public APIs.
---
