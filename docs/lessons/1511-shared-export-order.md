---
Category: A new shared export was appended at the end of the file instead of following alphabetical order
Source: #1511 (2026-10-23)
Level: 2
Safeguard: Biome organizeExports plus the trajectory-pack test that imports from the shared package entry
Intercepts: 1
Recurrences: 0
Notes: the real negative case was the trajectory-pack export sitting after webhook; while moving the export a wrong colon was matched and the export was almost dropped, caught by the package-entry test; re-verified with the actual text anchor
---
