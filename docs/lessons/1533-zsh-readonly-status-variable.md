---
Category: Used the zsh read-only variable `status` to capture an exit code in a shell command, aborting the cleanup that followed
Source: #1533 (2026-10-23)
Level: 3
Safeguard: Tool-command variables use a task-specific prefix, following the existing execution rules
Intercepts: 0
Recurrences: 0
Notes: The #1773 qualification report repeated this mistake on 2026-10-28. Its corrected command uses Python subprocess return codes and waits for artifact transfer completion. A command-entry safeguard is still needed; in-repo lint does not inspect interactive tool calls.
---
