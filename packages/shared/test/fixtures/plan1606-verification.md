## Verification

Every item below is a command plus an assertable result. Items 1–2 re-verify the ticket's
acceptance on main before the doc is written (each names its pinning test file); items 3–6
gate the docs change and the PR body; items 7–8 run before merging; item 9 runs after the
squash merge.

1. Run the acceptance suite over the three pinning test files
   `apps/server/test/trajectory-attribution.test.ts`,
   `packages/shared/test/trajectory-pack.test.ts`,
   `apps/server/test/trajectory-export.test.ts`:

   ```sh
   pnpm exec vitest run apps/server/test/trajectory-attribution.test.ts packages/shared/test/trajectory-pack.test.ts apps/server/test/trajectory-export.test.ts
   ```

   Assert: exit code 0, and the summary prints `Test Files  3 passed (3)` and
   `Tests  47 passed (47)` (measured on this lane at main `0d828672`). Within the run,
   the ticket's three acceptance items are pinned by name: `packs written before the
   field existed parse with attribution null` and the out-of-enum rejections in
   `packages/shared/test/trajectory-pack.test.ts`; `stable output: relabeling the same
   input yields the same structure` and `rejects a labeler that is the tested model, with
   or without provider prefix` in `apps/server/test/trajectory-attribution.test.ts`;
   `summary prints a (where, why) count table sorted by count` in the same file. Save the
   run's summary tail (the `Test Files` and `Tests` lines plus the per-file pass lines) as
   `docs/verify/1606/unit.txt`.
2. Run the summary command on the committed fixture
   `apps/server/test/fixtures/trajectory-attribution/labeled.jsonl`:

   ```sh
   pnpm traj:attribution test/fixtures/trajectory-attribution/labeled.jsonl
   ```

   Assert: exit code 0, and stdout is exactly these six lines (tab-separated; measured on
   this lane):

   ```
   where	why	count
   runtime	premature_finish	2
   prompt	ignored_instruction	1
   runtime	wrong_tool	1
   infra	other	1
   total=6 unlabeled=1
   ```

   Save this stdout as `docs/verify/1606/summary.txt`.
3. Run the English-only gate over the branch's added lines:

   ```sh
   node scripts/english-only-gate.mjs
   ```

   Assert: exit code 0 and stdout `english-only-gate: 0 line(s) with Chinese text`. A
   violation instead prints each offending `path:line` to stderr and exits 1; the gate
   diffs added lines against `origin/main`, and a docs-only lane that adds only English
   lines gets the zero-count result.
4. Run the banned-vocabulary scan over the new doc:

   ```sh
   grep -nE -f .husky/banned.txt docs/ops/failure-attribution.md
   ```

   Assert: no output, exit code 1 (grep found no match). Any match is a banned word
   (`.husky/banned.txt`) on a line of the new doc and blocks the commit via the hook.
5. Run all three PR-body gates on the body file:

   ```sh
   python3 scripts/pr-evidence-gate.py /tmp/pr.md
   python3 scripts/pr-tasks-gate.py /tmp/pr.md
   node scripts/english-only-gate.mjs --text /tmp/pr.md
   ```

   Assert: exit code 0 for each of the three commands. `pr-evidence-gate.py` exits 1 and
   names the section or URL on any missing/empty section or non-embedded image link;
   `pr-tasks-gate.py` exits 1 on `no-tasks` or `unchecked-task`; the language check exits
   1 with the offending line on any Chinese outside backticks.
6. Run the pre-push selection:

   ```sh
   pnpm prepush
   ```

   Assert: exit code 0. For a docs-only diff it selects the language gate (no code
   checks, no e2e); a red run prints the failing check name and blocks the push.
7. Run the pre-merge checks on the PR:

   ```sh
   grep -c "raw.githubusercontent.com/xiechimon/cairn/.*/docs/verify/1606/" /tmp/pr.md
   gh pr view <n> --json labels -q '.labels[].name'
   ```

   Assert: the grep prints a count ≥ 2 (one raw link per committed evidence file), and the
   label list output contains no `needs-decision`. The Acceptance checklist carries no
   `- [ ]` (already asserted by `pr-tasks-gate.py` in item 5).
8. Run the commit-message checks on the branch head:

   ```sh
   git log -1 --format=%B
   git log -1 --format=%B | grep -icE '(close[sd]?|fix(e[sd])?|resolve[sd]?) #[0-9]+'
   git log -1 --format=%B | tail -n 1
   ```

   Assert: the first command's output ends with the keyword line; the second prints `1`
   (only `closes #1606`, no negated or accidental keyword shape anywhere in the message);
   the third prints exactly `closes #1606`.
9. Run the post-merge checks after the squash merge lands on main:

   ```sh
   gh issue view 1606 --json state -q .state
   gh api repos/xiechimon/cairn/commits/<merge-sha> -q .commit.message
   ```

   Assert: the first prints `closed`; the second returns a message whose last line is
   `closes #1606`. If the issue is still open after the merge, the keyword did not ride
   the squash message; escalate rather than editing the PR body.
