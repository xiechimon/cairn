---
Category: Passing a test path through pnpm test with an extra separator started the full integration suite
Source: #1625 (2026-10-27)
Level: 2
Safeguard: Targeted integration verification invokes pnpm exec vitest run with the test path directly; its recorded completion must name exactly one test file
Intercepts: 1
Recurrences: 0
Notes: The original pnpm test -- invocation logged vitest run -- and ran unrelated chief tests; it was interrupted. The direct exec invocation is recorded separately in docs/verify/1625
---
