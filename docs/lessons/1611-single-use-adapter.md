---
Category: A newly added one-off adapter (error wrapping, Node stream to Web stream) violated the single-use helper rule; the gate only reported it at wrap-up
Source: #1611 (2026-10-25)
Level: 2
Safeguard: Caught by `scripts/single-use-helper-gate.mjs`; inlined in favor of `Readable.toWeb`/`Writable.toWeb`
Intercepts: 2
Recurrences: 0
Notes: The gate only scans tracked files, so new files must be `git add -N` first; negative control: acp.ts reported 3 red this time, 0 after inlining. #1684 same class: `subscribeNarrow`/`getNarrow` in `app-sidebar.tsx` were each called once, the gate reported 2, 0 after inlining into the `useSyncExternalStore` argument
---

