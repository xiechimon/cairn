# Security review evidence

Review baseline: `717010c2c9681bc147f5ebec412026c2cc9af39c`, 2026-10-27, `lane/2000`.

## Test first

`security-probes.ts` was written and run before the review report and isolation guide. All credentials and file content are synthetic. Hono requests run in memory; no server listens on a port. File probes write only into temporary directories they create and remove.

Run the desired security assertions:

```sh
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2000/security-probes.ts --expect-secure
```

[The captured red run](security-red.log) has five failing assertions and one passing control. The failures establish anonymous confirmation, restricted-key enrollment, forged upload path escape, plaintext secret disclosure, and permissive token-file modes. The restricted-key observation additionally checks the returned identity is local after seeding the local machine.

Run the observations used by the report:

```sh
pnpm --filter @xiechimon/cairn exec tsx ../../docs/verify/2000/security-probes.ts
```

[The captured observation run](security-observed.log) passes all six probes. This mode asserts the reported vulnerable behavior and the MCP rejection control. It is an audit reproducer outside the normal test suite, not a regression that declares the vulnerabilities acceptable. The secure-mode assertions remain red because #2000 files findings rather than silently changing protected behavior. Future repair tickets must add their own failing regressions to the affected suites before implementation and use the secure expectations for acceptance.

## Existing security suites

The command below passed 9 test files and 209 tests. See [the suite output](security-suites.log).

```sh
flock /tmp/cairn-heavy.lock pnpm exec vitest run apps/server/test/secret-box.test.ts apps/server/test/token-auth.test.ts apps/server/test/mcp-face.test.ts apps/server/test/mcp-servers.test.ts apps/server/test/machine-wire.test.ts apps/server/test/oauth.test.ts apps/server/test/attachments.test.ts apps/daemon/test/secret-channel.test.ts apps/daemon/test/command-gate.test.ts
```

These passing tests coexist with the reported findings. Existing coverage does not prove the stronger security claims checked by the new probes.

## Required checks

- `node scripts/english-only-gate.mjs`: 0 lines. The two new documents and `COMMIT_MSG.txt` also passed explicit `--text` checks because the sandbox forbids staging untracked files.
- `node scripts/single-use-helper-gate.mjs`: 0 single-use helpers.
- `node scripts/comment-discipline-gate.mjs`: 0 new comment lines. The new probe source contains no code comments.
- `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs`: exit 0, no changed test files selected. The standalone probes and targeted suites above provide actual runtime coverage.
- `pnpm lint`: passed. Repository Biome configuration excludes `docs/verify`; the probe was separately checked with Biome's formatter through a script-path stdin filename and matched byte for byte.
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: see [the typecheck log](typecheck.log).
- `pnpm spec:parse`: see [the parse log](spec-parse.log).

No E2E suite, dev server, Vite preview, external OAuth service, real credential, or container was started. All commands finished before handoff. No push, staging, or commit was performed; `COMMIT_MSG.txt` contains the requested complete commit message.

## Finding registration and follow-up

The created issues were read back after filing: [#2053](https://github.com/xiechimon/cairn/issues/2053), [#2054](https://github.com/xiechimon/cairn/issues/2054), [#2055](https://github.com/xiechimon/cairn/issues/2055), [#2056](https://github.com/xiechimon/cairn/issues/2056), and [#2057](https://github.com/xiechimon/cairn/issues/2057). Secret disclosure stays under [#1775](https://github.com/xiechimon/cairn/issues/1775). Its [explicit checkpoint schedule](https://github.com/xiechimon/cairn/issues/1775#issuecomment-6457906755) was posted and read back.

Before edits, both requested PR inventory commands completed. No open PR changes these new paths, and no existing lines are removed. #2029 covers the related secret-gateway research. The worktree's initial unrelated lockfile diff was never edited by this task.

The [review report](../../security/2000-prelaunch-review.md) records the reviewed sources, severity, prerequisites, limitations, and unresolved decisions. The [operator guide](../../security/agent-isolation.md) covers capabilities, separate users, containers, credential handling, and network policy. Owner decisions on safe defaults, enrollment authority, and #1775 remain open; this evidence is not release approval.
