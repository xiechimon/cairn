---
Category: A docs-only push ran only the language gate, so translating `docs/ops/agent-bot-identity.md` left `apps/server/test/codeowners.test.ts` (which matches a sentence in that doc) red until CI
Source: #1765 (2026-10-26)
Level: 2
Safeguard: `scripts/doc-reader-tests.mjs` in the local docs-only prepush plan runs every test that names a changed doc; selection covered by `scripts/doc-reader-tests.test.mjs`
Intercepts: 0
Recurrences: 0
Notes: Negative control: the translated doc on main makes `node scripts/doc-reader-tests.mjs docs/ops/agent-bot-identity.md` red on the codeowners test; main's doc is green
---

