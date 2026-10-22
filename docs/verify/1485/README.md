# #1485 evidence: the credential helper passes username and password to git unchanged

Base = `659d8cb5` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

`apps/daemon/src/git.ts` `gitCredentialEnv` builds the inline helper that git runs with `sh -c`. The values are now inside single quotes, with `'` escaped as `'\''` by the existing `sq()`:

```
!f() { echo 'username=<u>'; echo 'password=<p>'; }; f
```

Before, the values sat outside quotes, so `sq()` did nothing and the shell expanded `$(...)`, backticks and `$VAR`, split on `;`, collapsed runs of spaces and ate backslashes. Today both values come from the server (the constant `x-access-token` and a GitHub OAuth token or the hosted per-step key), so no current input contains these characters.

## Tests

`apps/daemon/test/git.test.ts`, block `#1485`. Each case runs a real `git credential fill` with the helper and reads back the field.

| file | `git.ts` | result |
|---|---|---|
| `old-leg.txt` | origin/main | 9 failed, 1 passed. `abc$(echo INJECTED)` → `abcINJECTED`; ``a`echo INJECTED`b`` → `aINJECTEDb`; `$HOME` → the home path; `a;echo INJECTED` → `a`; `it's` → no password at all; `two  words` → `two words`; `back\slash` → `backslash`; the username case likewise; the `$(touch <marker>)` password created the marker file. `*` passes on both sides (no file matches `password=*`) |
| `new-leg.txt` | this branch | 10 passed |

The whole daemon suite is in `docs/verify/1484/daemon-suite.txt` (896 passed).

## Rerun

```sh
cd apps/daemon
pnpm exec vitest run --reporter=verbose test/git.test.ts -t '#1485'
```
