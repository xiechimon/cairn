---
Category: A nested help flag was interpreted as an ai-route role
Source: PR #1769 review preparation (2026-10-28)
Level: 3
Safeguard: The dispatch prompt documents top-level ai-route --help and the required role position before assembling a command; since 2026-10-28
Intercepts: 0
Recurrences: 0
Notes: The real ai-route run --help invocation probed route availability and ended with KeyError before dispatching a model. The installed parser confirmed its positional role contract; ai-route --help returned the documented syntax. Type and parser enforcement belong to the external global CLI, outside this repository's delivery scope. No global configuration or other agent was changed.
---
