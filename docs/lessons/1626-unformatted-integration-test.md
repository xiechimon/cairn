---
Category: An integration test written during the merge window was not run through `biome format` first, and `pnpm lint` reported format differences
Source: #1626 merging origin/main (2026-10-25)
Level: 2
Safeguard: `pnpm lint` (`biome ci .`) runs before commit and in CI; negative control: unformatted `integration/test/info-fastlane-e2e.test.ts` gave lint 1 error, 0 after `biome format --write`
Intercepts: 3
Recurrences: 0
Notes: the machine checks already block it, no further safeguard needed; same kind in #1576: after changing `integration/eval/memory-regression/grade.mts` lint reported 1 error, 0 after `biome format --write`; same kind in #1666: the new `apps/server/test/codeowners.test.ts` was unformatted, `pnpm lint` reported 1 error, 0 after `biome format --write`; same kind in #1570: after adding already-pushed records to `trajectory-push.ts` it was left unformatted, `pnpm lint` reported 1 error, 0 after `biome format --write`
---
