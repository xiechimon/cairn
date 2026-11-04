# #1286 recover-face session degradation verification

This page is the PR #1286 mechanism acceptance record. The fix addresses the daemon-restart journal continue always failing (the pi session's lazy-persist window loses the `.jsonl` on restart → `SessionNotResumableError` propagates straight into the step's failed).

## The fix

`apps/daemon/src/runner.ts`'s `openSession` catches the `SessionNotResumableError` again, but narrowed to the recover face (`opts.resume` present):
- recover face + `.jsonl` missing → degrade to `createSession` and resend journal.prompt (the step succeeds)
- recover face + journal.prompt null → explicit failure with readable copy (no silent empty resend)
- execution face (no `opts.resume`) → propagate into the step's failed (the #1260 semantics retained)

## Evidence method

Mechanism-class changes are accepted on artifacts (the repo AGENTS.md hard discipline): not by reading source, but by taking runtime evidence from the real path.

### Evidence 1: unit tests (five failure-mode-first, frozen)

`apps/daemon/test/runner-recover-degrade.test.ts`, one test per failure mode, where the recover face uses a stub backend whose `continueSession` throws `SessionNotResumableError` to directly simulate the missing `.jsonl`, asserting the step succeeds after degradation:

```
$ cd apps/daemon && npx vitest run test/runner-recover-degrade.test.ts

 ✓ test/runner-recover-degrade.test.ts (5 tests) 
   ✓ #1286 recover 面会话降级 (5)
     ✓ 1. recover + .jsonl 缺失 → 降级 new session，步成功（主 bug 修复）
     ✓ 2. recover + .jsonl 在 → 正常 continue，不触发降级
     ✓ 3. 非 recover（无 opts.resume）→ continue 失败直传步 failed（#1260 语义保留）
     ✓ 4. journal.prompt 为 null + .jsonl 缺失 → 显式失败带可读文案
     ✓ 5. chief 步 recover + .jsonl 缺失 → 降级 new session，同律
```

### Evidence 2: a real pi backend missing-session-file drill (a temporary PACMAN_HOME + a real SessionNotResumableError)

The unit test throws `SessionNotResumableError` via a stub, but the real trigger condition "the `.jsonl` is missing on recover" is judged by the pi backend's `continueSession` `existsSync(file)`. The script below uses a temporary `PACMAN_HOME` to build a scenario with **a journal entry, an index.json entry, but no `.jsonl` on disk**, runs `PiBackend.continueSession`, asserts it really throws `SessionNotResumableError` (the exact error that would have propagated to failed before the fix), and then asserts `SessionNotResumableError` is a subclass of `Error` and that `instanceof` works (the runner's degradation chain depends on it).

Run: `bash docs/verify/1286/recover-degrade.sh`

Output: see [output.log](./output.log).
