# Contributing to Cairn

Thanks for your interest. Cairn is built mostly by its own agents, with a human gating every merge, so the rules below apply to people and agents alike.

## Before you start

- Bugs and feature ideas go in [GitHub issues](https://github.com/xiechimon/cairn/issues/new/choose). Search first; a short reproduction beats a long description.
- Security problems never go in a public issue. See [SECURITY.md](./SECURITY.md).
- For anything larger than a small fix, open an issue first so the approach can be agreed before you write code.

## Set up

Requirements: Node.js >= 22.19 (22 or 24 LTS recommended) and pnpm (`corepack enable`).

```sh
git clone https://github.com/xiechimon/cairn.git
cd cairn
pnpm install
pnpm dev          # web on :5173, server on :8787, daemon, all with hot reload
```

`pnpm dev:web`, `pnpm dev:server` and `pnpm dev:daemon` run the three processes one at a time. [CONTEXT.md](./CONTEXT.md) defines the domain terms used across the code and docs.

## Make a change

1. Branch from `main`. Name the branch `<area>/<issue>-<slug>`, for example `web/1429-spiral-avatar`.
2. Keep one concern per pull request.
3. Test what you change. Prefer an end-to-end test (`apps/web/e2e`, `integration/`) over a unit test that only restates the implementation. During development run the tests you touched; run the full suite before opening the pull request.
4. Run the local gates:

   ```sh
   pnpm lint         # biome ci
   pnpm typecheck    # tsc across all packages
   pnpm test         # vitest
   pnpm prepush      # the pre-push gates (English-only, comments, UI drift, affected e2e)
   ```

## House rules

- **English only.** Everything committed is English: code, docs, commit messages and pull request text. The exceptions are product UI strings, agent-facing prompt strings, fixtures that match the UI, and `README.zh.md`. `scripts/english-only-gate.mjs` enforces this in `pnpm prepush` and CI.
- **No comments by default.** Write code that reads without them. A comment may only explain an external quirk (a browser, platform or third-party bug) or document a public API. A comment that promises a later fix is not accepted; fix the code now.
- **No skipped tests or loosened assertions** to get a change through.
- Third-party GitHub Actions are pinned to a full commit SHA.

## Pull requests

Fill in every section of the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md). The `pr-evidence` check fails when a required section is empty:

- **What**: the change and why, with screenshots for anything visible in the app.
- **Verified**: the command you ran and its real output, before and after.
- **Upstream**: whether an existing dependency already provides the mechanism you are adding.
- **Acceptance**: the issue's acceptance items, each checked off with its evidence.

Commit messages follow `area(issue): summary`, for example `server(1570): skip already-pushed traces`.

A maintainer reviews every pull request, and an AI reviewer may also comment. A pull request merges once CI is green and the review approves it.

## Releases

Releases use [changesets](https://changesets.dev). Add a changeset with `pnpm changeset` for any pull request that changes a publishable package. When the pull request should ship, run `pnpm release:version` in it to bump package versions and write changelogs, then include those changes in the pull request for normal review and merge.

After merge to main, the `release` workflow publishes unpublished versions of `@xiechimon/cairn` and `@xiechimon/cairn-cli` to npm through npm Trusted Publishing (OIDC) with provenance and attempts to push the release tags after publishing, including after a partial publish failure. Versions already on npm are skipped. Pending changesets on main leave a warning naming them and wait for a pull request that runs `pnpm release:version`. Unpublished package versions still publish when changesets are pending.

The release workflow builds and packs the tarballs in a job without npm publishing rights, and a separate job that runs no package scripts publishes them.

Publish only through the `release` workflow: both manifests set `publishConfig.provenance`, and provenance needs the CI's OIDC identity, so a publish from a laptop fails. If a tag push fails after a successful publish, run `pnpm exec changeset git-tag` and `git push origin --tags` from an up-to-date main to recreate the tags.

Publishing requires a Trusted Publisher on npmjs.com for each package, with provider GitHub Actions, repository `xiechimon/cairn`, workflow file `release.yml`, and environment `npm`. The `publish` job deploys to the GitHub environment `npm`, which only `main` may deploy to. Each Trusted Publisher names environment `npm`, so a run from any other ref cannot obtain a publishing token. Renaming the workflow file breaks publishing until the Trusted Publishers are updated. Publishing needs no token or repository secret.

## License

By contributing you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
