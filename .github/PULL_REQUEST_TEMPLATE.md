## Proof

<!-- UI: before / after / unchanged screenshot table, one value line under each image (t3code #27472 style), taken from the running product (verify-cairn stack), never a fixture page or hand-made HTML.

Backend, when the diff touches apps/server/src/routes*.ts (the pr-evidence gate checks the shape): an evidence card under Proof, screenshot first.
### Requirement  -> internal: issue, PR or plan decision Dxxx link plus a quoted excerpt; third-party API: an embedded screenshot of the official doc (add a "Third-party:" line).
### Requests     -> an embedded screenshot of the real call (request and response visible: Swagger, Postman or the app), then a table: Clause | Request | Response | DB before to after | ok. A Before row is required for a new endpoint or a behavior change (one 404 or the old response is enough) and comes from the base branch or production, never a reverted copy. Generate it with: node .claude/skills/verify-cairn/scripts/vp.mjs drive api-evidence-card card -- <spec.json>.

Every PR that changes more than docs ends Proof with three lines, in a text fence so they stay out of the 600-character cap:
Live: what ran against the real system, and where.
Mocked: what was a fake, stub or emulator, or "none".
Not covered: what no check reached (this replaces "Not verified:").
Rollback: optional one line, for migrations, auth or billing: how to undo it and what it costs. -->

## What

<!-- One line: what changed, why, ticket and overlap result. When the title names a ticket, add `Closes #N` (finishes it) or `Part of #N` (one segment) on its own line. -->

<details><summary>Review and risk</summary>

## Review

<!-- Record vendor, model, fresh context, head SHA, rounds, verdict, and unfixed findings with reasons. -->

## Risk

<!-- State one-way or two-way door, blast radius, and whether the owner must merge. -->

</details>
