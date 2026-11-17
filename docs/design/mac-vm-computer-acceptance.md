# Mac agent computer: Rakazo parity and BOSS Zhipin, acceptance

Status: accepted scope (ian, 2026-11-17). Design: [`mac-vm-computer.md`](mac-vm-computer.md). Research: [`agent-computer-cross-platform-2026-11-17.md`](../research/agent-computer-cross-platform-2026-11-17.md). Reference product: Rakazo (`elie222/rakazo`, `docs/computer.md`, `docs/desktop-mac-without-docker.md`, `infra/sandboxes/computer/Dockerfile`).

Every check runs on ian's Mac in the Cairn Mac app built from the branch under test, through the Coordinator chat or the Computers panel, never only through the HTTP API. A check passes only with evidence: a screenshot or recording of the app, plus the daemon log lines it names. Fixture or unit evidence is listed separately and never replaces a live check.

## Order

| Step | Scope | Done when |
|---|---|---|
| 0 | Ship what exists: VM computer, two browsers, screen, immersive view with hover control | Pushed to `main`, `check` / `pack-smoke` / `e2e-gate` green on that commit, `computer-image` workflow published `ghcr.io/xiechimon/cairn-computer`, the package is public, `image.json` carries its digest, and a fresh-user run (no `container` runtime on the Mac, no local image) reaches a running desktop |
| 1 | Desktop tools and preinstalled tools | A1–A3 |
| 2 | Installing software | B1–B4 |
| 3 | Computer actions | C1–C4 |
| 4 | CloakBrowser key by an input card | D1–D4 |
| 5 | The agent uses the owner's own Mac | E1–E6, design first |
| 6 | BOSS Zhipin | F1–F3 |

## A. Desktop tools (Rakazo `computer_observe` / `computer_act`)

- A1. Asked "截一张你电脑的屏幕给我", the Coordinator calls `computer_observe` on the VM and the chat shows the VM desktop image.
- A2. Asked to open the terminal from the dock and type `echo hi`, the Coordinator uses `computer_act` (click, type, key) and a following `computer_observe` shows the terminal with `hi`. The owner sees the same in the Computers panel live.
- A3. Without a shell call, `git --version`, `curl --version`, `python3 --version`, `pip --version`, `jq --version`, `rg --version` and `unzip -v` all succeed inside the VM (asked through the Coordinator).

## B. Installing software

- B1. `pip install --user httpie` and an npm global install into the home prefix succeed as the agent and survive a computer recreate (step C3).
- B2. Asked to install `ffmpeg`, the Coordinator calls `install_packages`; the chat shows an approval card naming the Debian packages; after the owner approves, `ffmpeg -version` works in the VM. Declining leaves nothing installed and the Coordinator says so.
- B3. The agent still has no root: `id -u` is 1000, `sudo` is absent, and `nft flush ruleset` as the agent fails. A package name outside Debian's archive, a path, a URL or an option-like name is refused before anything runs.
- B4. After C3 (recover) the approved packages are installed again without a new approval.

## C. Computer actions (Rakazo "More computer actions")

In the Computers panel, a `…` menu on the Coordinator computer with:

- C1. 停止电脑: the VM stops, the panel shows 关着, the home volume is kept; the next use starts it again.
- C2. 更新电脑: when the pinned image changed, the VM is recreated from the new image with the home volume kept; with no change it says it is current.
- C3. 恢复电脑: a VM that is broken (killed X server) is recreated; home kept.
- C4. 重置电脑: after a confirmation that names what is lost, the VM and its home volume are deleted and a fresh one starts; browser sign-ins are gone.

## D. CloakBrowser key

- D1. With no key, a stealth browser call (or the owner asking for BOSS Zhipin) makes the Coordinator post an input card "CloakBrowser 许可证" with a password-type field, a link to get a free key at `cloakbrowser.dev`, and 保存.
- D2. Saving stores the value as team secret `CLOAKBROWSER_LICENSE_KEY` (visible by name, never value, on the secrets page) and the Coordinator retries the call without the owner typing anything else.
- D3. The key never appears in the chat transcript, Langfuse, daemon log, computer call output or VM argv (grep of each after D2).
- D4. A rejected key surfaces the CloakBrowser reason in the chat and the card again.

## E. The agent uses the owner's Mac (agent-desktop)

Design first (states, approval rows, failure paths), following Rakazo "Use your own computer".

- E1. Settings → 电脑 has 允许 agent 使用这台 Mac, off by default, with the warning that the agent can read files and run programs as the owner.
- E2. Turning it on installs the pinned `agent-desktop` 1.1.0 into the Runner's tools folder and walks the owner to System Settings for Accessibility and Screen Recording; the panel shows which grant is missing.
- E3. The first time the agent uses an app (e.g. Finder), the chat shows an approval card: 允许这一次 / 这个对话里都允许 / 拒绝. Nothing reaches the app before approval.
- E4. Only owner-started Coordinator conversations can use it; routines and other people's messages are refused with a reason.
- E5. Turning the switch off stops further calls immediately.
- E6. The server's `refuseOwnComputerUntilGated` gate is replaced by this approval gate, with a test per path; the commit records ian's approval.

## F. BOSS Zhipin

- F1. In the Mac app, the owner asks the Coordinator to open BOSS直聘. It uses the stealth browser in the VM; if no key exists, D1 runs first.
- F2. The page stays on `zhipin.com` (no blank-out, the issue #4299 failure) and the Coordinator reports the page title; the panel shows the page live.
- F3. When BOSS asks for a login, the Coordinator hands off ("需要你登录"), the owner logs in by moving the pointer into the screen, and after the pointer leaves the Coordinator continues on the logged-in page.

Not in scope: Windows, Linux moving onto the image, Team/Private computers per bot (Cairn has one Coordinator computer per owner).
