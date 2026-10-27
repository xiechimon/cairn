---
Category: An orphaned `vite preview` from a killed run squatted a heavy-slot port; every later pre-push on that slot failed at the e2e step with a bare port-in-use error that named nobody — one held 8398 for over an hour and broke a push
Source: #1908 (2026-10-27)
Level: 2
Safeguard: `slotPortReport` in `scripts/heavy-slots.mjs` resolves the listener's pid, cwd and command (`lsof`, `ss` fallback, `ps`, `/proc/<pid>/cwd`); `pnpm prepush` (plans that run `e2e:affected`) and `e2e:affected` itself fail before playwright starts, naming the holder
Intercepts: 0
Recurrences: 0
Notes: Negative control: `node --test scripts/heavy-slots.test.mjs` red on main (`docs/verify/1908/red.log`), green after (`docs/verify/1908/green.log`); the new tests drive real `e2e-affected.mjs` and `prepush.mjs` children against a live squatter process
---

