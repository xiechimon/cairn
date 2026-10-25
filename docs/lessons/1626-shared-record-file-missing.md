---
Category: After adding a shared record file, only the export was changed and the file itself was never created; Vitest and typecheck both failed first on the missing module
Source: #1626 (2026-10-25)
Level: 2
Safeguard: shared-entry changes and file existence are checked together by typecheck and the affected Vitest run; negative control: both go red while `packages/shared/src/records/report.ts` is missing, green after adding the file
Intercepts: 1
Recurrences: 0
Notes: the machine checks already block it
---
