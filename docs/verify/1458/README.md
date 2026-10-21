# #1458 evidence: two daemon tests pass in a root container with GIT_CONFIG_* set

Base = `00a2cc75` (this branch; both test files are unchanged since origin/main `23a39da9`). Branch = `claude/optimistic-albattani-r5pmfn`. Every run here is in this cloud container: uid 0, with `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` exported by the agent proxy setup.

Only the two tests change; no daemon source changes.

1. `apps/daemon/test/runner-brief.test.ts` "擦除失败 → 不 commitAll、按 failed 收尾、transcript 落行（失败方式 4）". The erase failure was injected with `chmodSync(cwd, 0o500)`, which root ignores. The test now replaces the brief file `AGENTS.md` with a directory of the same name during the session. `cleanupBriefFile` reads the file first, and reading a directory throws EISDIR for every user, the same injection "写失败即 fail-closed（失败方式 5）" uses. The test also asserts the erase-failure transcript row (`运行简报未能从工作区擦除`), so a failure earlier in the step cannot pass for this one.
2. `apps/daemon/test/workspace-hooks.test.ts` "失败方式 7：credentials 非空 → GIT_CONFIG_* 进钩子 env；null → 无注入". With null credentials `runWorkspaceHook` passes the parent environment through unchanged (the intended "no injection"), so the hook saw the container's own `GIT_CONFIG_COUNT`. The test now removes inherited `GIT_CONFIG_*` keys around that run with `vi.stubEnv(key, undefined)` and restores them with `vi.unstubAllEnvs()`.

## Runs

| file | what | result |
|---|---|---|
| `runner-brief-old-leg.txt` | base test, uid 0 | 1 failed: `expected [ 'commitAll', 'push', …(1) ] to not include 'commitAll'` |
| `runner-brief-new-leg.txt` | new test, uid 0 | 11 passed |
| `runner-brief-control-red.txt` | new test, runner with `briefCleanupFailed = true;` removed | 1 failed on `commitAll`: the test still catches a commit after a failed erase |
| `workspace-hooks-old-leg.txt` | base test, `GIT_CONFIG_*` in the env | 1 failed: `expected 'cred=3\n' to contain 'cred=unset'` |
| `workspace-hooks-new-leg.txt` | new test, same env | 9 passed |
| `workspace-hooks-control-red.txt` | new test, `runWorkspaceHook` injecting `GIT_CONFIG_COUNT: '1'` on null credentials | 1 failed: `expected 'cred=1\n' to contain 'cred=unset'` |
| `daemon-suite.txt` | whole daemon suite, uid 0 | 84 files, 850 passed |

Each control edit was made locally, run, and restored; `git diff` shows no change under `apps/daemon/src/`.

One more observation, not changed here: an earlier full-suite run had `workspace-hooks.test.ts` "失败方式 4：超时 → 杀整组进程" fail once with `pid … still alive after group kill`. That test gives a SIGKILLed grandchild 2 s to be reaped. It passed in the other full run and 5 of 5 runs of the file on its own, so it reads as load-sensitive rather than container-specific.
