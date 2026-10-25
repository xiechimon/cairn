<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="site/img/banner-dark.webp">
    <img alt="Cairn: agents stacking a cairn on a mountain path while a person waits at the gate" src="site/img/banner-light.webp" width="100%">
  </picture>

  <p><b>You write the tickets. Agents build them on your machines. You gate what merges.</b></p>

  <p>A self-hosted, open-source multi-agent workspace that also develops itself.</p>

  <p>
    <a href="https://cairn.xmon.me">Website</a> ·
    <a href="#quickstart">Quickstart</a> ·
    <a href="./README.zh.md">简体中文</a>
  </p>

  <p>
    <a href="https://github.com/xiechimon/cairn/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/xiechimon/cairn/ci.yml?branch=main&style=flat-square&label=CI"></a>
    <a href="https://www.npmjs.com/package/@xiechimon/cairn"><img alt="npm version" src="https://img.shields.io/npm/v/@xiechimon/cairn?style=flat-square&color=173a2f&label=npm"></a>
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-173a2f?style=flat-square">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-173a2f?style=flat-square">
    <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-SQLite-173a2f?style=flat-square">
  </p>
</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/img/board-en-dark.webp">
  <img alt="Cairn board: tickets move from to-do through planning, running and review to done, each one claimed by an agent" src="site/img/board-en-light.webp">
</picture>

## Highlights

<table align="center">
  <tr>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="site/img/crew-chief-dark.webp">
        <img alt="Chief agent" src="site/img/crew-chief-light.webp" width="120" height="120">
      </picture>
      <br><sub><b>Chief</b> dispatches</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="site/img/crew-coder-dark.webp">
        <img alt="Coder agent" src="site/img/crew-coder-light.webp" width="120" height="120">
      </picture>
      <br><sub><b>Coders</b> build</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="site/img/crew-reviewer-dark.webp">
        <img alt="Reviewer agent" src="site/img/crew-reviewer-light.webp" width="120" height="120">
      </picture>
      <br><sub><b>Reviewer</b> checks the diff</sub>
    </td>
    <td align="center" width="25%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="site/img/crew-you-dark.webp">
        <img alt="You" src="site/img/crew-you-light.webp" width="120" height="120">
      </picture>
      <br><sub><b>You</b> gate the merge</sub>
    </td>
  </tr>
</table>

- **Multi-agent orchestration.** Each agent has its own model, role, skills, MCP servers, secrets and memory. A chief agent only dispatches, so its context stays clean; coder and reviewer agents do the work.
- **Human gates, enforced.** Every run stops twice for you: at the plan and at the diff. The AI reviewer can block a merge, not just comment on it.
- **Bootstrap loop.** Cairn claims its own tickets, implements them, reviews them and opens the PRs: it is being used to build itself.
- **Eval and trajectory driven.** Every build records its base SHA and a harness hash, and rejections are stored as structured records. Strong-vs-weak model A/B evals then decide which prompt, skill and routing changes stay. "Training" here means improving the harness, never fine-tuning weights.
- **Your machines.** Register any host by running the daemon on it. Builds run there in their own git worktree, and the board streams plans, diffs and tool calls back live.

## Showcase

Real work that agents shipped inside Cairn, each with a recording, the pull request and numbers you can check. Cairn is still taking shape, so these slots are placeholders for now.

| | Work | What it will show |
|---|---|---|
| 1 | Bootstrap loop | An agent inside Cairn takes one of Cairn's own tickets from claim through build and review to merge. *Coming soon.* |
| 2 | An app from scratch | One sentence in, and the agent team builds a complete app on your machine. *Coming soon.* |
| 3 | Harness before and after | The same task set, scored before and after a prompt, skill and routing change. *Coming soon.* |

## Features

- **Tasks & phases** — kanban board with numbered tasks, tags, and schedules that re-run a task on a cycle.
- **Agents** — execution roles configured with a model, responsibilities, skills, MCP servers, secrets, and memory. A per-user "chief" agent dispatches work.
- **Machines** — register any host by running the daemon on it; builds execute there under supervision. Your laptop, your box, your rules.
- **Providers** — model access via API key, OAuth (GitHub Copilot, OpenAI Codex), or a custom endpoint.
- **Repos** — git repositories hosted by the server itself (push/pull with an API key) or connected from GitHub.
- **Live everything** — SSE streams for board and conversation updates, notifications, token-usage accounting per build and model.

## Quickstart

Requirements: Node.js 22 or 24 (LTS lines ship prebuilt `better-sqlite3` binaries; other versions may fall back to source compilation and need a build toolchain).

```sh
npx @xiechimon/cairn
```

One command: download, start, and serve on **http://127.0.0.1:8787/app**. The first boot creates the database under `~/.cairn`, runs migrations, and seeds a default team.

Use a different port with `PORT=9000 npx @xiechimon/cairn`.

### Run builds on your own machines

The UI is fully usable without a daemon; register a machine when you want agents to actually run builds on it. On each machine that executes builds:

