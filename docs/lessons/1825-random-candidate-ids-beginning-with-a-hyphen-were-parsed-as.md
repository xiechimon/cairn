---
Category: Random candidate IDs beginning with a hyphen were parsed as CLI options, making curation lifecycle tests fail intermittently
Source: #1825 (2026-10-26)
Level: 2
Safeguard: Curation lifecycle tests pin hyphen-prefixed IDs and pass them with `--confirm=<id>` and `--dismiss=<id>`
Intercepts: 2
Recurrences: 0
Notes: Negative controls: separate option values reproduce the generic curation error for both confirmation and dismissal; attached values preserve the lifecycle assertions
---
