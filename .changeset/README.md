# Changesets

Releases are automated with [changesets](https://changesets.dev). `@xiechimon/cairn` (server) and `@xiechimon/cairn-cli` (daemon) publish to npm; every other workspace package is private and listed in `config.json` under `ignore`.

Add a changeset for every pull request that changes a publishable package:

```sh
pnpm changeset
```

Pick the package and a bump type (patch / minor / major), then describe the change in English — the text lands in the package changelog as-is.

When the pull request should ship, run `pnpm release:version` in it to bump versions and write changelogs. Include those changes in the pull request for normal review and merge.

After merge to main, the `release` workflow publishes unpublished versions through npm Trusted Publishing (OIDC) with provenance and pushes the release tags, including tags created before a partial publish failure. Versions already on npm are skipped. Pending changesets on main leave a warning naming them and wait for a pull request that runs `pnpm release:version`. Unpublished package versions still publish when changesets are pending. `pnpm exec changeset status` shows what is pending.

The release workflow builds and packs the tarballs in a job without npm publishing rights, and a separate job that runs no package scripts publishes them.

If a tag push fails after a successful publish, run `pnpm exec changeset git-tag` and `git push origin --tags` from an up-to-date main to recreate the tags.

Publishing requires a Trusted Publisher on npmjs.com for each package, with provider GitHub Actions, repository `xiechimon/cairn`, workflow file `release.yml`, and environment `npm`. The `publish` job deploys to the GitHub environment `npm`, which only `main` may deploy to. Each Trusted Publisher names environment `npm`, so a run from any other ref cannot obtain a publishing token. Renaming the workflow file breaks publishing until the Trusted Publishers are updated. Publishing needs no token or repository secret.
