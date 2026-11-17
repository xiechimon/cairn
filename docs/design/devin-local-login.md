# Devin local login and import (desktop)

The add-subscription dialog still asks the user to `cat ~/.local/share/devin/credentials.toml` and paste the output — the stopgap shipped in `c66fb8e79`. The reference, T3 Code, never pastes tokens: the agent runs on the user's machine and the app drives the CLI's own login through ACP `authenticate`. This change gives the Cairn desktop app the same closed loop, using the same mechanism: one click reads the local Devin login when it exists, or talks ACP `initialize`/`authenticate` to a locally spawned `devin acp` (PKCE OAuth, `localhost:<port>/callback`, browser opened by the CLI) and harvests the credential when it does not. The token still lands in the same `CreateDevinSubscription` body, so nothing downstream changes. The paste form stays as the fallback for browsers, for Macs with no `devin` binary, and for login failures.

The desktop main process does the file and process work; the page talks to it over a new `cairnDesktop.devin` bridge, same pattern as `localProviders`.

## Wire surface

Four `ipcMain.handle` channels behind the existing `fromOwnPage` guard, exposed by preload as `window.cairnDesktop.devin`:

| Channel | Args | Returns | Notes |
|---|---|---|---|
| `devin:status` | — | `DevinLocalStatus` = `{ loggedIn, canLogin }` | `loggedIn`: `windsurf_api_key` parses out of `~/.local/share/devin/credentials.toml`. `canLogin`: a `devin` binary resolves (below). Never returns the key. |
| `devin:import-key` | — | `{ ok: true, key } \| { ok: false, reason: 'no-key' }` | Reads the credentials file on click. |
| `devin:login` | — | `{ ok: true, key } \| { ok: false, reason }` | Spawns `devin acp`, runs ACP `initialize` + `authenticate`, returns the key. `reason` ∈ `no-binary \| spawn \| exit \| timeout \| cancelled \| busy`. |
| `devin:cancel-login` | — | `void` | Kills the in-flight login; its pending call resolves `cancelled`. |

## State machine (desktop main)

At most one login is in flight: `{ child, deadline, before }`.

```
login()
  in flight            -> { ok:false, busy }
  no binary            -> { ok:false, no-binary }
  spawn throws         -> { ok:false, spawn }
  child exits, no key  -> { ok:false, exit }        (exit code logged, never shown)
  deadline (600s)      -> kill, { ok:false, timeout }
  cancelled            -> kill, { ok:false, cancelled }
  key observed         -> kill if still alive, { ok:true, key }
```

`before` snapshots the credentials file's `mtimeMs` (0 when absent). The poll (500ms) accepts the key once the file's `mtimeMs` exceeds `before` — this also catches a re-login that rewrites the same account. A child that exits after writing is still a success (the exit arm re-reads the file first).

`cancel-login` marks the flight cancelled and kills the child; the pending poll resolves `cancelled` on its next tick. `before-quit` cancels the same way, so no login process outlives the app.

### Driving the login (measured on this Mac, 2026-11-17)

`devin auth login` is a TUI (menu: `❭ 1 Log in with browser · 2 Paste a token manually · 3 Windsurf for Enterprise`) that aborts with `Error: Login canceled` on a non-TTY stdin, and the macOS PTY shims fail under an Electron spawn — `/usr/bin/script` needs its own stdin to be a TTY (`tcgetattr/ioctl: Operation not supported on socket`). The same CLI's `devin acp` side is plain newline-delimited JSON-RPC over stdio and needs no TTY — the protocol T3 Code uses. Its `initialize` response advertises `authMethods: [{id: "devin-browser", name: "Log in with browser"}]`; `authenticate` with that `methodId` opens the user's default browser for the PKCE flow and resolves `{"result":{}}` once the `localhost` callback lands and `credentials.toml` is written — verified live end to end. The spawned `devin acp` is a thin relay into the user's devin daemon, so killing it on cancel only drops the RPC pipe; the file poll and timeout bound the wait either way.

The desktop side sends `initialize`, picks the first advertised `authMethods[].id` (falling back to `devin-browser`), sends `authenticate`, then treats either the `authenticate` result or a fresh `credentials.toml` as success. `methodId` discovery keeps it working if Devin adds enterprise methods later.

## Binary resolution order

First executable wins:

1. `devin` in each `PATH` entry (covers shells that launched the app with a real PATH)
2. `~/.local/bin/devin` (the Devin installer's own location, symlink into `_versions/current`)
3. `/opt/homebrew/bin/devin`, `/usr/local/bin/devin`
4. Newest `~/.local/share/cairn/agents/devin/<version>/bin/devin` — the daemon-managed install; it writes the same `~/.local/share/devin/credentials.toml` when run with the user's real HOME

The credential path is fixed at `~/.local/share/devin/credentials.toml` (XDG convention on macOS and Linux — verified live on this Mac).

## Web dialog states (`apps/web/src/resources/devin-subscriptions.tsx`)

`devinBridge()` mirrors `localProviderBridge()` in `local-provider-import.tsx`. `status()` runs once on mount; while it loads, the bridge section renders nothing (no flash, no placeholder).

| `status()` | Rendered | Click path |
|---|---|---|
| `loggedIn` | line "这台 Mac 已登录 Devin" + `从这台 Mac 导入` | `import-key` → `onCreate({label, key})` |
| `!loggedIn && canLogin` | `在这台 Mac 上登录 Devin` + meta "会打开浏览器完成登录" | `login` → waiting row → `onCreate` |
| neither, or no bridge | nothing | paste form only |

Waiting: spinner + "已在浏览器中打开 Devin 登录页，完成后会自动继续" + `取消` → `cancel-login`, back to the button. Failure: one mapped line per reason (no raw codes); `cancelled` resets silently. Dialog unmount cancels any in-flight login. Once `onCreate` fires on either path the other is suppressed — the existing mutation `pending`/`error` props take over from there.

The paste paragraph and form stay unchanged below the bridge section; the server still receives only `label` + `token` + `expiresAt`.

## Tests, one per path

`packages/shared/test/devin-local.test.ts`:

- `devinKeyFromToml`: double-quoted key, key among other entries, single-quoted value, missing key, empty input.
- `devinBinaryCandidates`: PATH hit first, `~/.local/bin` fallback, managed newest-last ordering, dedupe.

`apps/web/test/devin-subscriptions.test.ts`: `extractDevinToken` keeps its paste fallback semantics (now backed by `devinKeyFromToml`).

`apps/web/e2e/devin-local-login.spec.ts` (fixture stack, `cairnDesktop.devin` mocked like `first-run-setup.spec.ts`):

- `loggedIn` → import click → subscription row appears (real create API).
- `canLogin` → click → waiting row → mock resolves key → row appears.
- mock resolves `{ ok:false, reason:'timeout' }` → mapped error line, paste path still usable.
- cancel → button back, no subscription created.

Desktop main glue (`devin-auth.ts`) is IO-only, matching the untested `runner.ts`/`updater.ts` precedent; live verification runs the real app: logged-in import on this Mac, one real `authenticate` round-trip, and a cancel mid-flight.
