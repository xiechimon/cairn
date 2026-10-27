---
Category: The tool count was written in prose; when adding a tool only the constant was changed, not the prose (the source header and the CHIEF_TOOL_COUNT comment still said 52, and the test title still had the old count)
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `packages/shared/test/chief-tools.test.ts` reads every "current N tools" occurrence in the source and requires it to equal `CHIEF_TOOL_COUNT`
Intercepts: 1
Recurrences: 0
Notes: Real negative control: writing 52 back into the source header turns the new case red, green again at 53; the test-title and group-count prose has no machine check and still relies on review
---
