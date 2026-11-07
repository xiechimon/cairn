# Getting started

Cairn is one server you browse plus a daemon on every machine that runs builds. The server alone is enough to look around; a daemon is what lets agents work on your own machines.

## Run the server

Requirements: Node.js 22 or 24 (LTS lines ship prebuilt `better-sqlite3` binaries; other versions may fall back to source compilation and need a build toolchain).

```sh
npx @xiechimon/cairn
```

One command: download, start, and serve on **http://127.0.0.1:8787/app**. The first boot creates the database under `~/.cairn`, runs migrations, and seeds a default team. Use a different port with `PORT=9000 npx @xiechimon/cairn`.

The server listens on loopback only and always requires an access token. The first start generates one in `~/.cairn/token` (mode 0600) and prints a one-time login link such as `http://127.0.0.1:8787/app#token=<token>`; open it once and the browser remembers the token. `cairn token` prints it again later. To reach the server from another machine, set `HOST=0.0.0.0` (or the LAN address) together with `CAIRN_TOKEN=<long random string>`; without a token a non-loopback `HOST` refuses to start. `CAIRN_AUTH=off` disables auth and works only on a loopback bind.

## Run builds on your own machines

The UI is fully usable without a daemon; register a machine when you want agents to actually run builds on it. On each machine that executes builds:

```sh
npm i -g @xiechimon/cairn-cli
# One-time enrollment: create an API key in the web UI (/app/api-keys, plaintext shown once), then
cairn start --api-key <cairn_...> --team <teamId>
# Daily use (credentials persisted in ~/.cairn/machine.json):
cairn start        # also: stop / restart / logs -f / status
```

Both packages install a `cairn` bin: installing both globally on the same machine means whichever came last wins the name. The clean split is running the server where you browse and `cairn-cli` where agents build.

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

## Next steps

- Every server and daemon environment variable: [configuration.md](./configuration.md).
- Private access from your phone over Tailscale: [deploy/tailscale-mobile.md](./deploy/tailscale-mobile.md). Embedded tsnet with automatic route choice is planned.
- Engineering canon: [spec/](./spec/), starting with [spec/19-test-layering-and-blast-radius.md](./spec/19-test-layering-and-blast-radius.md).
