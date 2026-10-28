---
Category: Loading a copied translation module from a temporary directory broke its relative imports
Source: PR #1769 translation-union verification (2026-10-28)
Level: 1
Safeguard: The union verification compares complete source lines without executing the copied module
Intercepts: 1
Recurrences: 0
Notes: The module loader rejected the temporary copy's relative fixture import. A full-source comparison removes module resolution from this check and proves every baseline line is unchanged, with exactly five added translation lines. No failed evaluation output is used as acceptance evidence.
---
