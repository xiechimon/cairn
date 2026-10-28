---
Category: A historical report replay used a newer batch or omitted the metric configuration from its input snapshot
Source: PR #1864 verification (2026-10-28)
Level: 1
Safeguard: replay-history.py loads cases, metric configuration, results, and errors from one explicit commit; it verifies the documented batch and primary metric before running either executable, and records content hashes
Intercepts: 1
Recurrences: 1
Notes: Current main and the PR head contain 30 results and 46 errors, not the documented 176/16 batch. An initial replay also omitted _state.json and inferred receipt_ok. The structured entry refuses the wrong batch before creating output; the pinned 3e29c563 snapshot includes all required inputs and passes the actual oracle and report assertions.
---
