# Desktop OTel export

Research: `docs/research/desktop-otel-export-2026-11-16.md`.

## Problem

The server (`apps/server/src/runtime-otel.ts`) and the Runner (`apps/daemon/src/backend/otel.ts`) export spans only when `CAIRN_OTEL_ENDPOINT` is set, and read `CAIRN_OTEL_HEADERS` and `CAIRN_OTEL_ENVIRONMENT` next to it. The desktop main process forks both children with a copy of its own `process.env`. An app launched from Finder or the Dock gets launchd's environment, which never carries these variables, so the packaged Mac app exports nothing.

## Where the configuration lives

One file: `<userData>/otel.env`, which on macOS is `~/Library/Application Support/@cairn/desktop/otel.env`. It is dotenv text parsed with Node's `util.parseEnv`, the same format and names as the deployment host's `~/.config/cairn/otel.env`:

```
CAIRN_OTEL_ENDPOINT=https://<langfuse-host>/api/public/otel
CAIRN_OTEL_HEADERS=Authorization=Basic <base64 pk:sk>,x-langfuse-ingestion-version=4
CAIRN_OTEL_ENVIRONMENT=mac
```

- Only the three `CAIRN_OTEL_*` keys are read; other keys are ignored.
- `CAIRN_OTEL_ENVIRONMENT` defaults to `mac` when the file sets an endpoint and no environment, so Mac traces are always distinguishable from the deployment host's.
- The file holds an ingestion secret, so it must be owned by the user and not readable by group or others (mode `0600` or stricter). A file with wider permissions is ignored and the main process logs why.
- Nothing is bundled or hard-coded; the repository never contains an endpoint or key.

## States and transitions

| File | Children receive | Export |
| --- | --- | --- |
| absent | no `CAIRN_OTEL_*` | off |
| present, mode 0600, endpoint set | the endpoint, headers if set, environment (default `mac`) | on |
| present, no endpoint | no `CAIRN_OTEL_*` | off |
| present, readable by group or others | no `CAIRN_OTEL_*`, one log line | off |
| unreadable or unparsable | no `CAIRN_OTEL_*`, one log line | off |

The file is read once at launch; editing it takes effect at the next launch (Quit Cairn and open it again). `CAIRN_OTEL_*` inherited from the main process environment are always removed first, so the file is the only source and a shell-launched dev build behaves like the packaged one.

## Paths that read or write it

- Reads: `apps/desktop/src/otel-config.ts` `desktopOtelEnv(path)`, called once in `boot()`; the result is merged into the server env in `startServer` and the Runner env in `runnerEnv` (`RunnerOptions.otelEnv`).
- Writes: only the user (or an agent on the user's Mac). The app never writes it.
- Downstream: the Runner's own children (Claude Code, pi) keep going through `runtimeChildEnv`, which strips `CAIRN_OTEL_*` as it does today.

## Reaching the collector

The deployment's Langfuse binds `127.0.0.1:3000`. On omarchy it is already published to the tailnet only by Tailscale Serve (`https://<host>.<tailnet>.ts.net:8443` → `127.0.0.1:3000`), which gives the Mac an HTTPS endpoint with no binding change and no SSH tunnel to keep alive. An SSH local forward or a LAN bind are the fallbacks for a host without Tailscale; see the research note.

## Failure behavior

Export stays best effort: the server and Runner send through their bounded senders and drop on overflow or an unreachable collector, so an offline tailnet never blocks a turn or task. A bad file disables export and never stops the app from starting.

## Tests

`apps/desktop/scripts/otel-config.test.mjs` (run by the `desktop-mac` workflow with `node --test`): absent file, 0600 file with endpoint (environment defaults to `mac`), explicit environment kept, no endpoint, group-readable file, extra keys ignored, inherited `CAIRN_OTEL_*` removed from the server and Runner envs.
