---
Category: Ran `git checkout -- <path>` to redo a negative control and threw away the unstaged fix in that file
Source: #1534 (2026-10-27)
Level: 3
Safeguard: A negative control now copies the fixed file to a temporary path first, swaps in the old version from `git show HEAD:<path>` and copies the fix back; the working tree is never restored from the index, and a diff against the saved copy confirms the fix is intact before the run continues; since 2026-10-27
Intercepts: 0
Recurrences: 0
Notes: The fix was recovered only because the same content had just been copied to `/tmp` for the same experiment. AGENTS.md already forbids `git reset --hard`, `git checkout .` and `git stash`; `git checkout -- <path>` is the same class of destructive undo on a shared worktree, where no reflog entry exists for unstaged edits. In-repo scripts cannot govern a shell command, so this stays at the wording level and relies on the substitute procedure above
---
