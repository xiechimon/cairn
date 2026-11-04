# #1211 verification evidence — local-repo build never touches the user's main checkout

Change: removed the merge step's `git merge --ff-only` in the user's repository directory (`landLocalFastForward` / `mergeFfOnly` and the shared `WorktreeOps` slot removed with it). The landing = the conv branch pushed back to the user repo's refs/heads; the user's main checkout's branch/reflog/worktree is never touched by pacman.

## Criteria (ticket acceptance → evidence mapping)

- Acceptance 1 (zero additions to the main checkout's reflog/status after the full lifecycle): `after-g2t2-m3b-integration.txt` failure modes 1-3 — real server + real daemon + stub LLM + real git full lifecycle, comparing `git reflog main` verbatim after the plan/build/review phases and once more after the merge: unchanged, HEAD stays at the seed tip, `status --porcelain` empty, no probe lines in the worktree.
- Acceptance 2 (branch operations happen only in the isolated worktree/clone): `after-daemon-full.txt` includes `local-executor.test.ts` (the base clone lands at `<workspacesRoot>/<projectId>/repo`, the hardlink face) and `runner-local.test.ts` failure mode 2 (real WorkspaceManager full chain; all git writes act on the base clone / conv worktree).
- Acceptance 3 (checking "merge into the default branch" = merge inside the isolated clone + push origin, never touching the main checkout): `after-g2t2-m3b-integration.txt` failure mode 3 — after the merge step is done, the user repo's `refs/heads/pacman/conv-<id>` = the merge checkpoint and the user's main is untouched; the dirty-worktree variant (failure mode 4) still merges to done with the user's uncommitted changes intact.
- Acceptance 4 (hosted regression): `after-g2t2-m3b-integration.txt` contains the m3b-demo 4/4 (runner close-out common-chain comparison).

## Before/After

- `before-red-vitest.txt`: the new criteria run on the pre-change HEAD (b909d1dd) — 3 reds: failure modes 1/7 see `landLocalFastForward` being called; failure mode 2 sees the user repo's HEAD ff-advanced from the seed tip to the conv tip (i.e. the #1211 report confirmed).
- `after-green-vitest.txt`: the same two files 17/17 green (failure mode 2 = the user repo's reflog verbatim unchanged + the conv branch in place).
- `after-g2t2-integration.txt` / `after-g2t2-m3b-integration.txt`: integration full lifecycle 2/2, hosted comparison included 6/6.
- `after-daemon-full.txt`: apps/daemon full unit suite green, 71 files / 713 cases.
- shared 339/339, server `g2t2-executor-wire` 4/4, `pnpm lint` / `pnpm -r typecheck` / `pnpm spec:parse` all pass (run in the terminal, not archived separately).
