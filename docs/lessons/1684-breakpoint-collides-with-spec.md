---
Category: The responsive breakpoint started at 767px, colliding with `paper-topbar.spec`, which pins the full top bar at 680px as narrow desktop width (the `定时` link gets hidden); the full e2e went red for one round before narrowing to 640px
Source: #1684 (2026-10-25)
Level: 2
Safeguard: The 680px case in `paper-topbar.spec` plus a full e2e:affected run; before picking a breakpoint, `grep "setViewportSize({ width" apps/web/e2e` enumerates the existing pinned viewports (current steps: 320/560/680/800/815/816/900/1024/1152/1309/1440/1920)
Intercepts: 1
Recurrences: 0
Notes: Negative control: with the 767px breakpoint the 680px case is red (the `定时` link unreachable); with the 640px breakpoint two full runs of 1246 cases all pass
---

