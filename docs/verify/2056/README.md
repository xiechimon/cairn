# #2056 daemon state / machine token modes

## Commands

Red (tests present, main `state.ts` / `journal.ts`):

```sh
pnpm exec vitest run apps/daemon/test/config-state.test.ts apps/daemon/test/journal.test.ts
```

See [vitest-red.log](vitest-red.log): 8 failed permission/symlink cases.

Green (this branch):

```sh
pnpm exec vitest run apps/daemon/test/config-state.test.ts apps/daemon/test/journal.test.ts
```

See [vitest-green.log](vitest-green.log): 30 passed.

#2000 secure probe (mode assertion only; other findings remain other tickets):

```sh
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2000/security-probes.ts --expect-secure
```

See [security-probe-expect-secure.log](security-probe-expect-secure.log):
`ok 6 - machine bearer token file inherits a world-readable umask` under
`--expect-secure` (expects 0700/0600).
