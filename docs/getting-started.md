# Getting started

Cairn is one server you browse plus a daemon on every machine that runs builds. The server alone is enough to look around; a daemon is what lets agents work on your own machines.

## Cairn for Mac

On a Mac, the desktop app is the whole install. Download it from the [latest release](https://github.com/xiechimon/cairn/releases/latest) (`-mac-arm64.dmg` for Apple silicon, `-mac-x64.dmg` for Intel), drag it to Applications and open it. The app is not notarized yet, so macOS blocks the first launch: open System Settings, then Privacy & Security, and click **Open Anyway** next to Cairn; on macOS 14 and earlier, right-click Cairn in Applications and choose Open instead.

The app runs the server and a Runner on this Mac, approves that Runner and signs you in as the owner. The Runner includes pi: connect your ChatGPT subscription inside Cairn or add a provider API key; neither the Codex CLI nor Claude Code is required for this route. Follow [Connect a model and get your first result](../README.md#connect-a-model-and-get-your-first-result). Claude Code is optional; its subscription setup is below.

## Linux desktop from source

There is no published Linux desktop package or Linux automatic update. To build the portable x64 archive, follow [the desktop build and extraction commands](../apps/desktop/README.md#linux-x64-archive). It needs a graphical Linux session and Git. The app starts its own server and pi Runner, signs you in locally, and uses the same model-connection wizard as the Mac app. Quit stops both services. For a headless server or separate Runner, use npm below.

## Run the server

Requirements: Node.js 22.19+ on the 22 or 24 LTS line and Git (these LTS lines ship prebuilt `better-sqlite3` binaries; other versions may fall back to source compilation and need a build toolchain).

```sh
npx @xiechimon/cairn
```

One command: download, start, and serve on **http://127.0.0.1:8787/app**. The first boot creates the database under `~/.cairn`, runs migrations, and seeds a default team. Use a different port with `PORT=9000 npx @xiechimon/cairn`.

The server listens on loopback only and always requires an access token for non-browser clients. The first start generates one in `~/.cairn/token` (mode 0600). The first browser session comes from a pairing code minted with the owner token:

```sh
curl -s -X POST -H "Authorization: Bearer $(cairn token | head -1)" http://127.0.0.1:8787/api/remote/pairing
```

Open the returned code in the browser pairing page. Another device uses the same one-time code from Remote access. `cairn token` prints the owner token for this machine only. To reach the server from another machine, put Tailscale Serve or another route in front of loopback; the route does not sign the browser in. `CAIRN_AUTH=off` disables auth and works only on a loopback bind.

A browser signed in with a pairing code is a paired device, not the owner, so on macOS and Windows, and in any browser on another machine, it cannot yet add providers, secrets or API keys, manage pairing, or approve the server's own machine as a Runner ([#5201](https://github.com/xiechimon/cairn/issues/5201)). Do those with the owner token for now. For example, to approve the Runner that `cairn start --server` printed a link for, take the `enroll=` value from that link:

```sh
curl -s -X POST -H "Authorization: Bearer $(cairn token | head -1)" -H "Content-Type: application/json" \
  -d '{"enrollId":"<enroll value>"}' http://127.0.0.1:8787/api/machine/enroll/confirm
```

Cairn for Mac signs in as the owner and needs none of this. These token curls only work against a headless server — on the desktop app every owner write travels an in-memory channel the app injects into its own window's requests, so the same calls are refused there; use the app instead.

## Run builds on your own machines

The UI is fully usable without a daemon; register a machine when you want agents to actually run builds on it. On each machine that executes builds:

```sh
npm i -g @xiechimon/cairn-cli
cairn start --server http://127.0.0.1:8787
```

The first start prints a link. Open it in the browser where you use Cairn and approve the machine; the daemon then connects by itself and keeps its credentials in `~/.cairn/machine.json`. When the Runner is on another machine, use the address that reaches your server instead. Later, `cairn start` alone is enough; there are also `cairn stop`, `restart`, `logs -f` and `status`.

On a machine without a browser, create an API key in the web UI (**Settings → API keys**; the key is shown once) and enroll with `cairn start --api-key <cairn_...> --team <teamId>` instead.

Both packages install a `cairn` bin: installing both globally on the same machine means whichever came last wins the name. The clean split is running the server where you browse and `cairn-cli` where agents build.

## Public webpages and optional platform channels

Runners do not install Scrapling by themselves; first start downloads nothing for web pages. To add it, run `cairn web-tools install` on the Runner: it installs Scrapling 0.5.1 with a private Python 3.12 and uv, needs access to GitHub and the Python package index, and no account, API key, system Python or administrator password. Without it, agents read public pages with their own web tools.

The installation lives beside the Runner's state directory: `${CAIRN_HOME}-web-tools` (normally `~/.cairn-web-tools`), not inside its private credentials directory. Agents receive its commands on PATH, including pi and Claude Code. When it is installed they use `scrapling extract get "https://example.com" page.md`. The machine reports `capabilities.scrapling.version` only after the HTTP fetcher imports successfully; readiness refreshes at most every ten minutes.

No Chromium browser is downloaded by default. The official HTTP extras still include browser-related Python packages: a Linux x64 installation measured about 367 MiB for packages, 112 MiB for Python and 37 MiB for uv, excluding shared download caches. Other platforms and dependency versions vary. Browser rendering is separate: run the private `scrapling install` only when needed, after approving its additional Chromium download and, on Linux, possible privileged OS dependency installation. Neither HTTP nor browser fetching bypasses a site's login requirements or access rules.

Agent Reach is **off by default**. Older Cairn versions did not install it either, but automatically ran doctor when an existing installation was on PATH and discovered its local skill. To enable it on a CLI Runner:

```sh
cairn web-tools agent-reach --enable
cairn restart
cairn web-tools agent-reach doctor
cairn web-tools agent-reach add <channel>
```

Enabling reuses an existing installation or installs the official GitHub release, never the unrelated `agent-reach` package on PyPI. It does not run global setup, log in, import cookies, or enable all channels. Follow the requested channel's doctor/add instructions: for example, GitHub may need `gh auth login`; social platforms may need their own browser login or explicitly supplied cookies, and some services need their own API key. There is no single Cairn login that authenticates every channel. Use `cairn web-tools agent-reach --disable` and restart to turn off its doctor reporting and agent skill discovery again. Existing tools, skills, settings and credentials are never uninstalled or deleted.

For the Mac app, use its bundled Runner from Terminal, rather than installing a second CLI. With Cairn in `/Applications`, enable it with:

```sh
CAIRN_HOME="$HOME/Library/Application Support/@cairn/desktop/runner" \
ELECTRON_RUN_AS_NODE=1 /Applications/Cairn.app/Contents/MacOS/Cairn \
  /Applications/Cairn.app/Contents/Resources/runner/dist/cli.mjs web-tools agent-reach --enable
```

Quit and reopen the app. The same command prefix with `web-tools agent-reach doctor`, `web-tools agent-reach add <channel>` or `web-tools agent-reach --disable` manages that Runner. Adjust the app path if it is installed elsewhere. Agents use the private commands directly; terminal users can also prepend `${CAIRN_HOME}-web-tools/scrapling/bin` to their PATH to run Scrapling themselves.

## Use your Claude subscription on your machines

Set the subscription up once on the server; every machine you enroll then runs Claude Code tasks with it, without a `claude` login on each machine. Cairn stores the token encrypted on your own server and hands it only to your own machines for the official Claude Code to use.

1. **Install the Claude Code CLI on every machine that runs Claude Code tasks.** The daemon looks for `claude` on `PATH` (or `CAIRN_CLAUDE_BIN`) and logs `claude binary: not found` when it is missing.
2. **Enroll the machine** as in the section above. Wait until its log shows `claude binary: <path>`. If the machine's runtime list under **Settings → Runners** shows Claude Code as not installed, check that `claude` is on the daemon's `PATH`. A daemon older than the detection fix in #4795 also needs a `~/.claude/settings.json` that lists a model; without it an unpinned task never goes to that machine, so update the daemon or pin the task.
3. **Create the token.** On any computer where you are signed in to your Claude subscription, run `claude setup-token` and copy the `sk-ant-oat01-…` value it prints.
4. **Add it under Settings → Model.** Click **Add provider**, pick **Claude** (tagged Subscription), give it a name, paste the token, optionally set the expiry date, and save. The token cannot be viewed afterwards. Then press **Verify** (the server checks the token directly against the Anthropic account API): a good token shows ok, a revoked one shows an authentication failure.
5. **Choose the runtime and model.** Review the Coordinator model in the confirmation screen, or change Coordinator and task model rules under **Settings → Model**. A usable Claude Code subscription and installed runtime offer Claude Code with `claude-sonnet-5-5` for tasks; saved rules take precedence. This does not change an existing ChatGPT/pi setup automatically. The plan step and build appear in the task conversation.

Places a newcomer gets stuck: a machine that does not have `claude` on the daemon's `PATH`, whose Runner entry then shows Claude Code as not detected; and a token that is not in the `sk-ant-oat01-` format, which is rejected as an invalid credential. Merely signing in with `claude` on a Runner does not replace this per-team subscription token. For a ChatGPT subscription, use the in-app device login instead; with only ChatGPT connected on a fresh installation, Coordinator selects GPT-6.1 Sol and tasks run through pi.

## Run the server in Docker

Only the server (with the web UI) is containerized; agents run through a daemon on your own machines. The image binds `0.0.0.0` and keeps all state under `/data`:

```sh
docker build -t cairn .
docker run -d --name cairn -v cairn-data:/data -e CAIRN_TOKEN="$(openssl rand -hex 32)" -p 8787:8787 cairn
```

The image sets `CAIRN_REQUIRE_TOKEN=1`: without a non-empty `CAIRN_TOKEN` the container logs the reason and exits with code 1 instead of serving an open API on a public address. Back up by copying the whole `/data` volume (database and `secretbox.key` together). Terminate TLS in front of the container (a reverse proxy, or the platform's HTTPS domain), since the bearer token travels in a header.

## Develop from source

Requires Node.js >= 22.19 and pnpm (e.g. via `corepack enable`).

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm start        # builds the web UI and starts the server hosting it on the same origin
```

The watch-mode dev stack, one process each: `pnpm dev:web`, `pnpm dev:server`, `pnpm dev:daemon` (`pnpm dev` runs all three together).

## Keep the daemon running on Linux

Tasks run directly on the Runner host in isolated git worktrees; no container runtime or bubblewrap sandbox is required. On Linux, `cairn start` and `cairn restart` try to launch the daemon as a transient systemd user unit (`cairn-daemon-<id>.service`) and print its name. When `systemd-run --user` is unavailable, they print a warning and fall back to a plain background process, which still claims and runs tasks normally.

A transient unit or plain background process ends when you log out or reboot. To keep the daemon running across logouts and reboots, enroll the machine as in [Run builds on your own machines](#run-builds-on-your-own-machines), stop it with `cairn stop`, and create `~/.config/systemd/user/cairn-daemon.service`, using `command -v cairn` and `command -v node` for the two paths:

```ini
[Unit]
Description=Cairn daemon

[Service]
Environment=PATH=/directory/of/node:/usr/local/bin:/usr/bin:/bin
ExecStart=/path/to/cairn start --foreground
Restart=on-failure

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now cairn-daemon.service
```

## Next steps

- Every server and daemon environment variable: [configuration.md](./configuration.md).
- Private access from your phone over Tailscale: [deploy/tailscale-mobile.md](./deploy/tailscale-mobile.md). Embedded tsnet with automatic route choice is planned.
- Engineering canon: [spec/](./spec/), starting with [spec/19-test-layering-and-blast-radius.md](./spec/19-test-layering-and-blast-radius.md).
