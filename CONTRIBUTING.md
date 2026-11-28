# Contributing to Cairn

Thanks for your interest. Cairn is built mostly by its own agents, and `main` only accepts commits whose CI checks are green, so the rules below apply to people and agents alike.

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
3. Test what you change. Prefer an end-to-end test (`apps/web/e2e`, `integration/`) over a unit test that only restates the implementation. Run the tests you touched; CI runs the full suite. A local run of more than one test file is refused unless you set `CAIRN_LOCAL_HEAVY=1`.
4. Run the local gates:

   ```sh
   pnpm lint         # biome ci
   pnpm typecheck    # tsc across all packages
   pnpm test:changed # tests related to your change
   pnpm prepush      # the pre-push gates (English-only, comments, UI drift and others)
   ```

## House rules

- **English only.** Everything committed is English: code, docs, commit messages and pull request text. The exceptions are product UI strings, agent-facing prompt strings, fixtures that match the UI, and `README.zh.md`. `scripts/english-only-gate.mjs` enforces this in `pnpm prepush` and CI.
- **No comments by default.** Write code that reads without them. A comment may only explain an external quirk (a browser, platform or third-party bug) or document a public API. A comment that promises a later fix is not accepted; fix the code now.
- **No skipped tests or loosened assertions** to get a change through.
- Third-party GitHub Actions are pinned to a full commit SHA.

## Pull requests

Pull requests are the flow for external contributors. Maintainers and agents working in this repository do not open pull requests; they land on `main` through `scripts/ops/push-queue.mjs`, as the "Ship" section of [AGENTS.md](./AGENTS.md) describes.

Describe what changed, why, and how you verified it; the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) is an optional outline. When the change finishes a ticket, put `Closes #N` on its own line, or `Part of #N` for one segment.

Commit messages follow `area(issue): summary`, for example `server(1570): skip already-pushed traces`.

Cairn is Apache-2.0 and has no CLA. Pull requests from external contributors need a DCO sign-off on each commit (`Signed-off-by: Name <email>`); add it with `git commit -s`.

A maintainer reviews every pull request, and an AI reviewer may also comment. A pull request merges once CI is green and the review approves it.

## Releases

Contributors do nothing to release: there are no changesets and no version bumps in a pull request. The shipped product is the Mac desktop app. The [`desktop-release` workflow](./.github/workflows/desktop-release.yml) publishes it from `main` by itself: it picks the newest unreleased commit with green CI whose app sources changed since the last stable release, reserves a fresh `desktop-v*` version, and verifies the build before publishing. Different candidates can build in parallel; the final update-channel write is serialized. The rules are in [docs/design/tested-sha-landing.md](./docs/design/tested-sha-landing.md#desktop-release).

## License

By contributing you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
