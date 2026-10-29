---
Category: Round 3 pushed a bare dismiss button past ui-debt-gate D2 and two new biome warnings past the local 0-warning cap
Source: PR #2026 round 3 (2026-10-27)
Level: 2
Safeguard: prepush runs ui-debt-gate D2 and the lint-warning cap before every push, and CI's check job re-runs the same plan fail-fast
Intercepts: 2
Recurrences: 0
Notes: Negative control: node scripts/ui-debt-gate.mjs is red on 9ef30291 (D2 bare controls 4 > baseline 3, board/first-pr-card.tsx 0->1) and green after the dismiss moved to the components/ui Button; biome ci . went from 2 warnings (unused todoId parameter, unused seed import) to 0. The D2 report also names chief/chief-conversation.tsx 0->1, which is main's own post-freeze growth from #1934 masked by chief-drawer.tsx shrinking 1->0 in the same commit, so main stays green at total 3 and only the card was this branch's debt. Second intercept, #2162 (2026-10-29): the backup banner copied the quota banner's badge class text-[10px], and prepush ui-debt-gate went red (D5 arbitrary text sizes 15 > baseline 14, board/backup-banner.tsx 0->1); green after switching to the text-caption scale class.
---
