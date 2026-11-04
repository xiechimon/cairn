# Authentication review evidence

The negative control ran `pnpm exec vitest run apps/daemon/test/claude-code-login.test.ts apps/daemon/test/machine-claude-login.test.ts` against the inherited implementation with the new tests. It failed three cases: custom configuration read the default timestamp, and both API key helper and Bedrock reports were classified as expired. See `red.log`.

The corrected implementation reads the clock only for a logged-in first-party `claude.ai` probe, and uses the active Claude configuration directory. A refreshable token uses the later known access or refresh expiry, while an unknown refresh expiry stays nonblocking. The `oauth_token` method does not use the local file. A missing or malformed custom file yields unknown expiry without reading the default account. Relative configuration paths also yield unknown expiry because the daemon and task worktrees have different working directories. The focused run covers the daemon, worker and chief claims, and isolated GitHub fixtures: `focused-final.log`. `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` passed.

These tests use disposable credential directories and synthetic timestamps. They do not validate a real host login. The inherited PR does not implement the daily brief warning requested by the issue, so full issue acceptance remains open.

Independent review ran Claude Code 2.1.289 with a disposable configuration and synthetic credentials: an expired access clock and future refresh clock produced `loggedIn: true`, `authMethod: claude.ai`, and `apiProvider: firstParty`. The new CLI-contract and refresh-clock tests failed against the preceding implementation; see `cli-contract-red.log` and `refresh-red.log`.

Online login transitions now publish the existing machine presence event so an open page refetches; unchanged heartbeats do not publish. The negative control is `presence-red.log`.

A valid access token remains usable after refresh expiry; `access-red.log` records the negative control.
