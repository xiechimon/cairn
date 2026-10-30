---
Category: A read-only search handed a nonexistent path glob to zsh; nomatch aborted that search
Source: #1481 (2026-10-24)
Level: 2
Safeguard: Interactive commands now run through an explicitly selected bash shell, preventing zsh nomatch from aborting read-only searches; search paths are discovered with `rg --files`, then passed to rg with explicit directories and quoted patterns; since 2026-10-30
Intercepts: 1
Recurrences: 2
Notes: #1405 repeated the path-glob error once, then used rg file discovery. A higher-level in-repository gate cannot inspect interactive tool-call shell arguments; no new wording-only rule is added. The corrected command enumerates the actual attachment call sites; interactive tool commands do not enter in-repo scripts, so in-repo lint cannot cover them
---
