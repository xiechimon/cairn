---
Category: Historical commit messages would close an unfinished parent issue despite a partial-delivery PR body
Source: PR #1933 merge preparation (2026-10-28)
Level: 2
Safeguard: The committed merge-message verifier rejects closing keywords for parent #1744; the draft remains held until review and the verified explicit squash message are ready
Intercepts: 1
Recurrences: 0
Notes: The original messages fail with three closing keywords. The prepared squash message passes. Default squash aggregation must not be used for this partial delivery; the parent still lacks production step-survival acceptance.
---
