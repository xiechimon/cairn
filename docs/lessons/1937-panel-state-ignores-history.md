---
Category: UI state mirrored into the URL with `replaceState` was read only on first mount, so Back and Forward showed the wrong panel, and a write effect that ran during the leave render copied `panel`/`task` into the next page's URL
Source: #1937 (2026-10-27)
Level: 2
Safeguard: `apps/web/e2e/task-panel.spec.ts` (the Back and Forward case and the leaving case) walks home, board and schedules through history and checks the panel and the URL at each step; state that lives in the URL is re-read on every `POP` navigation, and a page with no host removes the params
Intercepts: 1
Recurrences: 0
Notes: Found by the independent review gate. Negative control: both cases red before the `POP` sync and the host-less cleanup, green after over five repeats
---
