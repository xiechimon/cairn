---
Category: Push author validation inspected only the root and missed bot-authored descendants
Source: PR #2033 review round 2 (2026-10-27)
Level: 2
Safeguard: Multi-commit push fixtures execute the workflow shell with before SHA and fallback paths
Intercepts: 1
Recurrences: 0
Notes: The old shell failed four negative controls; the corrected pushed range passes all 17 author policy tests while excluding historical bot commits
---
