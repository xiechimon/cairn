---
Category: The avatar-generating spiral was not centered on the disc (the translation parameters were hand-estimated); it looked off-center statically and wobbled when spinning, which ian pointed out
Source: #1429 (2026-10-25)
Level: 2
Safeguard: `apps/web/e2e/avatar-spiral.spec.ts` "every spiral sits on the disc centre" measures the spiral bounding-box center in the browser
Intercepts: 0
Recurrences: 0
Notes: Negative control: under the old parameters `translate(-84 -14)` / `translate(-84 28)` the center was 4–6 units off and the test went red; green after the correction
---
