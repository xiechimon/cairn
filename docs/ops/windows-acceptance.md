# Windows two-PC acceptance

## One-page journey and baseline

A newcomer installs Node.js LTS (22.19+ on the 22 line, or 24) and Git for Windows on the customer PC. That PC owns the Cairn database and runs both the server and the Runner; the office PC needs only a browser and a route to the customer PC. A Claude subscription is needed for real Claude Code work; a Tailscale account is only needed for the private HTTPS route. Cairn retains application state on the customer PC and encrypts the Claude subscription token on that server. Neither pairing nor opening the task from the office PC copies the server or registers the office PC as a Runner.

The table distinguishes source and dispatcher evidence from Windows runtime evidence. The latter is required before promising this install path.

| Step | What the newcomer does and sees | Existing path and baseline gap | Wait or cost |
| --- | --- | --- | --- |
| 1. Install | In PowerShell on the customer PC, run `npx.cmd @xiechimon/cairn`. Use a separate installed `@xiechimon/cairn-cli` for the Runner. | [Getting started](../getting-started.md) documents both npm packages, not a Windows desktop installer. Dispatcher reported server `latest` is `0.1.2`, behind main. Test checkout tarballs, not registry `latest`. | One-time download; no Cairn account. |
| 2. First boot | Keep the server terminal available and browse to `http://127.0.0.1:8787/app`. | Source defaults to loopback and creates a local data directory with authentication enabled. Clean Windows npm startup, including native SQLite, is not yet proven. | First boot includes migrations. |
| 3. Owner sign-in | Establish an owner session in the customer PC's local browser without pasting a permanent owner token. | [#5201](https://github.com/xiechimon/cairn/issues/5201) tracks the documented gap. The current browser session probe checks an existing session; pairing grants device authority, not owner authority. Capture this denial on the unchanged product before fixing it. | No external account or payment. |
| 4. Approve Runner | In another terminal, run `cairn start --foreground --server http://127.0.0.1:8787`, open its authorization link locally, approve it, then check that the Runner is Online. | Enrollment and its confirmation page exist. The host Runner is owner-gated; a paired browser does not satisfy that check. Windows package discovery, heartbeat and execution remain to be exercised. | Runner polls after approval. |
| 5. Connect Claude | Install Claude Code on the customer PC, run `claude setup-token`, then use Settings → Model services → Add connection → Claude (Subscription), save and Verify. Choose Claude Code for the task. | Existing [Claude setup](../getting-started.md#use-your-claude-subscription-on-your-machines) requires owner writes and runtime detection. Windows CI must use the repo's fake ACP agent without real keys; it cannot validate the real Anthropic account, Claude executable discovery or provider-side verification. | Existing paid Claude subscription; no new subscription in CI. |
| 6. Reach the host | For different networks use [Tailscale Serve](../deploy/tailscale-mobile.md): keep Cairn on loopback, expose private HTTPS, and connect both PCs to the same tailnet. On trusted same-network LAN only, opt in to a non-loopback bind with authentication enabled. | [Remote access](../design/remote-access-switch.md) advertises routes and requires owner access to manage pairing. The npm manifest does not include the embedded sidecar; do not depend on its switch for this acceptance. [Remote reach](../design/remote-reach.md) and the [Connect design](../design/connect-device-protocol.md) do not make a new relay a prerequisite. | Host must remain awake; LAN needs no account, Tailscale may require sign-in and access policy. |
| 7. Pair the office browser | On the customer PC open Settings → Remote access and generate a pairing code. On the office PC open the customer PC's route with `/app`, enter the code, and name the device if asked. | Existing flow issues a short-lived, single-use grant and a browser session. Unpaired browsers must see the gate. The paired browser must not acquire owner authority. Use the Windows runner's non-loopback IP and fresh browser storage in CI. | Seconds once connected; no owner token on the office PC. |
| 8. Run and see a result | Run a small task locally, then start a distinct task from the office browser using the customer Runner. Watch it finish, then view the same task locally. | Task and Runner paths exist. There is no packaged Windows CI result establishing that routing, execution and browser observation work together. A screenshot without the task result and matching Runner is not a pass. | Model/task-dependent; fake ACP is deterministic. |

No registry publish, Mac changes, relay deployment or remote data migration is required. The acceptance artifact must bind the executed Windows job to its checkout SHA and distinguish simulated browser/agent results from the real two-PC test.

## Two-PC checklist

Use artifacts from the **Windows packaged acceptance** run for the candidate SHA. The `windows-test-tarballs-<attempt>` artifact contains checkout packages; `windows-packaged-acceptance-<attempt>` contains that attempt's SHA, logs and any available screenshots. A red run is suitable for reproducing its known blocker, not for signing off. The current published versions (`cairn@0.1.2`, `cairn-cli@0.2.3`) are not substitutes for the checkout tarballs.

1. **Customer PC: prerequisites.** In PowerShell 7, check `node --version`, `npm.cmd --version` and `git --version`. Use Node 22 LTS for parity with CI. Install [Claude Code for Windows](https://code.claude.com/docs/en/setup) with `winget install Anthropic.ClaudeCode` if needed. Open a new PowerShell and run `claude --version`. If a command fails, record that command, the version (if printed), and the error before continuing.
2. **Customer PC: extract and install.** Extract the two checkout archives from the same Actions run into `$HOME\Downloads\cairn-windows`. Open a server terminal. The packages both provide a `cairn` command, so install to separate directories:

   ```powershell
   $packs = Join-Path $HOME 'Downloads\cairn-windows'
   $run = Join-Path $env:LOCALAPPDATA ('cairn-accept-' + [guid]::NewGuid())
   New-Item -ItemType Directory -Path "$run\server", "$run\runner"
   $server = @(Get-ChildItem "$packs\xiechimon-cairn-*.tgz" | Where-Object Name -Match '^xiechimon-cairn-\d')
   $runner = @(Get-ChildItem "$packs\xiechimon-cairn-cli-*.tgz")
   if ($server.Count -ne 1 -or $runner.Count -ne 1) { throw 'Expected one server and one Runner archive' }
   npm.cmd install --prefix "$run\server" --ignore-scripts --no-audit --no-fund $server[0].FullName
   if ($LASTEXITCODE) { throw 'Server install failed' }
   npm.cmd install --prefix "$run\runner" --ignore-scripts --no-audit --no-fund $runner[0].FullName
   if ($LASTEXITCODE) { throw 'Runner install failed' }
   $run
   $env:CAIRN_HOME = "$run\state"
   $env:CLAUDE_BIN = (Get-Command claude.exe -ErrorAction Stop).Source
   ```

   Record `$run` (just the directory path) for the second terminal. This isolates all acceptance state from the normal Cairn data directory. Keep it under the customer's own Windows profile.
3. **Customer PC: start and sign in.** For Tailscale, keep the default loopback bind. If both PCs will be on the same trusted private LAN instead, set the following two values **before** starting the server; do not print the generated value or open access on a public firewall profile:

   ```powershell
   $env:HOST = '0.0.0.0'
   $env:CAIRN_TOKEN = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

   Then start the server:

   ```powershell
   node.exe "$run\server\node_modules\@xiechimon\cairn\dist\index.mjs"
   ```

   Leave it running. In Edge on this PC, open `http://127.0.0.1:8787/app`. The success criterion is a local owner session with Settings → Model services and pairing management available, without entering an owner token. **A fresh browser that only displays “Pair this computer” here is the current owner sign-in blocker. Stop and record it; do not substitute a bearer token or disable auth.** Capture the browser screen and the startup error (if any), with credentials excluded.
4. **Customer PC: approve the local Runner.** In another PowerShell, set `$run` to the exact directory printed above and run:

   ```powershell
   $env:CAIRN_HOME = "$run\state"
   $env:CAIRN_CLAUDE_BIN = (Get-Command claude.exe -ErrorAction Stop).Source
   node.exe "$run\runner\node_modules\@xiechimon\cairn-cli\dist\cli.mjs" start --foreground --server http://127.0.0.1:8787
   ```

   Open the printed authorization link in the local owner browser. Click **Authorize**, then go to **Settings → Runners**. Check that the customer machine is **Online** and Claude Code is detected. On failure, send the authorizer or Runner status screenshot and redacted terminal error. Do not send the authorization URL or its code.
5. **Customer PC: connect the real subscription.** In a separate PowerShell, run `claude setup-token`. Paste that Claude subscription token only into **Settings → Model services → Add connection → Claude (Subscription)**, save, click **Verify**, and check the success status. In the confirmation screen or **Settings → Rules & policies**, select a supported Claude Code model for **Tasks**. Check the **Coordinator** selection as well before using its composer. If there is an error, send its displayed text and `claude --version`, never the token or a screenshot of its entry field.
6. **Connect the browsers to the same host.** On LAN, run `ipconfig` on the customer PC, take its private IPv4 address, and use `http://<customer-ip>:8787/app` on the office PC. Allow the server port only on the permitted private network. Across networks, install Tailscale on both PCs, sign both into the same tailnet, enable MagicDNS and HTTPS certificates, then on the customer PC run `tailscale status`, `tailscale serve --bg http://127.0.0.1:8787`, and `tailscale serve status`. Keep the customer PC awake. Use the printed `https://<customer>.<tailnet>.ts.net/app` address on the office PC. Do not use Funnel or replace an existing unrelated Serve mapping. A fresh office window must show the pairing gate, not owner access. On reachability failure, capture the browser error and run `Test-NetConnection <customer-host> -Port 443` for Tailnet or `-Port 8787` for LAN. Redact private hostnames and addresses before sharing outside the acceptance channel.
7. **Pair the office PC.** In the customer PC owner browser go to **Settings → Remote access → Pair new device**. Select the address the office PC can actually reach, then click **Copy link** and use it privately in the office browser before it expires. Alternatively enter the one-time code from that link's `pair` fragment in the office browser's **Pair this computer** dialog. The gate should close and the new device should be listed in the customer PC's Remote access settings. If the owner button is disabled, record whether the page advertised the LAN or Tailscale address. If the office gate does not close, record the displayed error without the code, URL fragment or QR.
8. **Run two distinct tasks.** On the customer PC create a scratch Git project, then use **New project → Select repo → Local folder → Create project** and choose that path. Do not use a working copy that matters.

   ```powershell
   $repo = Join-Path $run 'accept-repo'
   git init $repo
   '# Windows acceptance' | Set-Content "$repo\README.md"
   git -C $repo add -- README.md
   git -C $repo -c user.name='Cairn acceptance' -c user.email='acceptance@example.invalid' commit -m 'Initialize acceptance repo'
   ```

   Open this project in the customer browser and ask the Coordinator: `Start a task named Windows local acceptance. Read README.md and report its first line. Do not edit, push, or merge.` Open **Tasks**, then open the task and confirm it runs on the customer machine with Claude Code and finishes with `# Windows acceptance`. In the office browser open the same project and repeat with the distinct title `Windows office acceptance`. Watch it run and finish from the office browser, then open that same task in the local browser and confirm the task ID, Runner and result match. On failure, send the task detail screen including its status, selected Runner, result/error and redacted task log. If a deliberate manual approval is requested, record the prompt; do not force completion from the terminal.

Record the tested SHA, both Windows versions, Node/Git/Claude versions, transport (LAN or Tailscale), timestamps, and the first failing step if any. Crop or redact browser authorization links, QR codes, device/session codes, subscription values and private repo material before sending evidence. No office installation or data import is part of this test.

## Registry release after sign-off only

The proposed next unpublished versions are server `0.1.3` and Runner `0.2.4`. Neither version is bumped or published by this work. After both packages have been versioned, packed and accepted from a green SHA, the owner can run these commands from the authorized npm publishing environment that supports provenance:

```powershell
npm.cmd publish .\xiechimon-cairn-0.1.3.tgz --ignore-scripts --access public --provenance
npm.cmd publish .\xiechimon-cairn-cli-0.2.4.tgz --ignore-scripts --access public --provenance
```
