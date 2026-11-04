---
Category: Banned words were written into rule text and were caught by the pre-commit banned-word check
Source: PR #1539 (2026-10-23)
Level: 2
Safeguard: `.husky/banned.txt` pre-commit check
Intercepts: 3
Recurrences: 2
Notes: #1656 source-omission negative-control output printed the entire source ledger and repeated an inherited banned word; the hook blocked the evidence commit. An explicit source-row-count assertion now fails first with a focused diagnostic instead of dumping unrelated source prose. The check works, no additional protection needed. #1577 recurrence: the new doc `docs/ops/experience-candidates.md` used a banned word when describing atomic writes; scanning the added lines with the hook's own `grep -E -f .husky/banned.txt` hit 1, reworded to 0; the hook itself is a machine check, no upgrade
---
