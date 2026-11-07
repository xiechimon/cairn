# API evidence card

Backend PRs that change `apps/server/src/routes*.ts` carry an evidence card under Proof (D117, enforced by `scripts/pr-evidence-gate.py`): a requirement, a screenshot of the real call, and a table of requests with a Before row. This driver produces the call screenshot, the transcript and the table from a live stack so the author does not copy them by hand.

## Sub-features

- `card` runs the steps of a spec file against the isolated stack, reads SQLite rows before and after each step with a read-only connection, and writes `calls.txt`, `calls.png`, optional `get-NN.png` and `card-requests.md`.

## How to get to it (user POV)

- Driving (`vp.mjs list api-evidence-card` lists the case):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive api-evidence-card card -- <spec.json>`: run the spec and write the card files into the drive's evidence directory.

## Driving it with verify-cairn

Preconditions:

- `vp.mjs launch` from the worktree that holds the change, then `doctor.mjs` fully PASS.
- A spec file outside `docs/verify/`:

```json
{
  "steps": [
    { "clause": "Before", "on": "before", "method": "GET", "path": "/api/teams/{team}/drafts/todo:x", "expectStatus": 404 },
    { "clause": "survives close", "method": "PUT", "path": "/api/teams/{team}/drafts/todo:x", "body": { "content": "a" }, "expectStatus": 200, "sql": "select scope, content from composer_draft" },
    { "clause": "any device", "method": "GET", "path": "/api/teams/{team}/drafts/todo:x", "expectStatus": 200, "shot": true }
  ]
}
```

- `{team}` becomes the first team id. A step with `"on": "before"` needs `--before-port <port>`, the port of a second stack running the code without the change (launch it from a checkout of the base commit with `VERIFY_PORT` set and its own run directory); without the option the step is skipped and the card has no Before row.
- `sql` is a read-only query; its rows are compared before and after the request. A missing table prints `table absent`.
- `expectStatus` turns the `ok` column into `yes` or `NO`; any `NO` makes the drive fail.

Outputs in the evidence directory: `calls.txt` (the real transcript), `calls.png` (Chromium's plain-text view of that transcript file, so request and response are visible), `get-NN.png` (the live JSON view of a GET step with `"shot": true`), `card-requests.md` (the `### Requests` section to paste).

## Gotchas

- `calls.png` is a text-viewer capture of the real transcript, not a Swagger or Postman window. Prefer a screenshot of the real product UI or API tool when one exists, and use this capture when the change has no UI.
- Auth on the isolated stack is off, so a card cannot show per-user isolation; list that under `Not covered:`.
- The Before row needs a second stack on the base branch (or a read-only call to production), never a stack with your change reverted. Name it under `Live:`; if only a log line shows the old behavior, say so under `Mocked:`.
- Upload the screenshots to `pr-assets/<pr-number>` as `.claude/skills/pr-cairn/SKILL.md` describes; do not run the driver with `VERIFY_EVIDENCE_DIR` inside `docs/verify/`.
