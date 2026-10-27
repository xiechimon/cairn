---
Category: The root script launched the tsx CLI directly and failed with IPC errors in an environment where listening on a local socket is forbidden
Source: #1514 (2026-10-24)
Level: 1
Safeguard: The root script uses the `node --import tsx` loader; the export tests run through `node --import tsx src/trajectory-export-cli.ts`, the same loading path as the root script
Intercepts: 1
Recurrences: 0
Notes: Negative control: the old tsx CLI failed with EPERM in createIpcServer; the Node loader does not establish that IPC, and the root-command tests pass
---

