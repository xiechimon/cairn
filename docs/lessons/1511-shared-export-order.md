---
Category: Appended a new shared export at the end of the file instead of following alphabetical order
Source: #1511 (2026-10-23)
Level: 2
Safeguard: Biome organizeExports and the trajectory-pack test that imports from the shared package entry
Intercepts: 1
Recurrences: 0
Notes: The real negative case is the trajectory-pack export sorted after webhook; while moving the export the wrong colon was matched and an export was briefly dropped, caught by the package-entry test; re-verified after switching to the actual text anchor
---
