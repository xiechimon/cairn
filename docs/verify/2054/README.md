# Verify #2054 — restricted API keys cannot enroll or take over local machines

## Claim

`POST /api/machine/enroll` requires `machineAccess` on the API key. A key with MCP grants and `machineAccess=false` is refused with 403. A `machineAccess` key cannot claim or rotate the seeded local row by sending the server hostname as `name` (unclaimed or claimed); owner-approved `enroll/confirm` claims that identity. Remote keys still enroll under a non-hostname name.

## Commands

Red (before the product change), same suite:

```sh
pnpm --filter @xiechimon/cairn exec vitest run test/machine-enroll-authority.test.ts
```

Artifact: [red-enroll-authority.log](./red-enroll-authority.log) — 2 failed (restricted key returned 200; hostname takeover returned 200), 2 passed.

Green (this branch):

```sh
pnpm --filter @xiechimon/cairn exec vitest run test/machine-enroll-authority.test.ts test/machine-local.test.ts test/keys.test.ts test/token-auth.test.ts
```

Artifact: [green-enroll-authority.log](./green-enroll-authority.log) — 70 passed.

Gates:

```sh
pnpm lint
pnpm typecheck
pnpm spec:parse
pnpm --filter @xiechimon/cairn run db:check
```

Artifacts: [lint.log](./lint.log), [typecheck.log](./typecheck.log), [spec-parse.log](./spec-parse.log), [db-check.log](./db-check.log).

## #2000 probe under `--expect-secure`

```sh
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2000/security-probes.ts --expect-secure
```

Artifact: [probe-expect-secure.log](./probe-expect-secure.log) — subtest `read-only MCP key can obtain a machine token` is `ok` (403). Anonymous confirm, attachment escape, secret plaintext, and token-file mode remain other tickets.

## Limits

- Does not authenticate browser `enroll/confirm` (tracked by #2053).
- Live multi-host daemon enroll against a running stack was not exercised here; coverage is the in-memory Hono application and vitest.
- Existing installed keys: migration sets `machineAccess=1` only where `mcpAccess=0` and `gitAccess=0` (bootstrap pattern). MCP keys and git-step keys stay false.
