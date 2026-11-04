---
Category: A source-only push refspec inherited a destination mapping different from the branch used to certify delivery
Source: PR #2073 replacing #2047 (2026-10-28)
Level: 1
Safeguard: The branch push uses an explicit named source and destination refspec; real-Git controls exercise divergent and writable alternate mapped branches
Intercepts: 0
Recurrences: 0
Notes: Both controls fail on d19917ed before the repair. The explicit destination removes remote.origin.push destination inference while preserving the local branch ref seen by hooks. The earlier independent PASS missed the configuration and cannot override the reproduced BLOCK.
---
