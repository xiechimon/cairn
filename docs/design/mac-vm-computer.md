# Mac agent computer in a Linux VM

Status: approved direction (ian, 2026-11-17), design for implementation. Research: [`agent-computer-cross-platform-2026-11-17.md`](../research/agent-computer-cross-platform-2026-11-17.md). Prior art followed: Rakazo `docs/desktop-mac-without-docker.md`.

## Goal

A Mac Runner (the Cairn Mac app's bundled daemon, or `cairn start` on a Mac) offers `computer: true` and `browser: true`. Each computer scope is one Debian VM started through Apple's `container` runtime on macOS 26+ Apple silicon. The user installs nothing besides Cairn and never types a password. The Coordinator drives it with the existing computer tools; the owner watches and takes over in the existing computer panel.

Out of scope: Windows, Linux moving onto the image (decision 4, later), Intel Macs, macOS < 26.

## Pieces

| Piece | Where | What |
|---|---|---|
| Guest image | `apps/daemon/computer-image/` (`Dockerfile`, `desktop.sh`, `entry.sh`, `guard.nft`, `browser.sh`, `agent-browser.sh`, `cloak.mjs`) | `debian:bookworm-slim` pinned by digest; the host-desktop program set (Xvfb, openbox, picom, plank-reloaded, hsetroot, x11vnc, xdotool), Chromium (the default browser), lxterminal, Noto CJK, nftables, Node copied from a digest-pinned `node:22-bookworm-slim` stage and `cloakbrowser@0.7.2`, `agent-browser` 0.41.2 (linux binary from the npm tarball, checked against its npm sha512). Setuid bits are stripped. Built for `linux/arm64` and `linux/amd64` by `.github/workflows/computer-image.yml`, pushed to `ghcr.io/xiechimon/cairn-computer`. The daemon pins `image@sha256:…` in `apps/daemon/computer-image/image.json` |
| Runtime resolver | `apps/daemon/src/computer/vm-runtime.ts` | Finds or provisions `container` ≥ 1.7.0, then `container system start` |
| VM desktops | `apps/daemon/src/computer/vm-desktop.ts` | Same surface as `HostDesktops`: `forScope`, `hold`, `socketPath` (TCP), `presence`, `subscribe`, `sweep`, `missingPrograms`, `prepareBrowser`, `offersBrowser`, `close`, `killAll` |
| Wiring | `apps/daemon/src/machine-loop.ts` | One `desktops` variable typed by a shared interface; darwin builds `VmDesktops`, linux builds `HostDesktops` |
| License | existing team secret page; `apps/server/src/services/machine-computer.ts` | Team secret `CLOAKBROWSER_LICENSE_KEY` attached to stealth browser calls for machines whose computer is a VM |

## Runtime resolution (Rakazo order)

1. A running `container` system ≥ 1.7.0 (`container system status`, `--version`): use it.
2. `/usr/local/bin/container` ≥ 1.7.0: `container system start --enable-kernel-install`.
3. Otherwise download the pinned `container-1.7.1-installer-signed.pkg` (URL, size, SHA-256 in `image.json`) to `<CAIRN_HOME>/vm/download`, verify size and hash, `pkgutil --check-signature` must name `Developer ID Installer: Apple Inc. - Containerization (UPBK2H6LZM)` and be notarized, `pkgutil --expand-full` into a scratch dir renamed to `<CAIRN_HOME>/vm/runtime/1.7.1`, then `container system start --install-root <runtime>/Payload --app-root <CAIRN_HOME>/vm/app --log-root <CAIRN_HOME>/vm/log --enable-kernel-install`.

A system the daemon did not start is never stopped. Unsupported host (not darwin arm64, macOS < 26): `missingPrograms()` returns a reason and the machine reports no computer.

States: `absent → downloading → verifying → expanded → starting → ready`, or `failed(reason)`. Resolution runs lazily on the first `ensure` of a scope, once per daemon process (a promise memo), so boot never blocks on a 170 MB download. A failure is reported as `ComputerRefusal` with the reason and retried on the next call.

## VM lifecycle per scope

- Name `cairn-computer-<sha256(scope)[:24]>`, label `cairn.scope=<sha256>`. A volume of the same name holds `/home/agent` (profile, Cloak cache, files), created once.
- `container run --detach --name … --cpus 2 --memory 2g --cap-drop ALL --cap-add CAP_NET_ADMIN --cap-add CAP_SETUID --cap-add CAP_SETGID --cap-add CAP_CHOWN --tmpfs /run/cairn --volume <name>:/home/agent <image@digest>`. A fresh volume is owned by root (measured), so `entry.sh` needs `CAP_CHOWN` once to seed `/etc/skel` and hand `/home/agent` to uid 1000; `/run/cairn` is a tmpfs for the ready marker and the license.
- `entry.sh` (root): load `guard.nft` with the gateway from `/etc/resolv.conf`, verify the gateway element, then `setpriv --reuid=1000 --regid=1000 --init-groups --inh-caps=-all --bounding-set=-all --no-new-privs` into `desktop.sh`. Missing table → exit non-zero → start fails.
- `desktop.sh`: Xvfb `:1` 1600x1000, `dbus-update-activation-environment DISPLAY`, openbox (maximize rule), picom, plank-reloaded with the hide-mode toggle after start, x11vnc control on `:5900` and `-viewonly` on `:5901`, both `-nopw`, then `touch /run/cairn/ready` (tmpfs, so a stale marker never survives a restart).
- Ready = VM running, address known, `container exec … test -e /run/cairn/ready`, and TCP connect to both ports; 30 s deadline.
- Idle stop after `HOST_DESKTOP_IDLE_STOP_MS`: graceful browser quit (`browser.sh quit`), then `container stop`. The volume stays. Presence states come from `container list --all` filtered by label.
- `killAll`/`close`: stop VMs this daemon started.

## Guard (`guard.nft`)

Input policy drop: lo, established, gateway → tcp 5900, 5901. Output: lo, established, gateway DNS, then drop `0/8 10/8 100.64/10 127/8 169.254/16 172.16/12 192.0.0/24 192.168/16 224/4 240/4` and IPv6 `::1 fc00::/7 fe80::/10 ff00::/8`; everything else accepted. `198.18.0.0/15` stays open: TUN proxies hand out fake-ip answers there (measured on ian's Mac). Measured on the trial VM: the agent uid cannot reach the Mac, the LAN or another VM, reaches the internet, and cannot flush the rules.

## Commands, files, browser

- `execute`: `container exec --interactive --uid 1000 --env HOME=/home/agent --env DISPLAY=:1 <vm> timeout <s> <argv…>`; stdout/stderr/exit stream like `HostComputerProvider`. Files: `listFiles`/`readFile`/`writeFile` run one fixed Node script through `container exec` (base64 out, raw stdin in), confined to `/home/agent` by a realpath check inside the guest; Node gives exact bytes and realpath where `stat`/`base64`/`cat` would need several round trips. Requested command environment values go through `--env NAME` inherited from the CLI process, never `--env NAME=value` argv.
- Two browsers (owner decision, ian 2026-11-17, superseding "no Chromium fallback"): Debian Chromium is the default (no seat, many sessions, profile `.cairn/browser-profile`, session `<scope>`); CloakBrowser runs only when a browser tool call passes `stealth: true` (profile `.cairn/cloak-profile`, session `<scope>-stealth`). Both sessions can run at once on one desktop. The guest `agent-browser` wrapper picks the engine from the session name; a stealth call never falls back to Chromium. `offersBrowser()` is true whenever the desktop runs; the capability `stealthBrowser` reports whether Cloak can run.
- License: when a stealth agent-browser call carries `call.browserLicense`, the daemon pipes it on stdin to `cairn-browser key` (uid 1000), which writes `/run/cairn/cloak.key` (tmpfs, 0400); then `cairn-browser prepare` runs `cloakbrowser` `ensureBinary` inside the guest (the SDK picks the binary by `process.platform/arch`). The key never enters argv, logs or the image. The VM remembers it until stop. A stealth call without a license refuses with "No CloakBrowser license; set team secret CLOAKBROWSER_LICENSE_KEY".
- Takeover (`hold(scope,'control')`): the owner sees whichever windows are open. The Chromium session is handed over as its existing window. If Cloak was prepared in this VM life, `cairn-browser owner <scope>-stealth` closes the stealth agent-browser session, waits for the profile lock and starts Cloak without a debugging port; handback on the next stealth call: `cairn-browser agent` quits that window and waits. Same rules as `docs/design/computer-login-handoff.md`. A takeover before any stealth call does not refuse: the desktop, terminal and Chromium are still the owner's to use (refusing would have blocked them).
- Screen: `socketPath(scope, kind)` returns `<ip>:5900` or `<ip>:5901`; `createComputerScreenProvider` gets a `connect` that dials TCP for `host:port`. `terminal` kind: `container exec --interactive --tty --uid 1000 <vm> bash -l`.

## Server change

`forwardComputerCall` attaches `browserLicense` (the team secret `CLOAKBROWSER_LICENSE_KEY`, opened only in memory) to browser calls with `stealth: true` when the target machine reports `computerKind: 'vm'`. Wire: optional `browserLicense?: string` on the computer call schema, never logged, redacted like `browserSecrets`. The secrets page lists the name with a hint. Linux host desktops keep the license file until decision 4 moves them onto the image.

## Failure behavior

| Failure | Result |
|---|---|
| Not macOS 26+ arm64 | No computer capability; machine page shows the reason |
| Download, hash or signature fails | Call refused with the reason; partial files removed; next call retries |
| Image pull fails | Refused; retried next call |
| Guard fails to load | VM removed, start refused |
| VM dies while in use | Presence `failed`; next call recreates it; volume kept |
| No license secret | Chromium browser works; a stealth call is refused with the secret name |
| License rejected or seat limit | Stealth call refused with the sanitized SDK reason (a free seat frees itself in about 4 minutes); no Chromium fallback |

## Tests

One test per row above with a fake `container` CLI (a script recording argv and serving fake `list`/`inspect` JSON) and fake TCP listeners for 5900/5901, mirroring `computer-host-desktop.test.ts`; resolver tests with fake `pkgutil` and a local HTTP server; a server test that `browserLicense` is attached only for VM machines and never for other tools; a guard test that runs `nft -c -f guard.nft` in CI. Live acceptance: Mac app, Coordinator chat opens a site, owner takes over and hands back, firewall probe from the agent shell.
