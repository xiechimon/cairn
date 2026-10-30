# Changesets

Releases are automated with [changesets](https://changesets.dev). `@xiechimon/cairn` (server) and `@xiechimon/cairn-cli` (daemon) publish to npm; every other workspace package is private and listed in `config.json` under `ignore`.

Add a changeset for every pull request that changes a publishable package:

```sh
pnpm changeset
```

Pick the package and a bump type (patch / minor / major), then describe the change in English — the text lands in the package changelog as-is.

When the pull request should ship, run `pnpm release:version` in it to bump versions and write changelogs. Include those changes in the pull request for normal review and merge.

After merge to main, the `release` workflow publishes new versions through npm Trusted Publishing (OIDC) and pushes the release tags, without a token or repository secret. Versions already on npm are skipped. Pending changesets on main publish nothing and leave a warning naming them. `pnpm exec changeset status` shows what is pending.
