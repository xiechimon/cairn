# Cairn desktop (macOS)

An Electron shell for macOS. The main process starts the bundled Cairn server on Electron's own Node with `utilityProcess.fork`, bound to `127.0.0.1` on a free port with `CAIRN_HOME` under the app's `userData` directory, waits until it answers, and opens its web UI in a window. The server writes its owner token to `CAIRN_HOME/token`; the main process reads it and adds `Authorization: Bearer <token>` only to requests whose initiator is the app's own origin, so the window signs in as the owner on macOS, where the server's loopback owner check is Linux-only. `CAIRN_TOKEN` and `CAIRN_AUTH` are removed from the server's environment so the token file is always the one in use. Links to other origins open in the default browser. Quitting the app stops the server with SIGTERM.

Only the macOS package is maintained. The research behind the stack is `docs/research/desktop-app-stack-2026-11-08.md`.

## Build

```bash
pnpm --filter @cairn/web build
pnpm --filter @xiechimon/cairn build
node apps/server/scripts/stage-web.mjs
pnpm --filter @cairn/desktop stage
pnpm --filter @cairn/desktop dist:mac
```

`stage` copies the server's `dist`, `web`, `drizzle` and the `better-sqlite3` runtime (its Node-API prebuilds load under Electron unchanged) into `apps/desktop/server`. `dist:mac` writes arm64 and x64 DMG and zip files to `apps/desktop/release`. Builds are unsigned until a Developer ID is set up; the DMG must be built on macOS.

The `electron` package's install script is disabled in `pnpm-workspace.yaml`, so `pnpm install` does not download Electron. To run `pnpm --filter @cairn/desktop start` locally, run `node apps/desktop/node_modules/electron/install.js` once.
