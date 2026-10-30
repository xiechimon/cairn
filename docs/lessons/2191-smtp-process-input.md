---
Category: SMTP configuration and message content were assigned incompatible subprocess input streams
Source: Ticket #2191 (2026-10-30)
Level: 2
Safeguard: Run a scratch curl executable that reads configuration from stdin and mail from the named upload file
Intercepts: 0
Recurrences: 0
Notes: The original descriptor-based invocation failed the subprocess fixture; configuration now uses stdin and a private temporary mail file is removed after success or failure.
---
