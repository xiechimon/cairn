# #2177 evidence

## Invariant test, red on main and green on the branch

- `red.log`: `node --test scripts/release-config.test.mjs` from this branch, run against the `release.yml`, package manifests and workspace files of `origin/main` at `000945c2e`. Result: 2 pass, 12 fail. The passes are the existing changeset ignore-list test and the action pin test, which main already satisfies.
- `green.log`: the same command on the branch. Result: 14 pass, 0 fail.

## Pack on real tarballs

`pnpm exec changeset pack --out-dir <tmp>` on the branch (macOS, Node 24.14.0, pnpm 12.5.1) packed `@xiechimon/cairn@0.1.1` and `@xiechimon/cairn-cli@0.2.2` (`pack.log`). It wrote `pack-publish-plan.json`, which contains two `kind: "publish"` entries; the workflow's count step reads that number.

The `package/package.json` inside each tarball contains:
- `publishConfig: {"access":"public","provenance":true}`;
- `repository.url: git+https://github.com/xiechimon/cairn.git`, with `directory` set to `apps/server` or `apps/daemon`;
- no `workspace:` or `catalog:` dependency specifiers.

## Spikes

1. **pnpm 12 and OIDC.**
   - `@changesets/cli` 3.0.3 publishes with `pnpm publish` under `packageManager: pnpm@12.5.1`, and with `pnpm publish <tarball>` when given `--from-pack-dir` (`dist/getPublishPlan.mjs`, `dist/publish.mjs`).
   - The pnpm 12.5.1 native binary contains `/-/npm/v1/oidc/token/exchange/package/`, `ACTIONS_ID_TOKEN_REQUEST_URL`, `ACTIONS_ID_TOKEN_REQUEST_TOKEN`, `pnpm/crates/publish/src/oidc/id_token.rs` and provenance generation (`provenance_gen.rs`).
   - pnpm 12 reads `PNPM_CONFIG_*` environment variables. The binary contains no `npm_config_provenance`, so the publish step sets `PNPM_CONFIG_PROVENANCE`.
2. **setup-node.** With `registry-url`, `actions/setup-node` writes an `.npmrc` that references `NODE_AUTH_TOKEN` and sets a placeholder value: run 40987078090 shows `NODE_AUTH_TOKEN: XXXXX-XXXXX-XXXXX-XXXXX`. The release jobs pass no `registry-url` and set no token variable.
3. **A real publish.** Not verifiable before merge. The first main run after merge publishes 0.1.1 and 0.2.2 through the Trusted Publishers configured on npmjs.com on 2026-10-30. Those publishers must be validated by a publish before 2026-11-01 02:06 UTC (`@xiechimon/cairn`) and 02:09 UTC (`@xiechimon/cairn-cli`).
