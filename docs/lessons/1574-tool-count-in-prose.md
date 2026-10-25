---
Category: The tool count lived in prose: adding a tool updated only the constant, not the text (the header and the CHIEF_TOOL_COUNT comment still said 52, and a test title still had the old count)
Source: #1574 (2026-10-24)
Level: 2
Safeguard: `packages/shared/test/chief-tools.test.ts` reads every "currently N tools" in the source and requires it to equal `CHIEF_TOOL_COUNT`
Intercepts: 1
Recurrences: 0
Notes: real negative control: writing 52 back into the source header turned the new case red, changing it back to 53 turned green; test titles and group-count prose have no machine check and stay on review
---
