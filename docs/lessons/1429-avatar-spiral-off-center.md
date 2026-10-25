---
Category: The generated avatar's spiral was not centred (the translation parameters were hand-estimated); it looked off when static and wobbled when spinning, and ian called it out
Source: #1429 (2026-10-25)
Level: 2
Safeguard: the "every spiral sits on the disc centre" case in `apps/web/e2e/avatar-spiral.spec.ts` measures the spiral bounding-box centre in the browser
Intercepts: 0
Recurrences: 0
Notes: negative control: with the old `translate(-84 -14)` / `translate(-84 28)` parameters the centre was 4–6 units off and the test went red; green after the correction
---
