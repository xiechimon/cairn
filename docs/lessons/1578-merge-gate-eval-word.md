---
Category: A whole-word `eval` (in a path or identifier) in the merge-gate source or in strings in records/merge-gate.ts was flagged as dynamic loading by `merge-gate-imports`
Source: #1578 (2026-10-23)
Level: 2
Safeguard: `merge-gate-imports.test.ts` only recognizes `eval(`, `new Function(`, and non-literal `import(`, not eval inside strings or identifiers
Intercepts: 1
Recurrences: 0
Notes: Negative control: source containing `eval(` still goes red; the `'integration/eval/chief-dispatch'` literal stays green
---
