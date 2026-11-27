# The Coordinator's browser on a Mac

Prior art and the reasons for the shape: `docs/research/mac-agent-browser-prior-art-2026-11-26.md`.
The built-in Linux VM was the only browser a Mac had; when it was removed, every Mac stopped
reporting `browser` and every `browser_*` call failed.

## Owner decision, 2026-11-27

The owner chose option 1:

> Protect the browser parts this change adds, write down the remaining risk, then ship.
> - Browser driver: the sandbox may not rewrite or directly exec it. The unzip tool is always the system one.
> - Chrome: only the one in the system Applications folder that passes Google code-signature verification. Users with Chrome elsewhere download the ~100 MB Cairn browser component instead; they never install Chrome themselves. (This changes the earlier approved "prefer installed Chrome".)
> - Screen stream: live view is out of scope, so switch it off after every launch. A short gap between launch and switch-off may remain; measure it.
> - Click: goes only to the browser that opened the current page.
> - Acceptance: write tests and design to this standard first, then code, then a new review. If it fails again, stop; no fourth version.
> - Remaining risk: `npx`, and the risk accepted on 11-24, stay.

The Mac host shell remains `(allow default)` with credential-focused denies. Commit `96c8470a5`
records the accepted 2026-11-24 residual: host-shell write access to shell rc files and
LaunchAgents is inherent to owner-approved credential-only confinement. This design adds narrow
protections for the browser driver, the browser bundle and the browser's local control ports; it
does not reopen that decision.

## What a newcomer meets

They install Cairn today, open the Coordinator and write "open example.com". Nothing to set up,
no account, no key, no payment, no prompt to install anything.

- With Google Chrome installed, Cairn runs that Chrome with no window, no Dock icon and no focus
  change, on a profile Cairn owns. Their own Chrome profile is never opened or read.
- Without Chrome, the first browser call downloads Chrome's headless shell (about 100 MB) into the
  Cairn data folder.
- Logins made in this browser stay in `<Cairn home>/mac-browser/profiles/`, one profile per
  Coordinator thread or task scope. The profile uses Chrome's mock keychain, so macOS never asks
  for keychain access; the files are protected by the folder permissions only.
- Nobody can watch or take over this browser. A site that needs a hand login or a captcha ends with
  the Coordinator saying so. Turning on Browser MCP (Settings → Apps) lets it use the Chrome they
  are already signed in to.

## Parts

| Part | Where | Pinned by |
| --- | --- | --- |
| `agent-browser` binary | inside the Mac app (`Resources/agent-browser/`), staged by `stage-agent-browser`; the runner gets its path in `CAIRN_AGENT_BROWSER`; the host-shell sandbox cannot read, write or execute its directory | version, URL, size, SHA-256; the daemon never downloads it |
| Google Chrome | only `/Applications/Google Chrome.app`, after `/usr/bin/codesign --verify -R=<designated requirement>` verifies the measured Google requirement; deep strict verification is not used because genuine Chrome carries resource-fork detritus, and the app is looked up again on every call | not pinned; the host-shell sandbox cannot write the bundle, whether it exists yet or not |
| Headless shell | `<Cairn home>/tools/chrome-headless-shell/`, installed through the managed runtime (lock, staging folder, completion marker, hash check on every use, 256 MB download cap, 10 min fetch timeout) with `/usr/bin/unzip` | version, URL, SHA-256 per architecture |

Chrome is skipped when `/Library/Managed Preferences/com.google.Chrome.plist` exists: an
organisation policy can forbid headless or remote control. The two browsers keep separate profile
folders, so removing Chrome later never hands a newer profile to an older browser.

## States

