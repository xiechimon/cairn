---
Category: #1706 passed local pre-push but CI went red on `ui-registry-gate` (unregistered `skeleton.tsx`, `dialog-shell.tsx` hash not re-frozen): five zero-dependency CI gates ran only as separate CI steps, never in `pnpm prepush`
Source: #1706 (2026-10-25)
Level: 2
Safeguard: `scripts/prepush.mjs` `localOnly` now runs `test-spawn-gate`, `pr-evidence-workflow-gate`, `ui-registry-gate`, `ui-consumer-shape-gate`, `pr-gate-selfcheck`; `scripts/prepush.test.mjs` fails when any `run: node scripts/*.mjs` CI step is neither in the local plan nor in `ciOnlyScripts` with a reason
Intercepts: 0
Recurrences: 0
Notes: Negative control: dropping `ui-registry-gate` from the local plan makes the test report "scripts/ui-registry-gate.mjs runs in CI but not in local prepush"
---
