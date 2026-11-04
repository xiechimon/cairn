# #681 — i18n-coverage gate hangs forever on `#` inside a regex literal

The gate's token walk (`apps/web/test/i18n-coverage.test.ts`, now extracted to
`apps/web/test/i18n-scan.ts`) calls the TS 7 native scanner without ever
rescanning `/` as a regex literal, so a regex body scans as ordinary code
tokens. A `#` whose next character cannot continue a token (`/#/`, `/^#/`,
`/^#(\d+)$/`, `#(`) scans as a **zero-length `PrivateIdentifier` at the same
offset forever**, and the walk's `for(;;)` loops had no zero-advance check —
the gate spun at ~100% CPU with no output and no timeout, indistinguishable
from the known "Install Playwright chromium" CI hang.

Fix: (1) `/` in regex position now rescans via `reScanSlashToken()` — the
regex is one token, its body is never mis-scanned as code; (2) a zero-advance
guard turns any future wedge into a loud `file:line:col` error instead of a
hang. Pins: `apps/web/test/i18n-scan.test.ts`.

## Evidence 1 — live capture of the spinning orphan (the only in-the-wild instance)

Captured 2026-10-03 by the coordinator while cleaning up thread processes: a
real orphaned vitest worker from the deleted t-0059 worktree (branch content
carried the `/^#(\d+)$/` shape from #675/#678), **running 9h40m at 84–91%
CPU**, ppid=1, cwd dangling.

- `live-capture-processes.txt` — `ps` rows: pid 85912 (vitest) → 85919
  (forks.js worker, 96.1% CPU, ELAPSED 09:41:31).
- `live-capture-sample.txt` — `sample(1)` of the worker (4s @ 1ms):
  **3189/3189 samples in one stack**, no IO, no GC churn:

  ```text
  Builtins_ArrayPrototypeFlatMap        <- files.flatMap(scan) at i18n-coverage.test.ts:293
  Builtins_FlattenIntoArrayWithMapFn
  ??? (in <unknown binary>)             <- JIT-compiled scan() body — all samples here
  ```

- `live-capture-notes.md` — the coordinator's field notes (facts, reading,
  repro context). Copied from `~/.herdr-projects/pacman/scratch/` (a scratch
  area subject to cleanup) so the capture survives with the PR.

## Evidence 2 — deterministic repro on main (pre-fix)

On main (`1877a835`, clean tree), add the trigger to any scanned file:

```sh
cd apps/web
cat > src/repro-681-hang.ts <<'TS'
export const seq = /^#(\d+)$/.exec('x')?.[1];
TS
npx vitest run test/i18n-coverage.test.ts --reporter=dot   # never finishes
```

Killed after a bounded 46s window (the hang itself is unbounded — the live
capture above ran 9h40m):

- `vitest-hang.log` — full log at T+40s: the `RUN` banner and nothing else.
  No test results, no failure, no timeout.
- `ps-t40.txt` — forks.js worker at **100.0% CPU** at T+40s.
- `worker-sample.txt` — `sample(1)` of the spinning worker: 2487 samples,
  hot frames `ArrayPrototypeFlatMap` → `FlattenIntoArrayWithMapFn` → JIT'd
  JS (2347) — byte-for-byte the same shape as the live capture.

## Evidence 3 — wedge pinned at the scanner level

`repro-spin-probe.txt` — direct `createScanner` walk over
`const seq = /^#(\d+)$/.exec(label)?.[1];` printing every token:

```text
tok SlashToken               [12,13) "/"     <- regex `/` taken as division
tok CaretToken               [13,14) "^"
{"iter":6,"tok":80,"tokName":"PrivateIdentifier","start":14,"end":14,...}
WEDGE CONFIRMED: 5 consecutive zero-advance tokens at pos 14 (PrivateIdentifier)
```

The zero-length token is the `#` at offset 14 (line 1, col 15): `start == end
== 14` on every iteration — the exact "no line advances" point the live stack
could only narrow to "inside `scan()`".

## Evidence 4 — after the fix, same input, clean exit

`after-fix-gate-pass.log` — the same trigger file present in `src/`, gate +
regression pins run to completion: **2 files, 18 tests passed, 510ms** (was:
infinite). The trigger file was removed after the run; it is not part of the
tree.

The guard's loud-failure behavior is pinned in `i18n-scan.test.ts`: a bare
`#` wedge shape throws `bad.ts:2:11 ... PrivateIdentifier ... no progress`
instead of spinning.
