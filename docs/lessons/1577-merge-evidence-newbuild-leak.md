---
Category: The merge-evidence helper also returned the internal marker `newBuild`, which `Object.assign` merged wholesale into the guard candidate row, leaving an extra field in the persisted JSONL
Source: #1577 (2026-10-25)
Level: 2
Safeguard: `trajectory-reflect.test.ts` pins the whole-row shape of guard-candidates.jsonl with `toEqual`; `mergeEvidence` explicitly declares a return type containing only buildIds and evidence, with whether-it-is-a-new-build decided separately by the caller
Intercepts: 1
Recurrences: 0
Notes: Real negative control: the first version's cross-run merge comparison went red (extra newBuild), green after removing the marker; TS performs no excess-property checks on `Object.assign` and spreads, so the type layer cannot intercept — caught by the whole-row assertion
---

