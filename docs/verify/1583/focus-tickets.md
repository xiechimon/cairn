# #1583 focus tickets under the round-2 close guard

Replay input: `apps/server/test/fixtures/1583-2026-10-23-open.json`
(45 issues open at `2026-10-23T10:56Z`, morning-close wave from `10:55:48Z` restored,
`mainSha` `1442c6af…`, comments with `created_at` after the cutoff excluded).

Report: `docs/verify/1583/replay-report.json` (written by `scheduling-replay.test.ts`).

The round-2 rule (`closeSignal`) requires at least one checked acceptance box, zero
unchecked boxes, and a merged-PR **body** that names the issue. Superseding text,
ledger rows and handover comments cannot bypass that guard.

| issue | acceptance | merged-PR body naming it | replay group | why not `close` |
| --- | --- | --- | --- | --- |
| #1394 | 0 checked / 4 unchecked | none in the fixture | `next` | unchecked boxes block close |
| #1403 | 0 checked / 6 unchecked | #1537 #1531 #1509 #1489 #1414 | `next` | unchecked boxes block close (merged bodies cited in the reason only) |
| #1528 | 0 checked / 2 unchecked | #1548 #1547 #1546 | `next` | unchecked boxes block close |
| #1555 | 0 checked / 0 unchecked | #1558 | `next` | `closeSignal` also requires `checked > 0`; a merged body alone is not enough |

These four therefore land as needs-judgment (`next` with a human-judgment reason), not
`close`. That matches acceptance: document per issue why the rules refuse an automatic
close rather than override the box guard.
