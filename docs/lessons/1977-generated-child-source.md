---
Category: A generated child-process script interpreted a newline escape before Node parsed it
Source: "#1977 (2026-10-28)"
Level: 1
Safeguard: Generate child JavaScript with a raw template literal and execute it in the cross-process lifecycle suite
Intercepts: 1
Recurrences: 0
Notes: The original generated script failed parsing in all three process tests; String.raw preserves the source escape and all three now pass
---
