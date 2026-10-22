# #1485 evidence: the credential helper passes username and password to git unchanged

Base = `659d8cb5` (origin/main). Branch = `claude/optimistic-albattani-r5pmfn`.

`apps/daemon/src/git.ts` no longer puts the username and password into the helper's shell text at all. The helper body is a fixed string, `CREDENTIAL_HELPER`, that prints them from environment variables:

```
printf 'username=%s\npassword=%s\n' "$PACMAN_GIT_CRED_USERNAME" "$PACMAN_GIT_CRED_PASSWORD"
```

`%s` prints its argument byte for byte, and a quoted variable expansion is not expanded again, so no character in a value has a meaning to the shell or to `printf`. The host check that comes with it is #1484 (`docs/verify/1484/README.md`).

On origin/main the values sat in `echo username=<u>; echo password=<p>` outside quotes. The shell expanded `$(...)`, backticks and `$VAR`, split on `;`, collapsed runs of spaces and ate backslashes.

The branch's first fix (`86923c68`) put them inside single quotes. That stopped the shell, but `echo` in dash (this container's `/bin/sh`) and in macOS `sh` still interprets backslash escapes: `\n` became a newline, `\c` cut the value, and `\0101` became `A`. The security review caught it; `printf '%s'` has neither problem.

Today both values come from the server: the constant `x-access-token`, and a GitHub OAuth token or the hosted per-step key. So no current input contains these characters.

## Tests

`apps/daemon/test/git.test.ts`, block `#1485`. Each case runs a real `git credential fill` with the helper and reads back the field.

| file | `git.ts` | result |
|---|---|---|
| `old-leg.txt` | origin/main | 12 failed, 1 passed. `abc$(echo INJECTED)` → `abcINJECTED`; ``a`echo INJECTED`b`` → `aINJECTEDb`; `$HOME` → the home path; `a;echo INJECTED` → `a`; `it's` → no password at all; `two  words` → `two words`; `back\slash` → `backslash`; the username case likewise; the `$(touch <marker>)` password created the marker file; the three escape cases below fail too. `*` passes on all three versions (no file matches `password=*`) |
| `first-leg.txt` | `86923c68` (single-quoted `echo`) | 3 failed, 10 passed: `a\nb` → `a`, `x\cy` → `x`, `\0101` → `A` |
| `new-leg.txt` | this branch | 13 passed |

The whole daemon suite is in `docs/verify/1484/daemon-suite.txt` (912 passed).

## Rerun

```sh
cd apps/daemon
pnpm exec vitest run --reporter=verbose test/git.test.ts -t '#1485'
```
