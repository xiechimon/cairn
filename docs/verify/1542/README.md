# Verification for #1542

The advisory `probe-reach-gate` job extends the existing registry gate with
`--check-reach`. It checks added files against the PR base SHA, including local
staged and untracked additions. Existing files are not retroactively required
to join a family. Renamed destinations count as additions.

Specs must match prefixes consumed by the selector's file or directory rules,
or its a11y-axe rule for every source change. Self-selection and full-suite
fallback do not qualify. New drive scripts anywhere in the repository must be
registered as cases by their full repository-relative path. A support entry
alone does not qualify.

Run `node --test docs/verify/1542/reach.test.mjs`. The recorded output in
`tests.txt` covers uncovered specs (exit 1 naming the file), covered specs
(exit 0), unregistered and registered drives, and discovery of untracked,
staged and committed additions in an isolated Git repository. Adding a family
prefix in that repository changes the same uncovered spec from red to green.

Validation passed: `pnpm format`, `pnpm lint`, `pnpm typecheck`,
`pnpm spec:parse`, `node scripts/ui-debt-gate.mjs`, and
`node scripts/ui-dead-class-gate.mjs`. Spec collection found 1186 web tests in
170 files and parsed 30 integration test files.

The initial red test ran before the new selector flag existed. The old CLI
ignored the flag and attempted a11y-axe E2E; its preview server failed with
`listen EPERM 127.0.0.1:8398`. Browser execution could not be verified in this
sandbox. The implemented coverage mode exits before any browser or server is
started, and the regression tests exercise that mode without binding ports.

The existing CLI self-test initially passed 65/66 cases. Its nested temporary
Git repository case coincided with `/usr/bin/git` launching xcodebuild and
printing cache-directory errors. Rerunning with the direct Git binary passed
66/66: `PATH=/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH node .claude/skills/verify-pacman/scripts/vp-selftest.mjs`.

Both `node .claude/skills/verify-pacman/scripts/vp-registry-gate.mjs` and its
`--check-reach` mode passed on this branch. `git diff --check` passed and
`node scripts/comment-discipline-gate.mjs` reported zero new comment lines.

Local commit is blocked by the sandbox: explicit-path `git add` failed with
`Unable to create '.git/index.lock': Operation not permitted`. No files were
staged, committed or pushed, and no PR was opened.
