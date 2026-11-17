# Getting started

Cairn is one server you browse plus a daemon on every machine that runs builds. The server alone is enough to look around; a daemon is what lets agents work on your own machines.

## Cairn for Mac

On a Mac, the desktop app is the whole install. Download it from the [latest release](https://github.com/xiechimon/cairn/releases/latest) (`-arm64.dmg` for Apple silicon, `-x64.dmg` for Intel), drag it to Applications and open it. The app is not notarized yet, so macOS blocks the first launch: open System Settings, then Privacy & Security, and click **Open Anyway** next to Cairn; on macOS 14 and earlier, right-click Cairn in Applications and choose Open instead.

The app runs the server and a Runner on this Mac, approves that Runner and signs you in as the owner. Tasks run with Claude Code: install it and run `claude` once in Terminal to sign in. The app finds `claude` on your `PATH` or in its usual install folders. The rest of this page is for Linux, Windows and extra Runners.

## Run the server

Requirements: Node.js 22 or 24 (LTS lines ship prebuilt `better-sqlite3` binaries; other versions may fall back to source compilation and need a build toolchain).

```sh
npx @xiechimon/cairn
```

One command: download, start, and serve on **http://127.0.0.1:8787/app**. The first boot creates the database under `~/.cairn`, runs migrations, and seeds a default team. Use a different port with `PORT=9000 npx @xiechimon/cairn`.

The server listens on loopback only and always requires an access token for non-browser clients. The first start generates one in `~/.cairn/token` (mode 0600). A browser on a Linux server machine exchanges a loopback bootstrap for an HttpOnly session and does not paste the token. macOS, Windows, and `CAIRN_REQUIRE_TOKEN=1` have no loopback peer proof, so the first browser session is a pairing code minted with the owner token:

```sh
curl -s -X POST -H "Authorization: Bearer $(cairn token | head -1)" http://127.0.0.1:8787/api/remote/pairing
```

Open the returned code in the browser pairing page. Another device uses the same one-time code from Remote access. `cairn token` prints the owner token for this machine only. To reach the server from another machine, put Tailscale Serve or another route in front of loopback; the route does not sign the browser in. `CAIRN_AUTH=off` disables auth and works only on a loopback bind.

A browser signed in with a pairing code is a paired device, not the owner, so on macOS and Windows, and in any browser on another machine, it cannot yet add providers, secrets or API keys, manage pairing, or approve the server's own machine as a Runner ([#5201](https://github.com/xiechimon/cairn/issues/5201)). Do those with the owner token for now. For example, to approve the Runner that `cairn start --server` printed a link for, take the `enroll=` value from that link:

```sh
curl -s -X POST -H "Authorization: Bearer $(cairn token | head -1)" -H "Content-Type: application/json" \
  -d '{"enrollId":"<enroll value>"}' http://127.0.0.1:8787/api/machine/enroll/confirm
```

Cairn for Mac signs in as the owner and needs none of this.

## Run builds on your own machines

The UI is fully usable without a daemon; register a machine when you want agents to actually run builds on it. On each machine that executes builds:

```sh
npm i -g @xiechimon/cairn-cli
cairn start --server http://127.0.0.1:8787
```

The first start prints a link. Open it in the browser where you use Cairn and approve the machine; the daemon then connects by itself and keeps its credentials in `~/.cairn/machine.json`. When the Runner is on another machine, use the address that reaches your server instead. Later, `cairn start` alone is enough; there are also `cairn stop`, `restart`, `logs -f` and `status`.

On a machine without a browser, create an API key in the web UI (API keys in Settings; the key is shown once) and enroll with `cairn start --api-key <cairn_...> --team <teamId>` instead.

Both packages install a `cairn` bin: installing both globally on the same machine means whichever came last wins the name. The clean split is running the server where you browse and `cairn-cli` where agents build.

## Public webpages and optional platform channels

The Mac app's Runner and the Linux CLI Runner install Scrapling 0.5.1 on first start, with a private Python 3.12 and uv when needed. No account, API key, system Python or administrator password is needed for public HTTP pages. First start needs access to GitHub and the Python package index. A failed download is logged and does not stop enrollment; retry with `cairn web-tools install` or restart the Runner.

The installation lives beside the Runner's state directory: `${CAIRN_HOME}-web-tools` (normally `~/.cairn-web-tools`), not inside its private credentials directory. Agents receive its commands on PATH, including pi and Claude Code. They use `scrapling extract get "https://example.com" page.md` by default. The machine reports `capabilities.scrapling.version` only after the HTTP fetcher imports successfully; readiness refreshes at most every ten minutes.

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

Set the subscription up once on the server; every machine you enroll then runs Claude Code tasks with it, without a `claude` login on each machine. Cairn stores the token encrypted on your own server and hands it only to your own machines (and their orbs) for the official Claude Code to use.

1. **Install the Claude Code CLI on every machine that runs tasks, and on the server host.** The daemon looks for `claude` on `PATH` (or `CAIRN_CLAUDE_BIN`) and logs `claude binary: not found` when it is missing. The server host needs it too: the Verify button runs `claude -p` there, and reports "unavailable" without it (`CLAUDE_BIN` overrides the path).
2. **Enroll the machine** as in the section above. Wait until its log shows `claude binary: <path>`. If the machine's runtime list shows Claude Code as not installed, check that `claude` is on the daemon's `PATH`. A daemon older than the detection fix in #4795 also needs a `~/.claude/settings.json` that lists a model; without it an unpinned task never goes to that machine, so update the daemon or pin the task.
3. **Create the token.** On any computer where you are signed in to your Claude subscription, run `claude setup-token` and copy the `sk-ant-oat01-…` value it prints.
4. **Paste it in the Model services page.** Add a connection, pick Claude (tagged Subscription), give it a name, paste the token, optionally set the expiry date, and save. The token cannot be viewed afterwards. Then press Verify: a good token shows ok, a revoked one shows an authentication failure.
5. **Start a task.** The default route sends a task to Claude Code (`claude-sonnet-5-5`). The plan step and the build run on a machine from step 2 and appear in the task conversation.

Places a newcomer gets stuck: the server host missing `claude` in step 1; a machine that does not have `claude` on the daemon's `PATH`, whose Runner page then shows Claude Code as not detected; and a token that is not in the `sk-ant-oat01-` format, which is rejected as an invalid credential.

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
pnpm install
pnpm start        # builds the web UI and starts the server hosting it on the same origin
```

The watch-mode dev stack, one process each: `pnpm dev:web`, `pnpm dev:server`, `pnpm dev:daemon` (`pnpm dev` runs all three together).

## Keep the daemon running on Linux

On Linux, tasks run in a sandbox that needs the daemon to be its own systemd user unit. `cairn start` and `cairn restart` run it as a transient user unit, `cairn-daemon-<id>.service`, and print its name. When `systemd-run --user` fails they print a warning and start a plain background process instead; that daemon shows Online but cannot start the sandbox.

The sandbox also needs bubblewrap 0.11 or newer, which can overlay your home directory, and permission to create user namespaces. Ubuntu 25.04 and later, Debian 13 and Arch meet both after `sudo apt install bubblewrap` or `sudo pacman -S bubblewrap`. Ubuntu 24.04 ships bubblewrap 0.9 and Debian 12 ships 0.8; see [Sandbox on Ubuntu 24.04 and Debian 12](#sandbox-on-ubuntu-2404-and-debian-12). The Runner page shows why its sandbox is not ready.

A transient unit ends when you log out or reboot. To keep the daemon running, enroll the machine as in [Run builds on your own machines](#run-builds-on-your-own-machines), stop it with `cairn stop` and create `~/.config/systemd/user/cairn-daemon.service`, using `command -v cairn` and `command -v node` for the two paths:

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

## Sandbox on Ubuntu 24.04 and Debian 12

Their bubblewrap is older than 0.11, so the Runner page says `bwrap` is too old. Build 0.11.1 from source. It installs to `/usr/local/bin/bwrap` and leaves the packaged `/usr/bin/bwrap` alone:

```sh
sudo apt install build-essential meson ninja-build pkg-config libcap-dev curl xz-utils
curl -LO https://github.com/containers/bubblewrap/releases/download/v0.11.1/bubblewrap-0.11.1.tar.xz
tar xf bubblewrap-0.11.1.tar.xz
cd bubblewrap-0.11.1
meson setup _build
ninja -C _build
sudo meson install -C _build
command -v bwrap
```

The last command must print `/usr/local/bin/bwrap`. The Runner uses the `bwrap` found on the `PATH` it was started with, so if you started it from a shell where `command -v bwrap` did not print `/usr/local/bin/bwrap`, run `cairn restart` from a shell where it does.

On Ubuntu, AppArmor then stops the new `bwrap` from creating user namespaces, and the Runner page says the system does not let `bwrap` create them. Allow it with a profile for that one program:

```sh
sudo tee /etc/apparmor.d/bwrap-local > /dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap-local /usr/local/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap-local>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap-local
```

Debian 12 allows user namespaces unless `sysctl kernel.unprivileged_userns_clone` prints 0; in that case run `echo kernel.unprivileged_userns_clone=1 | sudo tee /etc/sysctl.d/90-userns.conf` and then `sudo sysctl --system`.

The Runner checks its sandbox again every minute and starts taking tasks once the check passes, without a restart.

## Next steps

- Every server and daemon environment variable: [configuration.md](./configuration.md).
- Private access from your phone over Tailscale: [deploy/tailscale-mobile.md](./deploy/tailscale-mobile.md). Embedded tsnet with automatic route choice is planned.
- Engineering canon: [spec/](./spec/), starting with [spec/19-test-layering-and-blast-radius.md](./spec/19-test-layering-and-blast-radius.md).
