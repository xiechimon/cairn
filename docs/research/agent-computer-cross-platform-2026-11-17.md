# The agent's own computer across macOS, Windows and Linux

Status: research, 2026-11-17. No product code changed. Question (ian): the Mac app has no agent computer. Should the computer be one Linux image shared by all three platforms, with macOS and Windows running it in a VM (or WSL2) and Linux running it natively, and with Arch as the guest? Is that right for Cairn?

Evidence labels: `实测` = read or run first-hand in this session, `推断` = follows from `实测` facts, `猜测` = everything else. Host measurements ran on ian's Mac (Apple M2, 8 cores, 16 GiB, macOS 27.2) with the OrbStack 2.2.5 that was already installed; the probe machines were deleted afterwards.

Builds on: [`agent-small-computer-2026-11-08.md`](agent-small-computer-2026-11-08.md) (hybrid: container boundary on omarchy, libkrun as an opt-in VM, E2B remote) and PR [#4754](https://github.com/xiechimon/cairn/pull/4754) (2026-11-15: the Linux host desktop became the agent computer; macOS has none; the nspawn computer Orb and its image were deleted).

## 1. Where Cairn is today

- Linux daemon: `computer: true` when `HOST_DESKTOP_PROGRAMS` (`systemd-run`, `Xvfb`, `openbox`, `x11vnc`, …) are on `PATH`; it starts a private Xvfb desktop on the host under a `cairn-desktop-*` systemd unit (`apps/daemon/src/computer/host-desktop.ts`) (`实测`). The agent's browser runs as the host user, with the host user's file access (`推断`).
- macOS daemon: no computer at all (`实测`, PR #4754 proof table).
- Mac app: Electron 45, `identity: '-'` with a self-signed certificate, `hardenedRuntime: false`, no notarization; it bundles the server and the runner as `extraResources` (`实测`, `apps/desktop/electron-builder.yml`).
- No earlier decision for "one image on three platforms" exists in `docs/` or issues (`实测`, grep for WSL, Virtualization.framework, vfkit, Lima). The nearest is [default Runner and platform routing](../design/default-runner-and-platform-routing.md), where ordinary tasks run on a Linux default Runner (`实测`).

## 2. Comparison

| Option | Isolation | GUI and computer-use quality | Start time | Disk and memory | Packaging in the Mac app | Windows | Source |
|---|---|---|---|---|---|---|---|
| **A. One Linux guest, VM on Mac and Windows, native on Linux** (ian's idea) | Own guest kernel on Mac (Virtualization.framework) (`实测`, Apple docs). On Windows, WSL2 runs every distro as a container in **one shared utility VM** with the user's other distros, `C:\` mounted at `/mnt/c` and Windows interop on by default (`实测`, MicrosoftDocs/WSL `about.md`, `wsl-config.md`); a dedicated Hyper-V VM needs Windows Pro (`实测`) | The same Xvfb + openbox + x11vnc + Chromium stack the Linux host already runs, so screenshots, `xdotool`, VNC watch and takeover behave identically on every platform (`推断`). Does not need the VM's own display device | Debian guest in OrbStack's already-running VM: machine create 23 s, start 0.07 s; Chromium window up 1.4 s after launch inside Xvfb (`实测`). Apple `container` claims sub-second VM start (`实测`, README) | Debian bookworm arm64 + Xvfb/x11vnc/openbox/xdotool/Chromium: `/usr` 1.2 GB, machine 1.6 GB (`实测`). Chromium on `about:blank` used 1.0 GB RSS (`实测`). Claude's Cowork VM: 1.25 GB download, 9.0 GB on disk (`实测`, on this Mac). A VM books guest RAM unless a balloon returns it (`推断`) | `com.apple.security.virtualization` needs no provisioning profile; Lima, vfkit, apple/container and apple/containerization all sign ad-hoc with it (`实测`, their Makefiles and `.entitlements`). So the current ad-hoc Mac app can run a VM (`推断`). Image downloaded on first use, not in the dmg (`推断`) | WSL2 `.wsl` distro (tar), installable with `wsl --install --from-file`, WSL 2.4.4+, Windows 10 19041+ including Home (`实测`). `.wslconfig` limits (memory default 50% of host) are global to all of the user's distros (`实测`) | §4 |
| **B. Host desktop per platform** (Linux today; macOS = the user's own screen) | None on macOS: Claude's docs say there is "no sandbox between Claude and your applications" (`实测`) | Shares the user's session. Claude on macOS 15+ posts events to background windows via private SkyLight calls, without a virtual display (`实测` strings in `app-cu-helper`; `推断` behavior). macOS has no public API for a second agent desktop (`猜测`; `CGVirtualDisplay` is private). Windows has one: the agent workspace, a separate agent account and desktop (`实测`, Microsoft Learn) | Instant | Nothing extra | Needs Screen Recording and Accessibility TCC grants (`实测`, Claude and OpenAI docs) | Agent workspace or foreground computer use (`实测`, OpenAI docs: Windows is foreground-only) | §4 |
| **C. Remote sandbox** (E2B, Daytona) | Firecracker microVM (E2B) or container/VM (Daytona) (`实测`) | Same Xvfb/x11vnc/noVNC stack (`实测`, e2b-dev/desktop, Daytona docs). Datacenter IP: the BOSS Zhipin login page already blocks automated Chrome from a home IP (issue #4299, `实测`); a datacenter IP is likely worse (`猜测`) | E2B resume ~1 s; Daytona claims under 90 ms (`实测`, vendor claims) | No local cost. One always-on 2 vCPU / 4 GiB desktop: E2B ≈ $121/mo + $150 Pro; Daytona ≈ $121 Linux, $173 Windows (`推断`, arithmetic on `实测` price pages) | API key only | Same service | §4 |
| **D. The default Runner's computer** (omarchy's desktop viewed from the Mac app) | As Linux today | Works now on omarchy (#4684 owner check, quoted in #4754) (`实测` text) | Instant | omarchy's | Nothing | Nothing | §1 |

Product precedents for where the agent's computer runs:

| Product | Where | Source |
|---|---|---|
| Claude Cowork | Code execution in a Linux VM: Virtualization.framework on macOS, HCS on Windows; the agent loop and MCP moved outside the VM later; only the workspace is mounted; egress allowlist (`实测`). On this Mac the app is Developer ID signed with hardened runtime; the VM bundle is a 10 GiB rootfs, and the addon references `VZVirtioSocketDevice`, balloon and a gVisor netstack (`实测`, `codesign`, `strings`). Computer use runs **outside** the VM on the user's screen (`实测`) | [How we contain Claude](https://www.anthropic.com/research/how-we-contain-claude), [Cowork computer use](https://support.claude.com/en/articles/14128542-let-claude-use-your-computer-in-cowork) |
| ChatGPT / Codex desktop | Computer use on the user's desktop; OpenAI suggests a Windows VM for isolation; no virtualization entitlement in the app (`实测`) | [computer use](https://learn.chatgpt.com/docs/computer-use) |
| Windows agent workspace | Separate agent account and desktop in parallel with the user, watch and take over (`实测`) | [agentic security](https://learn.microsoft.com/en-us/windows/security/book/operating-system-agentic-security) |
| Podman Desktop, Rancher Desktop, Docker Desktop, OrbStack | Ship a Linux VM: libkrun or vfkit (Podman, 948 MB arm64 image), Virtualization.framework (Rancher, Docker), one shared VM (OrbStack); on Windows each ships its own WSL distro (Podman Fedora, Rancher Alpine, `docker-desktop`) (`实测`) | [podman-machine](https://github.com/containers/podman/blob/main/docs/source/markdown/podman-machine.1.md), [Rancher VM](https://docs.rancherdesktop.io/ui/preferences/virtual-machine/emulation/), [Docker VMM](https://docs.docker.com/desktop/features/vmm/), [OrbStack](https://docs.orbstack.dev/architecture), [Docker WSL](https://docs.docker.com/desktop/features/wsl/), [podman-machine-wsl-os](https://github.com/containers/podman-machine-wsl-os), [rancher-desktop-wsl-distro](https://github.com/rancher-sandbox/rancher-desktop-wsl-distro) |
| Rakazo desktop (`elie222/rakazo`, `docs/desktop-mac-without-docker.md`) | On Apple-silicon Macs with macOS 26+, each bot computer is one VM through Apple's `container` 1.7.1, from the unchanged published computer image. Nothing is bundled: on first use the app downloads Apple's signed `container` pkg, checks it with `pkgutil --check-signature`, expands it **without installing** (no sudo) and runs `container system start` with its own roots under the app's data folder; it reuses a user's own `container` 1.7.0+ if one runs. An nftables table inside each VM blocks the Mac, the LAN and other computers. Measured there: runtime 47 s download, kernel ~45 s, image 1.58 GB, later VMs 2–3 s, ~970 MB host RSS with Chromium (`实测`, read the doc) | [desktop-mac-without-docker.md](https://github.com/elie222/rakazo/blob/main/docs/desktop-mac-without-docker.md) |
| E2B desktop, Anthropic computer-use demo | Ubuntu 22.04 + XFCE/Xvfb + x11vnc + noVNC (`实测`) | [e2b-dev/desktop](https://github.com/e2b-dev/desktop), [computer-use-demo](https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo) |

## 3. Is Arch the right guest?

No. Arch is a good host (omarchy) but a poor appliance guest:

- **No official arm64.** Every Apple-silicon Mac needs an arm64 guest. Arch "does not officially support the aarch64 architecture" and RFC 0032 keeps ports unofficial until promoted (`实测`, [RFC 0032](https://rfc.archlinux.page/0032-arch-linux-ports/)). Arch Linux ARM is a separate project (`实测`). The official WSL image is amd64 only (`实测`, [archlinux-wsl](https://gitlab.archlinux.org/archlinux/archlinux-wsl/-/raw/main/README.md)).
- **It broke today.** `orb create arch` on this Mac failed: Arch Linux ARM's repos were mid-transition and `pacman -Sy openssh` refused because `openssl 4.1.0-1` "breaks dependency 'libcrypto.so=3-64' required by systemd" (and by pacman, sudo, curl) (`实测`, 2026-11-17). The amd64 Arch guest under Rosetta did install (164 s, 819 MB) (`实测`), but that is x86 emulation of the whole userland, Chromium included (`推断`).
- **Pinning removes security fixes.** Partial upgrades are unsupported, and a dated Arch Linux Archive snapshot gets no fixes until the whole date moves; mixing archive and live mirrors is unsafe (`实测`, [System maintenance](https://wiki.archlinux.org/title/System_maintenance), [Arch Linux Archive](https://wiki.archlinux.org/title/Arch_Linux_Archive)).
- **Debian stable** has official arm64 and amd64, a native arm64 Chromium package (installed above: `156.0.8078.79-1~deb12u1`, arm64, `实测`), 3 years of security support plus LTS to 5 (`实测`, [Debian LTS](https://wiki.debian.org/LTS)), and a 30 MB slim base (`实测`). Ubuntu's Chromium is a snap, which does not fit a container or WSL (`实测`). Alpine (musl) is smaller but Chromium on musl is less common in this stack (`猜测`).

## 4. The pattern that fits Cairn

ian's instinct is right in its core and wrong in two details.

- **Right: one computer definition, run everywhere.** The agent's computer is a Linux desktop Cairn already knows how to drive (Xvfb, openbox, x11vnc, agent-browser, CloakBrowser). Shipping that same guest as one OCI image makes the agent behave the same on every platform, keeps one set of computer tools, and gives macOS a real sandbox, which option B cannot (`推断`). This is what Claude Cowork, Podman, Rancher and Docker all converged on for "Linux work on a Mac or Windows box" (`实测`, §2).
- **Wrong detail 1: "one image".** It is one image *definition* built for two architectures, arm64 for Macs and amd64 for Windows and Linux (`推断` from §3).
- **Wrong detail 2: Arch.** Use Debian stable slim (§3).
- **Not the "own screen" route for the main computer.** It needs two TCC grants, has no sandbox, and fights the user for the screen; macOS has no public second desktop (§2 B). It can come back later as a separate "use my Mac" capability, the way Claude and ChatGPT offer it.
- **Not remote by default.** Cost (≈ $120–270 per always-on desktop per month), no mainland-China region, VNC latency and datacenter IPs on anti-bot sites (§2 C). Keep it as an opt-in provider, as the 11-08 note already said.

On Windows, WSL2 is the realistic runtime (Home edition, no Pro), but its boundary is weaker than a Mac VM: one shared VM with the user's distros, `C:\` mounted and global memory limits unless the distro's `/etc/wsl.conf` turns automount and interop off (`实测`/`推断`). That is acceptable for a later phase if Cairn's distro disables both.

## 5. Recommendation, Mac first

1. **Guest image.** One `Dockerfile`/rootfs recipe on `debian:stable-slim`, multi-arch, containing today's host-desktop programs plus Chromium/CloakBrowser and agent-browser. Published as an OCI image with a pinned digest per Cairn release.
2. **Mac runtime.** The Mac app runs that image in a Virtualization.framework VM through Apple's Containerization Swift package (one lightweight VM per container, Apple-maintained, Apache-2.0, macOS 26+) (`实测` README). Fallback if the macOS 26 floor is unacceptable: vfkit (macOS 13+). Sign the helper ad-hoc with `com.apple.security.virtualization` like apple/container does; no Developer ID needed for the VM itself (`实测`).
   - The agent and VNC reach the guest over vsock or a forwarded port; the existing noVNC panel and takeover keep working unchanged (`推断`).
   - Mount only a Cairn-owned workspace folder, never `$HOME`; egress through the existing relay idea (`推断`, matches Cowork).
   - Budget on a 16 GiB Mac: guest 3 GiB with a memory balloon, stop after 10 min idle like `HOST_DESKTOP_IDLE_STOP_MS` (`推断` from Chromium's 1.0 GB RSS).
   - Image fetched on first computer use (~0.5–1 GB compressed, `推断` from Podman and Cowork sizes), verified by digest; not inside the dmg.
3. **Linux.** Keep the host desktop for now (it works on omarchy). Once the Mac image exists, run the same image under rootless Podman on Linux and retire the host-desktop path, so there is one computer implementation (`推断`; matches D69 ③).
4. **Windows.** Later: export the same image as a `.wsl` tar with automount and interop off.
5. **Remote.** E2B desktop provider stays opt-in for machines without virtualization or spare RAM.

Code areas: `apps/daemon/src/computer/host-desktop.ts`, `screen-provider.ts`, `provider.ts` (a VM-backed `ComputerProvider` beside the host one), `apps/desktop/electron-builder.yml` and `scripts/sign-mac.cjs` (helper binary and entitlement), a new image recipe under `scripts/ops/`. The machine dispatch path (`apps/daemon/src/machine-client.ts`, `services/machine*.ts`) is a security surface if touched.

## 6. Decisions for ian

Decided by ian on 2026-11-17: items 1, 2, 4 and 5 as recommended, and item 3 as macOS 26+ with Apple Containerization. He wants to try a Debian desktop before implementation starts.

1. **Direction:** the Mac's agent computer is a local Linux VM shipped by the Mac app (not your own Mac screen, not a cloud sandbox). Recommended: yes.
2. **Guest distro:** Debian stable instead of Arch. Recommended: Debian (Arch has no official arm64, and its ARM repos failed to install on this Mac today).
3. **macOS floor:** macOS 26+ with Apple Containerization, or macOS 13+ with vfkit. Recommended: 26+, one path, Apple-maintained.
4. **Linux follows later:** after the Mac image works, Linux switches from the host desktop to the same image in Podman. Recommended: yes.
5. **Windows timing:** WSL2 distro only when Windows ships. Recommended: defer.

Not covered: a real VM boot of a Debian desktop through Containerization or vfkit on this Mac (nothing was installed); remote sandbox latency from China; Alpine with Chromium.

## 7. Hands-on trial (2026-11-17, ian's Mac, the Rakazo way)

`container` 1.7.1's signed pkg was expanded with `pkgutil --expand-full` and started with `container system start --install-root/--app-root/--log-root` under a scratch folder: no installer, no password (`实测`). The image was `debian:bookworm-slim` plus the current host-desktop set (Xvfb, openbox, picom, plank, hsetroot, x11vnc, xdotool), Chromium, lxterminal, Noto CJK fonts and noVNC.

| Step | Result (`实测`) |
|---|---|
| Runtime start including kernel download | 55 s |
| First image build (builder VM, apt, export) | 170 s |
| New VM from the built image until noVNC answers | 2.0–3.3 s |
| Chromium opened from the dock, shown in noVNC | yes, in its own sandbox as uid 1000 |
| Memory of the computer VM with Chromium on a new tab | 1.01 GiB of a 3 GiB cap (`container stats`) |

Two Debian-specific fixes were needed: `libglib2.0-bin` for `gsettings`, and `dbus-update-activation-environment DISPLAY` so D-Bus can start bamf for Debian's plank 0.11.89; even then plank appeared only after its `dock-items` setting was written once after start (`实测`). omarchy uses `plank-reloaded` (`实测`, `pacman -Q`), so the guest dock differs from the host one.
