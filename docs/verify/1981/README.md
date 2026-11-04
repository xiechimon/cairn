# Documentation verification for #1981

Scope: implementer prompts and verify-cairn evidence requirements. No application,
provider, gate implementation or runtime behavior changed or was verified here.

## Reproduce

Run `python3 docs/verify/1981/checklist-check.py.txt` from the repository root.
The check was written and run before the documentation edits: `checklist-red.txt`
records 2/17 checks passing. The unchanged check after the edits passes 17/17 in
`checklist-green.txt`. These are text contract checks, not proof that an agent will
follow the instructions or that CI enforces their meaning.

## Review

All three implementer templates explicitly incorporate the shared checklist.
The same requirements appear in verify-cairn before its workflow instructions.
Existing fixture regression and real-daemon/stub-LLM recipes remain intact.
The checklist distinguishes those recipes' scope from real-app and real-provider
claims, requires delivery archives and mechanism artifacts, and identifies review
responsibilities separately from the existing image/section checks.

Read #1810's blocking findings before editing. The gate source still recognizes
only selected image URL forms and checks embedding/reachability, not archive
provenance. #1982 handles complete URL parsing, embedding classification and
fixture evidence; #1983 handles repository/issue archive provenance. Neither gate
change is included here, and #1810 remains incomplete.

No open PR touching either target document was returned by the pre-edit GitHub
query. Recently merged #1883 changed verify-cairn; its existing text is preserved.
The pre-existing `pnpm-lock.yaml` modification is outside this change.

## Final checks

- `node scripts/english-only-gate.mjs`: 0 Chinese lines.
- `node scripts/single-use-helper-gate.mjs`: 0 single-use helpers.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: exit 0;
  no changed test files selected (`prepush-vitest.txt`).
- `flock /tmp/cairn-heavy.lock pnpm prepush`: PASS, 25 checks
  (`prepush.txt`), including lint, typecheck, spec parsing and 89 passing
  documentation-reader tests. The attempted fetch failed with exit 255, so the
  checks used the existing local `origin/main`, which may be stale.
- The prepush E2E selector selected no web surface for this documentation change.
  No verification server was started and no real-app/provider claim is made.

`COMMIT_MSG.txt` contains the commit message for the sandbox handoff. The sandbox
handoff prohibits git staging and committing; the artifacts await that commit.
