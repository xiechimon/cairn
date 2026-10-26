# t-0059 leftover: the i18n-coverage scanner spinning (the living scene of #681)

The **orphan processes** measured by the coordinator during the 2026-10-03 cleanup are exactly the **living instance** of the infinite loop #681 describes.

## Facts

- `pid 85912` (parent) → `85919` (a vitest fork worker), ppid=1 (already orphaned), started 2026-10-03 04:27:32;
  at measurement time it had been running **9h40m at a steady ~84-91% CPU** (hogging one core).
- Command line = `vitest run apps/web/test/i18n-coverage.test.ts --reporter=dot`,
  cwd = `.../worktrees/pacman/hp-pacman-t-0059-todo-chip-scheme-mention-chip-todo/apps/web`
  — that worktree **had already been deleted** (a dangling cwd), and the thread t-0059 was long resolved.

## The hot stack caught by `sample(1)` (`sample.txt`, 4s / 1ms interval, all 3189 samples at the same spot)

```
Builtins_RunMicrotasks
Builtins_PromiseFulfillReactionJob
Builtins_AsyncFunctionAwaitResolveClosure
Builtins_InterpreterEntryTrampoline
Builtins_ArrayPrototypeFlatMap          ← apps/web/test/i18n-coverage.test.ts:293 `files.flatMap(scan)`
Builtins_FlattenIntoArrayWithMapFn
??? (in <unknown binary>)               ← post-JIT JS: i.e. the mapFn `scan()` body itself
  3189/3189 samples stop here (no progress, no IO, no allocation churn)
```

## How to read it (one conclusion, one exclusion)

- **Conclusion**: it spins **inside `scan(file)`** — `flatMap` is only the caller (its iteration length is fixed and cannot grow with the array).
- **Excluded**: not the flatMap traversal being dragged down by a growing array, and not IO / GC; it is a **pure-JS computation spin that makes no progress** — matching #681's "zero-advance" judgment.

## Reproduction context

- The trigger face is t-0059's branch content (that ticket added the **SCHEME regexes** for `todo:` / mention chips) — a `#` appears in the regex literal, exactly #681's trigger.
- **Not reproducible on main** (main's CI is green, and i18n-coverage is a light project that runs on every `pnpm test`) → the spin is triggered by a **specific regex-literal shape**, not a repo-wide normal state.
