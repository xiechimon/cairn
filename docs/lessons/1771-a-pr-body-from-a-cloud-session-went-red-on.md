---
Category: A PR body from a cloud session went red on `pr-evidence`: full 40-character SHAs in `raw.githubusercontent` links were wrapped in backticks by the egress proxy (#1771); a Verified section holding only a fenced block counted as empty because the gate was not run on the final body (#1785); the What section quoted the Chinese issue title verbatim, and the language gate was not run on the final body either (#1787)
Source: #1771 (2026-10-26)
Level: 2
Safeguard: `pr-evidence` reds `not-embedded` / `unreachable` / `empty-section` / Chinese body lines; `.claude/skills/pr-cairn/SKILL.md` says to run `scripts/pr-evidence-gate.py`, `scripts/pr-tasks-gate.py` and `node scripts/english-only-gate.mjs --text` on the exact body file, pin evidence links to an 8-character SHA, keep a prose line above any fence, and read the stored body back
Intercepts: 3
Recurrences: 2
Notes: The proxy rewrite happens after the local gate run, so only the CI gate or a read-back sees it; the Chinese line is visible to a local `--text` run before opening, but `pnpm pr:check` (`scripts/pr-body-check.mjs`) runs only the section and task gates, so the bundled local check misses it (#1787)
---