| State | Entered when | Capability report | A browser call |
| --- | --- | --- | --- |
| unsupported | not a Mac, or `CAIRN_AGENT_BROWSER` is unset or not executable, or the CPU has no pinned shell | no `browser` | the server sends none |
| chrome | bundled binary present and Chrome usable | `browser`, `browserSecretFill` | runs at once |
| shell installed | no usable Chrome, shell marker and hash valid | same | runs at once |
| shell absent | no usable Chrome, nothing installed | same (it is downloadable) | starts the download, waits up to 45 s, then runs |
| downloading | a call started the download | same | joins the same download and waits up to 45 s; past that, answers with the percentage and the download carries on |
| download failed | network, status, size or hash failure, or the shell does not start | same | answers with one line naming the cause; the next call downloads again |

`computer`, `computerKind`, `screenHandoff` and `stealthBrowser` are never reported by this
provider. Every Mac daemon with this code reports `ownerChrome`, with or without the binary:
Browser MCP needs only `npx`.

There is no stealth browser on a Mac. A call with `stealth: true` runs in the standard browser and
says so; a page that blocks automation is returned as it is, with no stealth retry. When no machine
in the team reports `stealthBrowser`, the offered tools carry no `stealth` parameter and no text
about it.

A browser session shuts itself down after 30 idle minutes; the daemon closes the rest when it
stops. The profile stays.

An installed headless shell is used only while its version equals the pinned one and it still
starts; otherwise the next call removes it and downloads the pinned one.

## Local ports

`agent-browser` controls the browser through a debugging port and serves a second port that
streams and drives the page. Neither asks for a password, so anything that can connect owns the
browser: it can read files the sandboxed host shell is denied and reach the Cairn server's port.

- Both ports come from a fixed pool of 16 pairs (`backend/loopback-ports.ts`). The macOS host
  shell profile denies connecting to, listening on and binding every one of them, and the Browser
  MCP extension port 9009, for every sandboxed command.
- A session takes the first pair that nobody holds and that can be bound. With every pair held, it
  takes over the pair of a session whose browser has stopped. With none left the call answers that
  too many browsers are open.
- `agent-browser` only learns a browser's address from `DevToolsActivePort`, which Chrome writes
  only when it picks the port itself. It is therefore pointed at `browser-launcher`, a script in
  the Cairn data folder (denied to the sandbox) that writes that file after `lsof` shows that its
  own process listens on the pinned port, then becomes the browser (`CAIRN_BROWSER_EXECUTABLE`).
- Live view is out of scope. After every `agent-browser` command completes, if the session daemon started or `<session>.stream` exists, the daemon synchronously runs `stream disable` with the same session and browser environment, then records the launch-to-shutdown gap in the daemon log. Running `stream disable` after the command returns avoids competing with `open` on the daemon's serialized socket and avoids killing slow launches. A fallback port outside the pool is treated the same way, because the disable is unconditional rather than triggered by the port number.
- `AI_GATEWAY_*` is stripped from browser commands: Cairn never uses the stream server's model
  endpoints, and the key must not be present while the short stream window exists.
- An `escalate` command the owner approved runs outside the sandbox and is not limited by this.
- Linux runners are unchanged by this design: their sandbox does not isolate loopback.

Residual risks accepted here: Browser MCP starts unsandboxed through `npx -y
@browsermcp/mcp@2.5.0`; the npm cache is shared and writable by host commands, so a compromised
host command may influence a later Browser MCP start. The 2026-11-24 credential-only host-shell
decision also leaves shell rc files and LaunchAgents writable. Linux loopback exposure is
pre-existing and unchanged.

## Which machine runs a call

1. **Owner's Chrome.** Taken when the tool is a browser tool, `stealth` is unset, there is no
   `fill_secret` and Browser MCP is on. Candidates are connected machines in this order: the one
   that last answered in this conversation, the server's own host, then the others by last
   contact. For the instance owner's threads only, a candidate is any connected machine
   reporting `ownerChrome`; other people's threads never use the owner's signed-in Chrome. These
   calls create no `computer` row and take no lease; the daemon runs the calls for one tab one
   after another. The server records which browser produced the conversation's current page.
   `browser_snapshot` and `browser_act` never leave that browser: when it is Cairn's browser they
   skip step 1, and when it is the owner's Chrome they are offered only to that machine. This
   also holds after a stealth call or a `fill_secret` action switched the work into Cairn's
   browser.
