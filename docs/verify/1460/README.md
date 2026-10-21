# #1460 evidence: per-step git credentials keep the machine's own GIT_CONFIG_*

Base = `dabef481` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`. Every run here is in this cloud container: uid 0, with `GIT_CONFIG_COUNT=3` and three `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*` entries exported by the agent proxy setup. That is the case the ticket describes.

`apps/daemon/src/git.ts` `gitCredentialEnv(cred, parent = process.env)` reads the parent's `GIT_CONFIG_COUNT`. When it is a decimal integer n and every `GIT_CONFIG_KEY_i` / `GIT_CONFIG_VALUE_i` below n is set, the empty `credential.helper` reset goes at index n, the inline helper at n+1, and the count becomes n+2. Otherwise git already fails in the parent environment ("bogus count", "missing config key"), and the entries start at 0 with `COUNT=2`, as before. Both callers merge the result over `process.env`: `runGit` and `runWorkspaceHook` (`apps/daemon/src/workspace-hooks.ts`). The default parent is that same environment, so neither caller changes.

The reset still clears every helper configured before it, including one the parent's entries set, so the inline helper stays the only credential source. The machine path (`machineGitEnv`) is unchanged.

## Tests

`apps/daemon/test/git.test.ts` gains a `#1460` block. Its header lists the five failure modes.

| test | what it pins |
|---|---|
| 失败方式 1 | parent with 3 entries: kept as they are, reset at 3, helper at 4, `COUNT=5` |
| 失败方式 2 | no parent `GIT_CONFIG_*`: `COUNT=2`, reset at 0, helper at 1 (unchanged) |
| 失败方式 3 (5 cases) | parent count `abc`, `-1`, `1x`, a missing KEY, a missing VALUE: entries start at 0, `COUNT=2` |
| 失败方式 1/4, real git | parent sets `pacman.probe=kept` and a `credential.helper` that answers `STALE_REVOKED`: `git config --get pacman.probe` prints `kept`, and `git credential fill` returns the step token, not the stale one |
| 失败方式 5 | the production composition: `process.env` stubbed with one entry, `gitCredentialEnv(cred)` with the default parent, then `runGitOk(['config', '--get', 'pacman.probe'])` prints `kept` |

`apps/daemon/test/workspace-hooks.test.ts` "失败方式 7b" runs a hook with credentials while the parent has one entry. The hook sees `GIT_CONFIG_COUNT=3`, and `git config --get pacman.probe` inside the hook prints `kept`.

Three existing tests assumed the helper sits at a fixed slot, and they pass in this container only because the old code overwrote the container's entries:
- `workspace-hooks.test.ts` "失败方式 7" and `workspace.test.ts` "钩子消费步级凭据" assert `cred=2`. They now strip inherited `GIT_CONFIG_*` around the run with `vi.stubEnv(key, undefined)` and restore with `vi.unstubAllEnvs()`, as #1458 did for the null-credential run.
- `local-executor.test.ts` "失败方式 5" recorded only `GIT_CONFIG_VALUE_1` from its git shim and checked it for the token. Here index 1 is the container's own entry, so the first whole-suite run on the fix failed there. The shim now records every `GIT_CONFIG_VALUE_*`. The check is the same: the token travels in the environment and never in argv.

## Runs

| file | what | result |
|---|---|---|
| `old-leg.txt` | `git.ts` from origin/main, this branch's tests | 4 failed, 59 passed. `expected '2' to be '5'`; real git `expected '' to be 'kept'`; runGit `expected '2' to be '3'`; hook `expected 'cred=2\nprobe=\n' to contain 'cred=3'`. 失败方式 2 and 3 pass on both sides: they pin behaviour that does not change |
| `new-leg.txt` | this branch | 63 passed |
| `control-red.txt` A | the KEY / VALUE presence loop removed (any decimal count trusted) | the missing-KEY and missing-VALUE cases fail (`expected '4' to be '2'`, `'3'`) |
| `control-red.txt` B | the empty reset removed (helper alone at n) | 11 failed, among them the real-git case: `git credential fill` returns the parent's stale helper's answer instead of the step token |
| `daemon-suite.txt` | whole daemon suite on the branch | 84 files, 860 passed (850 before; 10 new) |

Each control edit was made locally, run, and restored. `control-red.txt` ends with a check that `git.ts` matches the fixed file.

`node scripts/e2e-affected.mjs --dry-run` selects no specs (daemon files only). `pnpm lint`, `pnpm typecheck` and `pnpm spec:parse` pass.

## Rerun

```sh
cd apps/daemon
pnpm exec vitest run --reporter=verbose test/git.test.ts test/workspace-hooks.test.ts test/workspace.test.ts test/local-executor.test.ts
```
