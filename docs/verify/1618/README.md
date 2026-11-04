# #1618 bug-ticket reproduce-first, intake path

Scope: the follow-up to PR #1647 (bug label detection and the reproduce-first prompt block). This change adds end-to-end intake tests, tightens the label wording of the prompt, and records the replay of two ticket payloads through the intake code.

## Findings

- Trigger: intake and the webhook `pacman` trigger only import issues carrying `ready-for-agent` applied by a trusted human (D5). A new issue with only `bug` is not imported. This change leaves that unchanged (`routes-webhook.ts`, the intake filter and the D5 gate are untouched).
- Dedupe by ticket number: already provided by `claimedRefs` and `importsInFlight` (`importGithubIssue`). `scripts/dispatch-dedupe.mjs` is a lane-side tool (tmp worktrees, origin branches, open PRs, local agent processes) and is not usable from the server, so it is not reused. Pinned for bug issues by test 27b.
- Prompt gap fixed: intake issues already carry `ready-for-agent`, so "change to ready-for-agent" was a no-op, and the needs-info path never removed it. The prompt now names `gh issue comment`, keeps `ready-for-agent` on success, and runs `gh issue edit --add-label needs-info --remove-label ready-for-agent` on failure to reproduce.

## Tests

- `apps/server/test/issue-intake.test.ts` describe 27: 27a `Bug` label carries the block and a non-bug issue does not; 27b edits and label toggles never create a second card or thread; 27c body instructions stay inside the fence. 3 passed.
- `packages/shared/test/issue-fence.test.ts`: new assertions for `gh issue comment`, `--remove-label ready-for-agent`, `--add-label needs-info`.
- Negative control: with the previous `prompts.ts` the updated test fails with `AssertionError: expected '开始任务 #8 ...' to contain 'gh issue comment'` (1 failed, 20 passed); with the new string 21 passed.

## Replay

`replay.md` holds the chief message produced by two sweeps over `closed-bug-issue-1728.json` (real closed bug ticket #1728) and `thin-issue.json` (synthetic, empty body): one card and one chief thread each, reproduce-first block present, issue text inside the fence. The live-stack replay was not run, see `LIVE-REPLAY-BLOCKED.md`.
