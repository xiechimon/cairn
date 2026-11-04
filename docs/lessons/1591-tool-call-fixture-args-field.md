---
Category: The tool-event test fixture wrote arguments as args by mistake
Source: #1591 (2026-10-24)
Level: 1
Safeguard: Tool-call fixtures are explicitly annotated `ToolCallRecord`; the daemon typecheck also covers the test directory
Intercepts: 1
Recurrences: 0
Notes: The negative control for the original wrong field is TS2353 from tsc; the full-repo typecheck passes after changing to arguments
---