2. A candidate that cannot reach an extension (no `npx`, the server did not start, no browser
   connected) answers with the shared `OWNER_CHROME_UNAVAILABLE` prefix, and the server asks the
   next one under a new attempt id. It answers that way only when none of the call's commands ran.
3. An extension asking for Allow, a paused extension and every other failure end the call there.
   No other machine and no other browser is tried.
4. **Cairn's browser.** With no candidate left, the call goes to the pinned machine. When step 1
   tried anyone, the result starts with the note that the owner's Chrome was not used and why.

Every `browser_navigate` answer opens with one line naming the browser (the owner's own Chrome
or Cairn's) and the machine, so the Coordinator can say where a page was opened.

## The `computer` row (the chief scope's pin)

| Row | Pinned machine | Result |
| --- | --- | --- |
| none | | pick a connected machine that accepts the tool and insert |
| exists | accepts the tool, connected | use it |
| exists | accepts the tool, offline | "not connected"; its logins live there, so nothing moves |
| exists | cannot run the tool, another connected machine can | move the pin, reset state, control and handoff |
| exists | cannot run the tool, nobody else can | one line saying what to do |

`state` follows the daemon's computer reports, which only a machine reporting `computer`
sends. On any other machine the row rests at `stopped`: a new or moved pin starts there, and a pin
the removed VM left at another value is reset on its next call. Anything else would show
"Starting" on the Runners card for good and keep the project of a task from being deleted.

Readers of the row: `selectTarget`, `holdTakeover`, `handoffRefusal`, the login-challenge handoff
in `receiveComputerFrames`, the lease functions, the Computers panel. Writers: `selectTarget`, the
takeover and lease functions. A handoff is opened only on a machine that reports `screenHandoff`;
on any other, an open handoff would refuse every later `browser_navigate` with nobody able to
close it.

## Every other piece of state

| State | Written by | Read by | On failure or absence |
| --- | --- | --- | --- |
| `capabilities.browser`, `browserSecretFill` | daemon presence report (`machine-loop.ts`), recomputed each report; stored on the `machine` row | `machineAcceptsTool` (target choice), `browserOfferFor`, `ownerChromeCandidates` (server host), secret fill authorization in `machine-computer.ts` and `browser-passwords.ts` | absent: the machine is not picked, secret fills are refused before anything runs; the row keeps the last report while the machine is offline |
| `capabilities.ownerChrome` | daemon presence report on every Mac | `ownerChromeCandidates` | an old daemon lacks it: that machine is not an owner's-Chrome candidate |
| `capabilities.screenHandoff` | daemon presence report, Linux desktops only | `canHandOverScreen` (takeover, login challenge, handoff refusal), `browserOfferFor`, the screen viewer in `computer-screen.ts` | absent: no takeover is offered or opened |
| `capabilities.stealthBrowser` | daemon presence report, Linux desktops only | `browserOfferFor` | absent: the stealth parameter and its text are not offered |
| `ownerChrome` on a computer call | `machine-computer.ts` on the call sent to a daemon | `computer/dispatch.ts` | an old daemon strips it and treats the call as a call for its own browser |
| the offered tool table | `browserOfferFor`, in the in-server runtime and in the Runner claim | the model | the in-server runtime reinstalls it when the offer changes; a Runner gets it with each claim |
| finished browser calls (`computer_call` rows joined to their step) | the call store | `lastBrowserProducer` (candidate order and the browser that owns the current page) | none yet: the server host goes first; rows from another conversation never affect this one |
| `CAIRN_AGENT_BROWSER` | the Mac app, in its runner's environment | `bundledAgentBrowser` | unset or not executable: unsupported |
| `<Cairn home>/tools/chrome-headless-shell/` | the managed runtime during a download | `mac-browser.ts` before every call that has no Chrome | an incomplete or tampered install is not used; the next call downloads again |
| `<Cairn home>/mac-browser/profiles/` | the browser | the browser only | a missing folder is created empty, so the site asks for sign-in again; nothing in this change deletes it |
| port pair held by a session | `mac-browser-ports.ts`, in daemon memory | `mac-browser.ts` before each command | a daemon restart forgets it; a pair still in use cannot be bound, so it is skipped |
| `<Cairn home>/mac-browser/browser-launcher` | `mac-browser.ts` when it first uses a browser | `agent-browser` | rewritten by the next daemon run |
| `<Cairn home>/mac-browser/.agent-browser/<session>.stream` | `agent-browser` | `mac-browser.ts` before each command | absent: no stream yet |
| turn queue per owner's Chrome tab | `owner-chrome.ts`, in daemon memory | the next call for that tab | a failed or stopped call releases its turn |

## What the Coordinator is offered

| Team | `browser_*` | `request_takeover` |
| --- | --- | --- |
| some machine reports `browser`, or Browser MCP is on and some machine can drive the owner's Chrome | offered | offered only with `screenHandoff` or a consented phone |
| neither | not offered | only with a consented phone |

Without takeover, the `browser_*` descriptions say that nobody can take over and to tell the owner.

## Scenarios

| Situation | They see | System | Wait and cost | Test |
| --- | --- | --- | --- | --- |
| Mac with Chrome | the page is opened and described | headless Chrome on a Cairn profile | seconds, no download | daemon capability and launch environment |
| Mac without Chrome, first call, fast network | the answer, noting the one-time download | download, verify, run | under 45 s, 100 MB once | daemon, simulated absent Chrome |
| same, slow network | "still downloading, N%, ask again shortly" | download continues | 45 s, then a retry | daemon |
| same, download fails | one line with the cause | staging removed; next call retries | at most 45 s | daemon |
| Managed Chrome | same as no Chrome | shell | as above | daemon |
| CLI runner on a Mac, no bundled binary | browser tools absent unless another machine can run them | reports no `browser` | none | daemon and server offer |
| Old app on every Mac | browser tools absent | | none | server offer |
| Browser MCP on, extension on the server host | their own Chrome | step 1 | seconds | server and daemon |
| Browser MCP on, extension only on a second Mac | their own Chrome on that Mac | failover, remembered | one extra round per unavailable Mac, first time | server |
| Extension waiting for Allow or paused | the extension's own words | stop | until they act | server and daemon |
| Browser MCP on, no extension anywhere | page from Cairn's browser with the note | step 4 | as above | server |
| Extension drops after a click ran | the error | no replay | none | daemon |
| `browser_act` after the machine that showed the page lost its extension | a not-connected error | no other browser, because the click belongs to the page's own browser | until that Mac or extension returns | server |
| Two calls for one tab at once | both answer | one after the other | the second waits | daemon |
| A sandboxed command probes the browser's ports or 9009 | connection refused | profile denies them | none | daemon, real sandbox on macOS |
| 16 browsers running at once | "too many browsers are open" | no 17th | until one idles out (30 min) | |
| Cairn update pins a new headless shell, or the installed one no longer starts | the answer, after one download | remove and download again | as first use | daemon |
| Non-owner thread | never another person's Mac | remote candidates excluded | none | server |
| `stealth: true` or `fill_secret` | Cairn's browser | step 1 skipped | none | server |
| Pin left on a Mac that can no longer run it | works on another machine | pin moves | none | server |
| Pinned Mac asleep | "not connected" | pin stays | until it wakes | server |
| Site blocks automation on a Mac, or the call asks for stealth | the blocked page and a line that this Mac has no stealth browser | no retry, no refusal | as above | daemon |
| Site shows a captcha on a Mac | the Coordinator says it cannot get past it | no handoff row | none | server |
| Daemon restarts mid-call | the call is reported interrupted | existing call recovery; sessions time out or are reused | none | existing |
| Linux server | unchanged | `HostDesktops` | unchanged | existing |
