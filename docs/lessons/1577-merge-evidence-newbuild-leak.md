---
Category: A merge-evidence helper also returned the internal marker `newBuild`, which `Object.assign` merged wholesale into the guard candidate row, adding an extra field to the persisted JSONL
Source: #1577 (2026-10-25)
Level: 2
Safeguard: `trajectory-reflect.test.ts` pins the full row shape of guard-candidates.jsonl with `toEqual`; `mergeEvidence` declares an explicit return type containing only buildIds and evidence, and the caller judges newness separately
Intercepts: 1
Recurrences: 0
Notes: real negative control: the first version's cross-round merge turned the full-row comparison red (extra newBuild), green after removing the marker; TypeScript does not excess-check `Object.assign` and spreading, so the type layer cannot catch it — the full-row assertion does
---
