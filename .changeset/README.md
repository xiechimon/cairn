# Changesets

Releases are automated with [changesets](https://changesets.dev). `@xiechimon/cairn` (server) and `@xiechimon/cairn-cli` (daemon) publish to npm; every other workspace package is private and listed in `config.json` under `ignore`.

Add a changeset for every pull request that changes a publishable package:

```sh
pnpm changeset
```

Pick the package and a bump type (patch / minor / major), then describe the change in English — the text lands in the package changelog as-is.

On merge to main, the `release` workflow opens or updates a `Version Packages` pull request with the version bumps and changelog entries. Merging that pull request publishes the packages to npm and tags the release. `pnpm exec changeset status` shows what is pending.
