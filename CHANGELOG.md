# Changelog

All notable changes to Cairn are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Cairn is pre-1.0, so a minor version may contain breaking changes.

Releases are tagged on the repository as `vX.Y.Z` and published to npm as two packages: [`@xiechimon/cairn`](https://www.npmjs.com/package/@xiechimon/cairn) (server and web UI) and [`@xiechimon/cairn-cli`](https://www.npmjs.com/package/@xiechimon/cairn-cli) (the daemon that runs builds on your machines).

## [Unreleased]

## [0.1.0] - 2026-10-25

First public release under the Cairn name. Published from commit `83df6cf5` as `@xiechimon/cairn@0.1.0` and `@xiechimon/cairn-cli@0.2.0`; the CLI version continues the numbering of the earlier `@xiechimon/pacman-cli` package.

### Added

- Kanban board with numbered tasks, tags, phases and schedules that re-run a task on a cycle.
- Agents configured with a model, responsibilities, skills, MCP servers, secrets and memory, and a per-user chief agent that only dispatches work.
- Two human gates on every run, at the plan and at the diff, plus an AI reviewer whose blocking verdict stops a merge.
- Machines: run `cairn start` on any host to register it; builds run there in their own git worktree and stream plans, diffs and tool calls back live.
- Three execution surfaces on the daemon: pi, Claude Code and Gemini CLI.
- Model providers by API key, OAuth (GitHub Copilot, OpenAI Codex) or a custom endpoint.
- Repositories hosted by the server itself or connected from GitHub, with GitHub issue intake and a label webhook that check the labeler's repository permission.
- Build trajectories: each build records its base SHA and a harness hash, and session transcripts can be uploaded for evaluation.
- Optional bearer-token auth (`CAIRN_TOKEN`) for the API and the SSE streams.

### Changed

- The product, packages, environment variables and data directory are renamed from pacman to Cairn: `@xiechimon/pacman` becomes `@xiechimon/cairn`, `@xiechimon/pacman-cli` becomes `@xiechimon/cairn-cli`, `PACMAN_*` variables become `CAIRN_*`, and `~/.pacman` becomes `~/.cairn`.

[Unreleased]: https://github.com/xiechimon/cairn/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xiechimon/cairn/releases/tag/v0.1.0
