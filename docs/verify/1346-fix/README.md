# #1346 Bugbot fix: stepper clicks lost during an in-flight PATCH

Probe `drive-1346-fix.mjs` against a real stack (verify-pacman `launch.mjs`, node22, server :8837). The browser holds each `PATCH /api/machines/*` for 800 ms before forwarding it to the real server, then + is clicked three times starting from 3.

| Check | before (`41ee5595` UI) | after |
|---|---|---|
| Input while PATCHes are queued | FAIL: `5` | PASS: `6` |
| PATCH bodies in order | FAIL: `4, 5, 5` | PASS: `4, 5, 6` |
| API final `maxConcurrent` | FAIL: `5` | PASS: `6` (manual) |
| Input after settling | FAIL: `5` | PASS: `6` |

Raw requests with timings: `before/patches.json`, `after/patches.json`; API snapshots `*/api-*.json`; screenshots `*/0{1,2,3}-*.png`.
