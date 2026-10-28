---
Category: Eval model names were treated as proof of a 1M runtime window while the provider omitted contextWindow
Source: PR #1879 real-model screening (2026-10-28)
Level: 2
Safeguard: CLI integration controls inspect actual models.json and scored rows record the explicit window; qualification rejects missing or sub-1M metadata
Intercepts: 1
Recurrences: 0
Notes: The old real screening used the backend's 128000 default and is not acceptance evidence. Its own process group was stopped. The actual old manifest is rejected by the new qualifier. Local-provider controls verify 1000000 in the materialized file and row, while the undeclared default remains unchanged.
---
