# Issue 2024 verification

The regression test was written and run before editing either merge instruction.
The original instructions failed both documentation cases; the unchanged workflow
passed the temporary-history author checks. See red.log and green.log for output
from `node --test scripts/commit-author-policy.test.mjs`.

The updated instructions require one Cairnwright-authored commit and rebase for
bot-opened PRs, while human-opened PRs retain squash. The workflow is unchanged.
The external dispatcher helper was not inspected or modified.

Open PR #1848 adds overlap guidance at the start of the skill's Mechanics section.
This change edits its final merge instructions and does not undo that PR's lines.
Merged PR #1905 added the identity document's create throttle section; that section
is unchanged.

Validation:

- Regression: 3 passed, including real temporary Git histories.
- English-only gate: 0 lines with Chinese text.
- Single-use helper gate: 0 helpers.
- Comment discipline gate: 0 new comment lines.
- pnpm lint: passed.
- pnpm typecheck: passed under flock /tmp/cairn-heavy.lock.
- pnpm spec:parse: passed, 1355 web tests collected and 40 integration files parsed.
- node scripts/prepush-vitest.mjs: exit 0 under flock /tmp/cairn-heavy.lock;
  no affected Vitest files selected. The Node regression test ran separately.
- git diff --check: passed.

No servers were started. Historical main authorship and the old Actions result
are unchanged; these instructions cannot enforce an uninspected external helper.