```sh
npm i -g @xiechimon/cairn-cli
# One-time enrollment: create an API key in the web UI (/app/api-keys, plaintext shown once), then
cairn start --api-key <cairn_...> --team <teamId>
# Daily use (credentials persisted in ~/.cairn/machine.json):
cairn start        # also: stop / restart / logs -f / status
```

Both packages install a `cairn` bin: installing both globally on the same machine means whichever came last wins the name. The clean split is running the server where you browse and `cairn-cli` where agents build.

### Run the server in Docker

Only the server (with the web UI) is containerized; agents run through a daemon on your own machines. The image binds `0.0.0.0` and keeps all state under `/data`:

```sh
docker build -t cairn .
docker run -d --name cairn -v cairn-data:/data -e CAIRN_TOKEN="$(openssl rand -hex 32)" -p 8787:8787 cairn
```

The image sets `CAIRN_REQUIRE_TOKEN=1`: without a non-empty `CAIRN_TOKEN` the container logs the reason and exits with code 1 instead of serving an open API on a public address. Back up by copying the whole `/data` volume (database and `secretbox.key` together). Terminate TLS in front of the container (a reverse proxy, or the platform's HTTPS domain), since the bearer token travels in a header.

### Deploy on Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new)

`railway.json` makes Railway build the `Dockerfile` and health-check `/app`. The button opens Railway's new-project page; choose Deploy from GitHub repo and this repository, then:

1. Attach a volume mounted at `/data`.
2. Set `CAIRN_TOKEN` to `${{secret(64, "abcdef0123456789")}}` (Railway generates a random value once) and `RAILWAY_RUN_UID=0` (Railway volumes are root-owned; the image otherwise runs as the `node` user).
3. Generate a public domain. `PORT` is supplied by Railway.

Point a daemon at the public server. Create an API key in the web UI (`/app/api-keys`), then on the machine that runs builds:

```sh
cairn start --server https://<your-app>.up.railway.app --api-key <cairn_...> --team <teamId>
```

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
| `CAIRN_TOKEN` | unset | Bearer token guarding `/api/*`. Set to enable authentication — the web UI asks for the token on first visit; unset means auth off (default). The two SSE stream endpoints additionally accept `?token=` (EventSource cannot set headers). Always set this when binding the server to a non-localhost interface. |
| `CAIRN_REQUIRE_TOKEN` | unset (the Docker image sets `1`) | `1`, `true` or `yes`: refuse to start (log the reason, exit 1) when `CAIRN_TOKEN` is unset or empty. |
| `PORT` | `8787` | HTTP listen port. |
| `HOST` | unset (all interfaces) | HTTP bind address. For split deployment (server on an always-on host, daemon on another machine pointing `CAIRN_SERVER` at it), set this to that host's LAN address and set `CAIRN_TOKEN` alongside. Explicit `0.0.0.0`/`::` with `CAIRN_TOKEN` unset logs a startup warning. |
| `CAIRN_HOME` | `~/.cairn` | Data root. Server state lives under `<CAIRN_HOME>/server/` (`server.db`, `secretbox.key`, hosted bare repos); the daemon keeps `machine.json`, `daemon.log`, and `workspaces/` at the root. **Backup = copy the whole directory** — the db alone is useless without the keyfile, since secrets are stored encrypted. |
| `CAIRN_GITHUB_OAUTH_CLIENT_ID`<br>`CAIRN_GITHUB_OAUTH_CLIENT_SECRET` | unset | Credentials of a self-registered GitHub OAuth App, enabling OAuth provider sign-in. Set both or neither — the server refuses to start on a half-configured pair. |
| `CAIRN_WEB_DIR` | `apps/web/dist` if present | Override for the SPA static-hosting root; unset with no build output = API-only mode. |
| `CAIRN_SKILLS_DIR` | `~/.agents/skills` | Skills root. Each immediate subdirectory containing a `SKILL.md` is one skill (id = its frontmatter `name`, falling back to the directory name). Scanned live on every request — skills are never stored in the database; add a skill by dropping a folder in, remove one by deleting the folder. |
| `CAIRN_ISSUE_INTAKE` | unset (off) | GitHub issue intake. `1`, `true` or `yes` turns it on; anything else leaves it off, and it is off by default. When on, every 5 minutes the server takes open issues labeled `ready-for-agent` from each GitHub project of a team that has a GitHub connection and a chief bound to an agent with a model, imports them as tasks and starts orchestration. An issue is taken only if the newest `labeled` event for that label was made by a user with triage, write, maintain or admin on the repository, and not through a GitHub App. A label applied through a GitHub App does not count, even when the app acts with that user's authorization. This check recognizes GitHub Apps only: a label applied with an OAuth App token or a personal access token looks the same as the user labeling by hand, and is taken. OAuth App tokens include the one `gh auth login` obtains and the team's GitHub connection token. cairn passes the connection token to the steps' git commands (git's own hooks run with it) and to the repository's `.agents/setup` and `.agents/resume` hooks, so agent code that can change those hooks can read it; cairn's agent steps can also run the machine's logged-in `gh` directly. Either way an agent can label issues as that account and feed the intake. Labels applied by anyone else, or removed again, are ignored too. Each project has at most 3 imported issue tasks outside done and closed at a time (failed ones count). Issues already labeled when you turn it on are taken too, oldest first, up to that limit (the server reads up to 300 labeled issues per project per sweep), so check what is labeled before enabling it. Tasks the intake imports list the chief's bound agent as their creator, and the intake closes only those tasks: a task imported by hand or by the webhook is never closed by it, nothing is closed for a team whose chief has no bound agent, and after the chief is bound to another agent, tasks taken before are no longer closed by it. Such a task is closed when the server saw its issue open and then saw it closed by a user with triage or above; a task whose issue the server first sees already closed (for example after a restart), an issue closed by its outside author, or a task someone reopened is left alone, and so is a task in review or one with a build that opened a pull request, and a split task whose subtasks are not all done or closed. The intake never closes those review and pull-request tasks. For a task in review whose build opened a pull request, the pull-request reconcile can finish it as done after a merge into the default branch, or as failed after the pull request is closed without merge (it checks more than that and may only leave a hint); a building task keeps going through the CI loop; a task in review without a pull request, or a failed one, stays where it is until a person moves it. If starting orchestration fails after an import, later sweeps try again, up to 3 tries in all (a restart forgets pending retries); after that the task stays in to-do for a person. When GitHub answers one of the intake's own reads (issue list, issue events, collaborator permission, issue state) with a rate limit, that team's sweep stops until the next one, and the log gives the reset time when GitHub sends one; a rate limit on the reads of an import fails just that import, and the sweep goes on to the next issue. The startup log says whether intake is on. The `cairn` label webhook (`POST /api/webhook/github/<token>`, active whether or not intake is on) applies the same permission check and the same limit: it imports an issue only when the user who applied the label (the event's `sender`) has triage, write, maintain or admin on the repository and the project is below the limit of 3, so an issue an outside author opens from a template that carries the label is not imported. When the sender is not a GitHub login name, that user's permission cannot be read (the read fails, or GitHub answers it with a rate limit), the team has no usable GitHub token, the project is at the limit, the project's stored repository name is not `owner/repo`, or GitHub does not find the issue, nothing is imported, the reason is logged, and the delivery is answered 202. When the refusal is about the sender's permission (below triage, unreadable, rate limited), the answer only says the sender was not confirmed, not which case or what permission; the log has the details. That keeps the verdict out of the answer text only: whether the import then goes ahead still shows whether a sender qualified, so a leaked webhook URL is still handled by revoking its token. |
| `CAIRN_TRAJ_OUTCOME_BACKFILL` | unset (off) | Trajectory outcome backfill. `1`, `true` or `yes` turns it on; anything else leaves it off. When on, the server sweeps once at start and then every 24 hours: for each build whose pull request was merged at least 7 days ago, it reads the project's local repository and records `revertedWithin7d` (a revert commit naming the pull request or merge commit landed on the default branch within the window) and `fixedByLaterPr` (a later pull request removed lines the build added), once per build. `pnpm traj:backfill` runs one sweep by hand. Exported trajectory packs use the recorded values in place of the open-window `null`. |

Daemon environment variables (alternatives to the CLI flags above): `CAIRN_SERVER` (default `http://127.0.0.1:8787`), `CAIRN_API_KEY`, `CAIRN_TEAM`, `CAIRN_WORKSPACES_DIR` (default `<CAIRN_HOME>/workspaces`).

## Development

```sh
pnpm dev:server   # API server with hot reload on http://127.0.0.1:8787 (first boot: db + migrations + seed)
pnpm dev:web      # vite dev server on http://localhost:5173, proxying /api and /git to 8787
```

The vite dev server runs with `strictPort`: a taken port fails startup instead of silently
shifting to the next free one. The shift is the dangerous case, not the clash — the proxy
target stays fixed, so a shifted UI would drive whichever stack owns the port, not yours.
Override with `CAIRN_DEV_WEB_PORT` / `CAIRN_DEV_SERVER_PORT`.

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
| `apps/web` | Web UI, React + vite (`@cairn/web`) |
| `apps/server` | Server: Hono REST + SSE + SQLite (package `@xiechimon/cairn` — directory name differs from package name) |
| `apps/daemon` | Executor daemon (package `@xiechimon/cairn-cli` — directory name differs from package name) |
| `packages/shared` | Protocol vocabulary, record shapes, brand-slot single source (`@cairn/shared`) |
| `docs/spec/` | Implementation canon, volumes 00–26 (Chinese) |
| `docs/research/` | r1–r15 site inventories and later product research (historical archive) |
| `scripts/` | Build-time tools (incl. `generate-icons.mjs`) |

## Third-party credits

- Avatar font [Lorelei](https://www.figma.com/community/file/1198749693280469639) — © Lisa Wischofsky, CC0 1.0
- Fonts Inter / JetBrains Mono — SIL Open Font License 1.1
- Icons [lucide](https://lucide.dev) — ISC License
- Emoji curation data [gitmoji](https://gitmoji.dev) — MIT License
- Execution engine [pi SDK](https://github.com/badlogic/pi-mono) — MIT License

## License

Apache-2.0 — see [LICENSE](./LICENSE).
