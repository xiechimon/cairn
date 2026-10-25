---
Category: A tool-event test fixture wrote `args` instead of `arguments`
Source: #1591 (2026-10-24)
Level: 1
Safeguard: tool-call fixtures are explicitly annotated `ToolCallRecord`, and daemon typecheck also covers the test directory
Intercepts: 1
Recurrences: 0
Notes: the wrong field's negative control was tsc reporting TS2353; repo-wide typecheck passes after changing to arguments
---
