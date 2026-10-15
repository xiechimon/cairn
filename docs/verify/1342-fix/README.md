# #1342 Bugbot fix: concurrency stepper blur races

Probe `drive-1342-fix.mjs` against a real stack (verify-pacman `launch.mjs`, node22), recording every browser `PATCH /api/machines/*`.

| Check | before (`bfb99895` UI) | after |
|---|---|---|
| A1 edit 7 → 恢复推荐: one PATCH `{maxConcurrent:null}` | FAIL: `7` then `null` | PASS: `null` only |
| C1 edit 7 → +: one PATCH `{maxConcurrent:8}` | FAIL: `7` then `8` | PASS: `8` only |
| B1 out-of-range 12 (range 1–8), focus + blur + Esc: no PATCH | FAIL: PATCH `8` | PASS: none |
| B2 API keeps 12 manual | FAIL: clamped to 8 | PASS |

Raw requests: `before/patches.json`, `after/patches.json`; API snapshots `*/api-*.json`.
