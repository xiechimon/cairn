---
Category: The old demo fixture referenced transcript and machine fields no longer supported on main
Source: PR #1769 conflict reconciliation (2026-10-28)
Level: 1
Safeguard: TranscriptItem and MachineRow types reject the stale tools variant and removed shellEnabled fields
Intercepts: 1
Recurrences: 0
Notes: The initial typecheck failed on all four stale declarations. Tool records are represented with the current work-step variant and obsolete machine metadata is omitted. The old command descriptions remain in the demo steps. No type union or assertion was widened.
---
