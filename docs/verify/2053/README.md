# #2053 machine enrollment confirmation owner auth

Branch tip evidence for requiring the server owner bearer or an allowlisted
loopback Tailscale identity on `POST /api/machine/enroll/confirm` when
authentication is enabled.

## Acceptance commands

```sh
pnpm exec vitest run apps/server/test/enroll-confirm-auth.test.ts apps/server/test/enroll-browser.test.ts apps/server/test/token-auth.test.ts
pnpm lint
pnpm typecheck
pnpm spec:parse
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2000/security-probes.ts --expect-secure
```

## Results

- [vitest-enroll-confirm-auth.log](vitest-enroll-confirm-auth.log): 6 #2053 cases plus the prior browser enroll flow and token-auth suite pass.
- [lint.log](lint.log), [typecheck.log](typecheck.log), [spec-parse.log](spec-parse.log): pass.
- [comment-discipline.log](comment-discipline.log), [english-only.log](english-only.log): 0 hits.
- [security-probe-expect-secure.log](security-probe-expect-secure.log): probe 1
  (`anonymous enrollment confirmation with server authentication enabled`)
  passes under `--expect-secure`. Remaining red probes belong to #2054, #2055,
  #1775, and #2056.

## Failure modes covered

1. Auth on + anonymous confirm → 401; start/poll remain reachable.
2. Wrong bearer and API-key bearer → 401; enrollment stays pending.
3. Owner bearer confirm → 200; anonymous poll returns authorized; re-confirm → 409.
4. Enrollment bound to a foreign `teamId` → 403 before machine creation.
5. Auth off → confirm without bearer still works for local/dev.
6. Allowlisted loopback `Tailscale-User-Login` confirms without a stored bearer;
   non-loopback and unknown login still 401.
