---
Category: The overlay folder merge grepped its consumers, saw `.claude/skills/verify-cairn/features/hotkeys.md`, filed it as history and left the old path; `feature-map-staleness-gate` went red only in CI
Source: overlay folder merge (2026-10-26)
Level: 2
Safeguard: `pnpm prepush` runs `scripts/feature-map-staleness-gate.mjs` locally; `scripts/prepush.test.mjs` expects it in the local plan; negative control: the gate is red on the old `hotkeys.md` line
Intercepts: 1
Recurrences: 1
Notes: Feature files under `.claude/skills/verify-cairn/features/` are live maps, not history. Same class on PR #1878 (2026-10-26): deleting `machines-shell-switch.spec.ts` left two dangling refs (the CI gate caught it); fixed by restoring the surviving C1-C4 concurrency cases in `machines-concurrency-control.spec.ts` and repointing `machine-concurrency.md` / `machines-local-row.md`; negative control: the gate red on the dangling refs, green after. Deleting a spec must move the tests of features that stay / Feature files under `.claude/skills/verify-cairn/features/` are live maps, not history
---
