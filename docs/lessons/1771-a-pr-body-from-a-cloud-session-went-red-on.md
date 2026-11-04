---
Category: A PR body from a cloud session went red on `pr-evidence`: full 40-character SHAs in `raw.githubusercontent` links were wrapped in backticks by the egress proxy (#1771); a Verified section holding only a fenced block counted as empty because the gate was not run on the final body (#1785)
Source: #1771 (2026-10-26)
Level: 2
Safeguard: `pr-evidence` reds `not-embedded` / `unreachable` / `empty-section`; `.claude/skills/pr-cairn/SKILL.md` says to run `scripts/pr-evidence-gate.py` on the exact body file, pin evidence links to an 8-character SHA, keep a prose line above any fence, and read the stored body back; scripts/pr-evidence-gate.test.py builds the weekly workflow body with real renderWeeklySummary output and runs the evidence gate
Intercepts: 2
Recurrences: 1
Notes: The proxy rewrite happens after the local gate run, so only the CI gate or a read-back sees it. In #2196 the generated weekly summary started a new H2 immediately after Proof, leaving Proof empty. The workflow-body regression reproduced FAIL empty-section: Proof before demoting summary headings and passed afterward; the original red output is in docs/verify/2196/gates-red.log.
---
