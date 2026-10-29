---
Category: `git push ... | tee log` reported exit 0 while the pre-push hook had blocked the push (single-use-helper gate), so the branch was taken as pushed
Source: #2163 (2026-10-29)
Level: 3
Safeguard: Read a piped command's exit from `PIPESTATUS[0]` under `set -o pipefail`, never the pipeline status, and grep the log for the hook's blocked line before treating a push as done
Intercepts: 0
Recurrences: 0
Notes: Behavior class in shell commands typed by an agent; the repo cannot police pipe shapes in an interactive shell. Same family as 1684-head-closed-pipe, which concerns truncated output rather than a lost exit code
---
