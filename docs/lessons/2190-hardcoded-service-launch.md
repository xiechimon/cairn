---
Category: A restore service assumed a fixed checkout path and interactive dependency resolution
Source: #2190 (2026-10-30)
Level: 2
Safeguard: Configured-checkout launcher with executable missing-node, missing-python3, missing-sqlite3 and missing-tsx regressions
Intercepts: 0
Recurrences: 0
Notes: The launcher changes into the configured server package before importing tsx. A scratch checkout whose path contains spaces verifies command and working-directory propagation; Linux systemd parsing remains host acceptance.
---
