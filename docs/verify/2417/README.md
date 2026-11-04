# Sidebar naming and translation-call coverage

The home navigation now uses the existing Workbench source key, schedules
navigation uses the existing Schedules source key, and the project group uses
the existing Project source key. Routes, attention counts and group storage
are unchanged.

## Negative controls

- [Required negative-control output](red.log): preserves the audit-source gate
  failure for Projects and Scheduled at the acceptance checklist's required path.
- [Initial red gate](gate-before.txt): after adding the scanner support and
  before changing labels, the corpus assertion found Projects, Scheduled,
  and ten other distinct English keys absent from EN.
- [Audit-source red gate](audit-base-red.txt): the actual coverage test ran
  with `board/sidebar.tsx` loaded from `git show 64770927:apps/web/src/board/sidebar.tsx`.
  It failed on Projects and Scheduled. Other files used the current worktree,
  including the explicit dictionary entries for the ten existing English keys.
  This is a source-level negative control, not a full historical application build.
- [Green gate](gate-after.txt): both test files pass after the naming fix.
  The scanner tests were added and run failing before implementation.

The new assertion scans every TypeScript source directory, including fixtures
and API sources excluded by the older CJK rule. It checks literal first
arguments of direct translation calls. Comments, unrelated strings, object
methods and dynamic arguments do not count. Existing English wording outside
the requested sidebar labels is explicitly registered in EN without changing
its display behavior.

## Screenshots

Each pair shows the same fixture, viewport and theme before and after the
sidebar label change. Home uses scenario 01; schedules uses scenario 11.
Desktop is 1440×844; phone is 390×844 with the navigation drawer open.
Before screenshots use the worktree's original sidebar, rather than rebuilding
the entire historical audit revision. A temporary Playwright capture spec ran
through `scripts/heavy-slots.mjs`, using the existing `evidenceShot` helper.
The capture waited for the sidebar to settle at its final position.

- Home, desktop light: [before](before/home-1440-light.png), [after](after/home-1440-light.png).
- Home, desktop dark: [before](before/home-1440-dark.png), [after](after/home-1440-dark.png).
- Home, phone light: [before](before/home-390-light.png), [after](after/home-390-light.png).
- Home, phone dark: [before](before/home-390-dark.png), [after](after/home-390-dark.png).
- Schedules, desktop light: [before](before/schedules-1440-light.png), [after](after/schedules-1440-light.png).
- Schedules, desktop dark: [before](before/schedules-1440-dark.png), [after](after/schedules-1440-dark.png).
- Schedules, phone light: [before](before/schedules-390-light.png), [after](after/schedules-390-light.png).
- Schedules, phone dark: [before](before/schedules-390-dark.png), [after](after/schedules-390-dark.png).

## Verification

- Focused scanner and coverage tests: 35 passed.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: 21 files,
  168 tests passed.
- Affected E2E selection explicitly included all nine changed specs: 86 passed.
  The default affected selection expands to the full suite because the
  dictionary is a shared surface; that full suite was not run locally.
- Navigation naming checks cover both languages, expanded sidebar, collapsed
  rail and phone drawer, page titles and current-page accessibility state.
- Screenshot capture: four cases per phase passed, producing eight images
  per phase.
- `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse` passed.
- English-only and comment-discipline gates: zero violations.
- `scripts/single-use-helper-gate.mjs` is absent in this checkout; the requested
  command failed with `MODULE_NOT_FOUND`. No new helper functions were added.

Heavy checks ran one at a time under `/tmp/cairn-heavy.lock`. Playwright owned
and stopped its preview servers. No push or issue/PR write was performed.

Open PR #2357 overlaps `apps/web/src/board/sidebar.tsx` and
`apps/web/src/i18n/en.ts`; its existing sidebar and menu behavior is preserved.
The merged project-avatar and snooze additions remain intact.

## Follow-up scanner review

Optional direct calls such as `t?.('Projects')` previously escaped the new
translation-key gate. Two regression cases failed before the scanner change;
optional direct calls are now collected, while optional object methods remain
excluded. The focused suites pass 38 tests and prepush Vitest passes 171 tests
in 21 files. Lint, typecheck and spec parsing pass; English-only and comment
discipline report zero violations. The requested single-use helper gate is
still absent, so that command cannot pass. No server was started for this
scanner-only follow-up. The existing lockfile modification was left untouched.
