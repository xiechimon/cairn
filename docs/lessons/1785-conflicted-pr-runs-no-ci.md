---
Category: A pushed PR became conflicted with main and sat for 15 minutes: a `dirty` PR runs no `pull_request` workflows, so no CI event arrived to report it
Source: #1785 (2026-10-26)
Level: 4
Safeguard: `.claude/skills/pr-cairn/SKILL.md` Mechanics: read `mergeable_state` after opening and after each push, merge `origin/main` when it is `dirty`
Intercepts: 0
Recurrences: 0
Notes: No repo check can see a conflict that main introduces after the push; the PR watcher does not deliver merge conflicts either
---

