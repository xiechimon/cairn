---
Category: Integration tests written during the merge were not formatted with `biome format` first; `pnpm lint` reported formatting diffs
Source: #1626 merging origin/main (2026-10-25)
Level: 2
Safeguard: `pnpm lint` (`biome ci .`) runs before commit and in CI; negative control: unformatted `integration/test/info-fastlane-e2e.test.ts` gives 1 lint error, 0 after `biome format --write`
Intercepts: 3
Recurrences: 0
Notes: The machine check already intercepts, no additional protection needed; same class at #1576: after changing `integration/eval/memory-regression/grade.mts`, lint reported 1 error, 0 after `biome format --write`; same class at #1666: the new `apps/server/test/codeowners.test.ts` was unformatted, `pnpm lint` reported 1 error, 0 after `biome format --write`; same class at #1570: adding the pushed record to `trajectory-push.ts` was not formatted, `pnpm lint` reported 1 error, 0 after `biome format --write`
---

