<div align="center">
  <img src="apps/web/public/logo.svg" alt="pacman app icon" width="128" height="128">
</div>

# pacman

A self-hosted, open-source **agent workspace**: a task board where you write the tasks and AI agents build them on your own machines.

English | [简体中文](./README.zh.md)

## What

You file a task on a kanban board. An agent picks it up, checks out a worktree and a branch, and streams its work back to the UI as a conversation — plan cards, diffs, tool calls, all in real time. The run pauses at review so a human decides what merges.

- **Tasks & phases** — kanban board with numbered tasks, tags, and schedules that re-run a task on a cycle.
- **Agents** — execution roles configured with a model, responsibilities, skills, MCP servers, secrets, and memory. A per-user "chief" agent dispatches work.
- **Machines** — register any host by running the daemon on it; builds execute there under supervision. Your laptop, your box, your rules.
- **Providers** — model access via API key, OAuth (GitHub Copilot, OpenAI Codex), or a custom endpoint.
- **Repos** — git repositories hosted by the server itself (push/pull with an API key) or connected from GitHub.
- **Live everything** — SSE streams for board and conversation updates, notifications, token-usage accounting per build and model.

## Why

- **Gated by design.** Every run stops for you twice — at the plan and at the diff — and the AI reviewer can block, not just comment. The only open-source, self-hostable agent workspace that does this today.
- **Honest lineage.** pacman began as a clean-room study of todos.dev's public interface (see [Origins](#origins)) and is now an independent product; its roadmap diverges from real usage, not from anyone else's spec.

## Quickstart

Requirements: Node.js 22 or 24 (LTS lines ship prebuilt `better-sqlite3` binaries; other versions may fall back to source compilation and need a build toolchain).

```sh
npx @xiechimon/pacman
```

One command: download, start, and serve on **http://127.0.0.1:8787/app**. The first boot creates the database under `~/.pacman`, runs migrations, and seeds a default team.

Use a different port with `PORT=9000 npx @xiechimon/pacman`.

### Run builds on your own machines

The UI is fully usable without a daemon; register a machine when you want agents to actually run builds on it. On each machine that executes builds:

```sh
npm i -g @xiechimon/pacman-cli
# One-time enrollment: create an API key in the web UI (/app/api-keys, plaintext shown once), then
pacman start --api-key <pacman_...> --team <teamId>
# Daily use (credentials persisted in ~/.pacman/machine.json):
pacman start        # also: stop / restart / logs -f / status
```

Both packages install a `pacman` bin: installing both globally on the same machine means whichever came last wins the name. The clean split is running the server where you browse and `pacman-cli` where agents build.

### Develop from source

Requires Node.js >= 22.19 and pnpm (e.g. via `corepack enable`).

```sh
pnpm install
pnpm start        # builds the web UI and starts the server hosting it on the same origin
```

The watch-mode dev stack, one process each: `pnpm dev:web`, `pnpm dev:server`, `pnpm dev:daemon` (`pnpm dev` runs all three together).

## Configuration

Server environment variables (all optional):

