---
Category: A read-only search handed a nonexistent path glob to zsh; nomatch aborted that search
Source: #1481 (2026-10-24)
Level: 3
Safeguard: Search paths are discovered with `rg --files`, then passed to rg with explicit directories and quoted patterns
Intercepts: 1
Recurrences: 0
Notes: The corrected command enumerates the actual attachment call sites; interactive tool commands do not enter in-repo scripts, so in-repo lint cannot cover them
---
