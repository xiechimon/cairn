# Green (implementation)

```

 RUN  v5.0.1 /workspace/integration


 Test Files  4 passed (4)
      Tests  11 passed (11)
   Start at  04:35:39
   Duration  1.00s (transform 60%, import 34%, tests 4%, worker 2%)

```

## typecheck
```
$ pnpm -r typecheck
packages/shared typecheck$ tsc --noEmit
packages/shared typecheck: Done
apps/daemon typecheck$ tsc --noEmit
apps/server typecheck$ tsc --noEmit
apps/web typecheck$ tsc --noEmit
apps/daemon typecheck: Done
apps/web typecheck: Done
apps/server typecheck: Done
integration typecheck$ tsc --noEmit
integration typecheck: Done
```
