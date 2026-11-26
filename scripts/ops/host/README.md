# Host control scripts

**Historical host, nothing to install (2026-11-26).** These are copies of the scripts that drove the lanes on the omarchy host. That deployment was torn down on 2026-11-18 (`docs/ops/control-plane-omarchy.md`). This page's git history holds its description of the units, timers, deploys, drift checks, command lists and temp guard. For the identity agents use today, see `docs/ops/agent-bot-identity.md`.

What still holds in this repository:

- The `ci` workflow runs host fixtures in its `Host control script fixtures` and `Test temp guard fixtures` steps. `node --test scripts/ops/host/*.test.mjs` runs every test file in this directory.
- What the `as-bot.sh` wrapper allows is defined by `tools/app-token/as-bot-policy.mjs` and checked by `as-bot.test.mjs`.
- The daemon step environment (`apps/daemon/src/step-env.ts`) and `scripts/test-temp-run.mjs` use `createTempEnvironment` from `@cairn/shared/temp-environment`, which makes a private `ct-*` directory under `~/.cache/lane-tmp`, or under `CAIRN_TEST_TEMP_ROOT` when it is set. The temp guard in this directory was the sweep for what a killed run leaves there. It ran on that host, and the repository has no other sweep of `~/.cache/lane-tmp`.