| Variable | Default | Description |
|---|---|---|
| `PACMAN_TOKEN` | unset | Bearer token guarding `/api/*`. Set to enable authentication — the web UI asks for the token on first visit; unset means auth off (default). The two SSE stream endpoints additionally accept `?token=` (EventSource cannot set headers). Always set this when binding the server to a non-localhost interface. |
| `PORT` | `8787` | HTTP listen port. |
| `HOST` | unset (all interfaces) | HTTP bind address. For split deployment (server on an always-on host, daemon on another machine pointing `PACMAN_SERVER` at it), set this to that host's LAN address and set `PACMAN_TOKEN` alongside. Explicit `0.0.0.0`/`::` with `PACMAN_TOKEN` unset logs a startup warning. |
| `PACMAN_HOME` | `~/.pacman` | Data root. Server state lives under `<PACMAN_HOME>/server/` (`server.db`, `secretbox.key`, hosted bare repos); the daemon keeps `machine.json`, `daemon.log`, and `workspaces/` at the root. **Backup = copy the whole directory** — the db alone is useless without the keyfile, since secrets are stored encrypted. |
| `PACMAN_GITHUB_OAUTH_CLIENT_ID`<br>`PACMAN_GITHUB_OAUTH_CLIENT_SECRET` | unset | Credentials of a self-registered GitHub OAuth App, enabling OAuth provider sign-in. Set both or neither — the server refuses to start on a half-configured pair. |
| `PACMAN_WEB_DIR` | `apps/web/dist` if present | Override for the SPA static-hosting root; unset with no build output = API-only mode. |
| `PACMAN_SKILLS_DIR` | `~/.agents/skills` | Skills root. Each immediate subdirectory containing a `SKILL.md` is one skill (id = its frontmatter `name`, falling back to the directory name). Scanned live on every request — skills are never stored in the database; add a skill by dropping a folder in, remove one by deleting the folder. |
| `PACMAN_ISSUE_INTAKE` | unset (off) | GitHub issue intake. `1`, `true` or `yes` turns it on; anything else leaves it off, and it is off by default. When on, every 5 minutes the server takes open issues labeled `ready-for-agent` from each GitHub project of a team that has a GitHub connection and a chief bound to an agent with a model, imports them as tasks and starts orchestration. An issue is taken only if the newest `labeled` event for that label was made by hand by a user with triage, write, maintain or admin on the repository. A label applied through a GitHub App does not count, even when the app acts with that user's authorization. This check sees GitHub Apps only: an agent session that labels with `gh` or a personal access token signed in as that user looks the same as the user labeling by hand, and its label is taken. Labels applied by anyone else, or removed again, are ignored too. Each project has at most 3 imported issue tasks outside done and closed at a time (failed ones count). Issues already labeled when you turn it on are taken too, oldest first, up to that limit (the server reads up to 300 labeled issues per project per sweep), so check what is labeled before enabling it. Tasks the intake imports list the chief's bound agent as their creator, and the intake closes only those tasks: a task imported by hand or by the webhook is never closed by it, nothing is closed for a team whose chief has no bound agent, and after the chief is bound to another agent, tasks taken before are no longer closed by it. Such a task is closed when the server saw its issue open and then saw it closed by a user with triage or above; a task whose issue the server first sees already closed (for example after a restart), an issue closed by its outside author, or a task someone reopened is left alone, and so is a task in review or one with a build that opened a pull request, and a split task whose subtasks are not all done or closed. The intake never settles those pull-request tasks: one in review will be settled by the pull-request reconcile of [#1403](https://github.com/xiechimon/pacman/issues/1403) once that ships, and one in any other phase stays where it is until a person moves it. If starting orchestration fails after an import, later sweeps try again, up to 3 tries in all (a restart forgets pending retries); after that the task stays in to-do for a person. When GitHub answers a read with a rate limit, that team's sweep stops until the next one, and the log gives the reset time. The startup log says whether intake is on. |

Daemon environment variables (alternatives to the CLI flags above): `PACMAN_SERVER` (default `http://127.0.0.1:8787`), `PACMAN_API_KEY`, `PACMAN_TEAM`, `PACMAN_WORKSPACES_DIR` (default `<PACMAN_HOME>/workspaces`).

## Development

```sh
pnpm dev:server   # API server with hot reload on http://127.0.0.1:8787 (first boot: db + migrations + seed)
pnpm dev:web      # vite dev server on http://localhost:5173, proxying /api and /git to 8787
```

The vite dev server runs with `strictPort`: a taken port fails startup instead of silently
shifting to the next free one. The shift is the dangerous case, not the clash — the proxy
target stays fixed, so a shifted UI would drive whichever stack owns the port, not yours.
Override with `PACMAN_DEV_WEB_PORT` / `PACMAN_DEV_SERVER_PORT`.

Quality gates before committing:

```sh
pnpm lint         # biome ci
pnpm typecheck    # tsc across all packages
pnpm test         # vitest
```

### Repository layout

| Path | Contents |
|---|---|
| `CONTEXT.md` | Domain model & glossary — canonical terminology (Chinese interface terms ↔ English ↔ internal names) |
| `apps/web` | Web UI (React + vite) |
| `apps/server` | Server: Hono REST + SSE + SQLite (package `@xiechimon/pacman` — directory name differs from package name) |
| `apps/daemon` | Executor daemon (package `@xiechimon/pacman-cli` — directory name differs from package name) |
| `packages/shared` | Protocol vocabulary, record shapes, brand-slot single source (`@pacman/shared`) |
| `docs/spec/` | Implementation canon, volumes 00–26 (Chinese) |
| `docs/research/` | r1–r15 site inventories and later product research (historical archive) |
| `scripts/` | Build-time tools (incl. `generate-icons.mjs`) |

## Third-party credits

- Avatar font [Lorelei](https://www.figma.com/community/file/1198749693280469639) — © Lisa Wischofsky, CC0 1.0
- Fonts Inter / JetBrains Mono — SIL Open Font License 1.1
- Icons [lucide](https://lucide.dev) — ISC License
- Emoji curation data [gitmoji](https://gitmoji.dev) — MIT License
- Execution engine [pi SDK](https://github.com/badlogic/pi-mono) — MIT License

Full obligations table: `docs/spec/素材替换计划.md` §4.

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Origins

pacman began as a clean-room study of todos.dev's public interface and protocols — an exploration of agent-workspace design. It is now an independent project with its own roadmap, and uses no code or assets from todos.dev.
