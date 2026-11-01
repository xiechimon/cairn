#!/bin/bash
set -euo pipefail
R=xiechimon/cairn
body='The feature freeze (#1795) ends today. Web Push PR #1727 (issue #1686) was held by owner decision on 2026-10-26.

## Plan
1. Confirm #1784 (push only when a human is needed) is merged or land it first.
2. Rebase #1727 on main, regenerate its migration, limit push events to "a human is needed" per #1784.
3. Mark #1727 ready for review; the review gate and CI decide the merge.

## Acceptance
- [ ] #1727 rebased, push limited per #1784, review gate PASS, merged'
~/.cairn/tools/app-token/as-bot.sh gh issue create -R $R -t "Resume Web Push PR #1727 after the feature freeze" -b "$body" -l batch:now -l by:cairn -l enhancement -a xiechimon
for n in 1849 1850 1851 1853 1854 1909 1918 1974 1976 1978; do
  sed -i "/^$n$/d" ~/.local/state/overnight/never
  ~/.cairn/tools/app-token/as-bot.sh gh issue edit $n -R $R --remove-label waits-ian >/dev/null
  ~/.cairn/tools/app-token/as-bot.sh gh issue comment $n -R $R -b "Feature freeze ended; held until 2026-11-09 by owner decision (option A, 2026-10-26). Released to the scheduler." >/dev/null
done
systemctl --user disable cairn-resume-1727.timer
