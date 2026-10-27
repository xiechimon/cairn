---
Category: After adding a new shared record file, only the export was changed and the file itself was not landed; both Vitest and typecheck failed first on the missing module
Source: #1626 (2026-10-25)
Level: 2
Safeguard: Shared-entry changes and file existence are checked together by typecheck and the affected Vitest run; negative control: both go red when `packages/shared/src/records/report.ts` is missing, green after adding the file
Intercepts: 1
Recurrences: 0
Notes: The machine check already intercepts
---
