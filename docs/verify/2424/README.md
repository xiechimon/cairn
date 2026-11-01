# Issue #2424: new-task dialog

The requested production behavior already exists in this checkout. No production
code was changed. The regression exercises the compiled fixture application at
1440 × 800 and 390 × 800, in light and dark themes, using English UI translations.

## Coverage

- The body opens empty with all five translated template lines in its placeholder.
- Empty and whitespace-only input disables Save and Save and start.
- Typing hides the placeholder and enables both actions.
- The enabled start action has the computed `--primary` background: light
  `rgb(35, 49, 39)`, dark `rgb(230, 232, 226)`. Save stays transparent.
- Clearing restores the placeholder. Closing an untouched dialog requires no
  discard confirmation, and reopening starts empty.
- Saving creates a card titled with the user's input.

The regression was written before considering production changes. Its first run
failed because it sampled the disabled-to-enabled color transition immediately
and used a desktop-only entry point on phones. Waiting for the final CSS color
and using the shared board entry point corrected the test. The corrected tests
pass against the existing production implementation; no product failure was
manufactured.

## Screenshots

Eight screenshots record the existing correct implementation. Filenames encode
viewport width, theme, and body state:

- [Desktop light empty](1440-light-empty.png), [populated](1440-light-populated.png).
- [Desktop dark empty](1440-dark-empty.png), [populated](1440-dark-populated.png).
- [Phone light empty](390-light-empty.png), [populated](390-light-populated.png).
- [Phone dark empty](390-dark-empty.png), [populated](390-dark-populated.png).

An authentic defective before baseline is unavailable. The audit base
`64770927` already initializes an empty body, supplies the template as a
placeholder, and uses `DIALOG_PRIMARY_BUTTON`. The referenced
`ui-audit/2026-11-img/` directory is absent from this checkout. Empty/populated
screenshots above are state comparisons, not a claimed before/after code fix.

## Reproduction

```sh
CAIRN_E2E_EVIDENCE=docs/verify/2424 flock /tmp/cairn-heavy.lock \
  node scripts/heavy-slots.mjs run -- node scripts/e2e-affected.mjs \
  apps/web/e2e/newtask-single-field.spec.ts
```

The targeted file has 10 passing tests, including four viewport/theme cases.
`pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` pass.
`node scripts/prepush-vitest.mjs` exits 0; it selects no Vitest files for this
Playwright-only change. English and comment gates each report 0 violations.
`node scripts/single-use-helper-gate.mjs` cannot run because that script is absent
from this checkout (`MODULE_NOT_FOUND`). No new helper was introduced.

Open PRs and the 30 most recently merged PRs were inspected before editing;
none touches the changed test file. Existing production lines were preserved.
The live controlled-body path was inspected in `use-new-task-surface.ts` and
starts with `useState('')`; a live backend submission was not exercised by this
fixture test. Attachment and orchestration behavior were not changed.

The sandbox handoff requires `COMMIT_MSG.txt` instead of staging or committing.
No push was attempted. Playwright manages and stops its own preview server.
