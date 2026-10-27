---
Category: A diagnostic command loaded `tsx` from the workspace root although only a child package supplied it
Source: #1744 CI diagnosis (2026-10-26)
Level: 1
Safeguard: The catalog diagnostic uses Node 26 native TypeScript loading with no external loader
Intercepts: 1
Recurrences: 0
Notes: Negative control: `node --import tsx` failed with ERR_MODULE_NOT_FOUND before reading the catalog; removing the unnecessary loader produced the actual 162-versus-157 roster comparison. No product code changed.
---
