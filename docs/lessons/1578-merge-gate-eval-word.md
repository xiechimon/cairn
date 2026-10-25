---
Category: The merge-gate source or a string in records/merge-gate.ts contained the whole word `eval` (in a path or identifier), and `merge-gate-imports` flagged it as dynamic loading
Source: #1578 (2026-10-23)
Level: 2
Safeguard: `merge-gate-imports.test.ts` only recognizes `eval(`, `new Function(` and non-literal `import(`, not eval inside strings or identifiers
Intercepts: 1
Recurrences: 0
Notes: negative control: source containing `eval(` still goes red; the literal `'integration/eval/chief-dispatch'` stays green
---
