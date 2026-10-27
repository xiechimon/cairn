# Recording evidence gate verification

## Failure modes

- Added motion or drag and hover handlers merge with only a screenshot.
- Copy-only changes or removed motion incorrectly require recordings.
- Motion token changes escape detection.
- A screenshot hides a later recording link because probing stops early.
- Missing, unreadable, empty or oversized recordings satisfy the gate.
- Cached screenshot presence prevents recording validation.
- The verifier receives no diff and omits the recording requirement.
- The recorder exits before Playwright finalizes its WebM.
- Archiving accepts recordings larger than 5 MiB.
- Evidence pruning retains recordings after their folder expires.

## Implementation and runtime evidence

- `readiness-red.log`: the new screenshot-only motion case failed against the old gate.
- `video-red.log`: the real-browser regression failed because capture returned no recording.
- `tools-green.log`: real Chromium emitted a nonempty WebM with the EBML header, the archive rejected an oversized file, and pruning removed GIF, WebM and MP4 along with screenshots. All ten tests passed. Test servers and browsers close during cleanup.
- Historical control: the unmodified motion CSS patch from [merged PR #1356](https://github.com/xiechimon/cairn/pull/1356) is preserved in `apps/server/test/fixtures/1783-motion-pr.json`. The readiness regression supplies valid current-repository screenshot links, then adds WebM: PNG-only is blocked and WebM clears the blocker. The old PR body used the former repository name, so replaying its links verbatim would independently fail link qualification.
- The trigger policy is one table in `packages/shared/src/records/recording-trigger.ts`, next to the merge-gate records so the gate worker still loads nothing but `zod` and that file. `records/merge-gate.ts` re-exports it; `digest.ts` (GitHub comparison projection), `records/verify.ts` (verification prompts) and `scripts/recording-gate.mjs` (local and CI prepush) all read the same table.
- Both the trigger list and the recording extensions are frozen, so a shared module cannot widen or narrow the gate lists at runtime.
- Missing web patches are not treated as motion: an absent patch already raises `opaque-file`, and guessing motion from absence turned every truncated-diff PR red. The real GitHub comparison sample keeps its 21 web files green.
- Watch lines use word boundaries: `promotion`, `motionDiv` and `setMotionEnabled` do not fire, while `transition`, `@keyframes`, `onMouseDown`, `hover:` and `scroll-behavior: smooth` do.
- `scripts/recording-gate.mjs` blocks locally and in CI prepush with `recording-missing` (no recording in `docs/verify/<ticket>/`) or `recording-too-large` (over 5 MiB, empty, or unreadable). Two ticket directories in one branch exit 2 rather than picking one.
- A qualifying recording must be a file, nonempty and no larger than 5 MiB at its linked commit. Missing or unreadable presence does not satisfy readiness. Supported extensions are GIF, WebM and MP4.
- `capture --video` records navigation and the configured wait interval. Interactions beyond navigation must be driven in a recording-enabled Playwright context, as the verification prompt states.
- Existing `evidence-prune` behavior is extension independent; only its regression fixture needed recordings added.

## Checks

- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: 344 files, 4,651 tests passed; exit 0. Summary: `prepush-vitest-green.log`.

- Targeted Vitest: 256 tests passed across four files.
- CLI selftest: 71/71 passed.
- Browser capture, archive and prune: 10/10 passed.
- `pnpm lint`: passed.
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: passed.
- `pnpm spec:parse`: 1,355 web tests in 189 files collected; 40 integration files parsed; passed.
- English-only, single-use-helper and comment-discipline gates: zero violations.
- Lessons ledger and whitespace checks: passed.

## Concurrent changes

The required open and last-30-merged PR inventories were read before editing. Open overlaps are #1879 for the shared gate constants, and #2026, #1993, #1940, #1928, #1867, #1727 and #1654 for the shared snapshot file. Existing lines were preserved. Recent merged overlaps are #1988, #1905 and #1878 for shared files, and #1883 for the CLI selftest; their added lines were preserved.

## Delivery

No push, staging or commit was performed. The sandbox-specific instruction requests `COMMIT_MSG.txt` instead; its last line is `Closes #1783`.

## Changed files

- `.claude/skills/verify-cairn/scripts/vp.mjs`
- `.claude/skills/verify-cairn/scripts/vp-selftest.mjs`
- `apps/server/src/services/merge-gate/digest.ts`
- `apps/server/src/services/merge-gate/github-facts.ts`
- `apps/server/src/services/merge-gate/readiness.ts`
- `packages/shared/src/records/merge-gate.ts`
- `packages/shared/src/records/verify.ts`
- `apps/server/test/merge-gate-readiness.test.ts`
- `apps/server/test/merge-gate-github-facts.test.ts`
- `apps/server/test/fixtures/1783-motion-pr.json`
- `packages/shared/test/verify-prompt.test.ts`
- `packages/shared/test/__snapshots__/snapshot.test.ts.snap`
- `scripts/vp-video.test.mjs`
- `scripts/evidence-prune.test.mjs`
- `docs/lessons/1783-*.md`: five process safeguards.
- `docs/verify/1783/`: execution report and red/green evidence logs.
- `COMMIT_MSG.txt`: commit handoff.
