# Authentication review evidence

The negative control ran `pnpm exec vitest run apps/daemon/test/claude-code-login.test.ts apps/daemon/test/machine-claude-login.test.ts` against the inherited implementation with the new tests. It failed three cases: custom configuration read the default timestamp, and both API key helper and Bedrock reports were classified as expired. See `red.log`.

The corrected implementation reads the clock only for a logged-in first-party OAuth probe, and uses the active Claude configuration directory. A missing or malformed custom file yields unknown expiry without reading the default account. The focused run covers the daemon, worker and chief claims, and isolated GitHub fixtures: `focused.log` (28 tests passed). `pnpm lint`, `pnpm typecheck`, and `pnpm spec:parse` passed.

These tests use disposable credential directories and synthetic timestamps. They do not validate a real host login. The inherited PR does not implement the daily brief warning requested by the issue, so full issue acceptance remains open.
