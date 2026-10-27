# #1998 — automated npm releases on merge to main, English startup log

Issue: releases are manual, and the startup log prints a Chinese registration
hint.

## What changed

- `package.json` / `pnpm-lock.yaml`: add `@changesets/cli` and the
  `changeset`, `release:version`, `release:publish` scripts.
- `.changeset/config.json`: changesets config that ignores the private
  workspace packages (`@cairn/integration`, `@cairn/shared`, `@cairn/site`,
  `@cairn/web`) and keeps `@xiechimon/cairn` (server) and
  `@xiechimon/cairn-cli` (daemon) publishable.
- `.github/workflows/release.yml`: on every push to main, the changesets
  action opens or updates the `Version Packages` pull request when changesets
  are pending; when that pull request merges, it runs `changeset publish`,
  which publishes both packages to npm and tags each release. Publishing runs
  under the owner's npm token, which must exist as the `NPM_TOKEN` repository
  secret; a guard step fails with a named error when it is missing. A
  paths-filtered pull-request trigger runs the config invariant test on the
  release surface before merge.
- `apps/server/src/startup-log.ts`: the online startup line moved to its own
  module with an English machine registration hint.
- `apps/server/src/config.ts`: translate the token, bind and oauth startup
  messages to English.
- `CHANGELOG.md`, `CONTRIBUTING.md`: document the changesets release flow.

## Evidence

- `red.log` — the new tests against unmodified main: `release-config.test.mjs`
  fails because `.changeset/config.json` does not exist yet, and
  `startup-log.test.ts` fails because `src/startup-log.js` does not exist yet.
- `green.log` — after the change: `node --test scripts/release-config.test.mjs`
  passes (the ignore list matches the private workspace packages exactly), and
  `pnpm exec vitest run apps/server/test/startup-log.test.ts` passes (the
  online line names the api-keys route and daemon start command; every startup
  line is English-only; a half-configured oauth client fails in English).
- `container-green.log` — `pnpm exec vitest run
  apps/server/test/container-mode.test.ts`: 7/7 pass, including the new
  assertion that the booted server log contains no CJK characters.
- `changeset-status.log` — `pnpm exec changeset status` resolves the pending
  changeset to a patch bump of `@xiechimon/cairn` only.
