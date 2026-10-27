---
Category: A clean merge introduced the same translation key from two independent UI changes
Source: PR #1828 reconciliation (2026-10-28)
Level: 2
Safeguard: Biome noDuplicateObjectKeys rejects repeated translation keys in pnpm lint and prepush
Intercepts: 1
Recurrences: 0
Notes: The first reconciliation failed lint on the comma translation key; keeping main's single identical mapping makes that check green without changing the translated value
---
