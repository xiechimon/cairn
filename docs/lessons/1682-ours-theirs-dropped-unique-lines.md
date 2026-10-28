---
Category: Resolving a rebase conflict with `git checkout --ours` per file dropped the other side's non-conflicting unique lines: main's i18n key `还没有定时任务` lived in a hunk where the branch also inserted its demo keys, so taking main's side for "comments/wording" silently deleted a live entry used by `schedules-page.tsx`
Source: #1682 rebase (2026-10-25)
Level: 2
Safeguard: After `--ours`/`--theirs` conflict resolution, diff each conflicted file against both parents before `rebase --continue`, and run the package's unit tests before declaring the rebase green; the i18n coverage test reports the exact missing key
Intercepts: 0
Recurrences: 0
Notes: Negative control: the faulty resolution failed `test/i18n-coverage.test.ts` with `pages/schedules-page.tsx: "还没有定时任务"`; re-adding the entry turns it green
---
