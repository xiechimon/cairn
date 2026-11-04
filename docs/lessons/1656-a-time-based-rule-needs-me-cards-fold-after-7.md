---
Category: A time-based rule (needs-me cards fold after 7 days untouched) was checked against four hand-picked specs only; nine live-mock specs build cards with `phaseAt: 0`, so the new rule folded them out of the pending column and they went red at push time
Source: needs-me inbox PR (2026-10-26)
Level: 2
Safeguard: `pnpm prepush` runs `e2e:affected`, which fell back to the full suite for the shared style and i18n change and caught all nine; the mocks now use `phaseAt: Date.now()`. Before adding any rule keyed on `phaseAt` or other timestamps, `grep -l "phaseAt: 0" apps/web/e2e` lists the mocks it can hit
Intercepts: 1
Recurrences: 0
Notes: Negative control is this run: 9 red with `phaseAt: 0`, 16 green on the same specs after the change
---
