---
Category: Another PR added blockerHandoff to the step input; the trajectory-pack schema requires the field but the exporter did not fill it, so after merging main the whole batch export failed, exposed only at prepush
Source: #1514 (2026-10-25)
Level: 2
Safeguard: The exporter takes the first snapshot from step.blockerHandoff and writes it into input; `trajectory-export.test.ts` adds a step case with blockerHandoff, asserting the field is exported verbatim and its fake token is masked, and the main case's input assertion gains blockerHandoff: null
Intercepts: 1
Recurrences: 0
Notes: Negative control: without changing the exporter the new case reports `Schema validation failed at input.blockerHandoff`, all 28 green after adding the field. The exporter constructs via parse(unknown), so the type layer cannot see new schema fields; the export tests intercept
---

