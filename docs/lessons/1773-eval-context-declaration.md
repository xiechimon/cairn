---
Category: Eval model names were treated as proof of a 1M runtime window while the provider omitted contextWindow
Source: PR #1879 real-model screening (2026-10-28)
Level: 1
Safeguard: Explicit windows reject a chief model outside the roster before stack startup; error rows use requested_context_window while scored runtime controls inspect models.json
Intercepts: 4
Recurrences: 1
Notes: Independent review found fallback-model and pre-materialization error attribution gaps. Three real CLI controls failed before the correction and 110 related checks passed afterward. The old real screening used the backend's 128000 default and is not acceptance evidence. Its own process group was stopped. The actual old manifest is rejected by the new qualifier. Local-provider controls verify 1000000 in the materialized file and row, while the undeclared default remains unchanged.
---
