# #1427 evidence: three e2e specs that failed for timing or browser-version reasons

Environment: cloud session image, Chromium 141.0.7390.37, fixture build. CI uses Chrome for Testing 153.

| file | what it shows |
|---|---|
| `probes.txt` | the three mechanisms: outline-offset sampled per frame (0px to 2px over 150ms), the idle option reading `:hover` after a reload, the one-value `mask-size` declaration |
| `before-main-3a4e2df-x3.txt` | the three specs on `origin/main` `3a4e2df`, `--repeat-each=3`: 7 failed (accent-typo 6/6, sched freq 1/3), 116 passed |
| `after-x10.txt` | the same three specs on this branch, `--repeat-each=10`: 410 passed |
| `e2e-affected-full.txt` | `pnpm e2e:affected` on this branch (full-suite fallback, `helpers.ts` is shared): 1092 passed, 0 failed |
| `registry-old-6workers-x10.txt` / `registry-new-6workers-x10.txt` | registry-focus-ring old and new under 6 workers x10: 90 passed both. The CI failure (`1px` offset) did not reproduce locally even under load; the fix waits for the transitions the probe shows instead of a fixed 350ms |
