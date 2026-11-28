# Doubao CLI as a Cairn runtime (2026-11-27)

Question: the owner asked to schedule Doubao CLI and connect Doubao CLI subscription. What is the official Doubao coding CLI today, how does a user sign in with a subscription, can another program drive it, and what would a `doubao` runtime touch in Cairn?

Tag convention: **verified** = read first-hand in the named URL or file this session; **derived** = derived from verified facts, recheckable; **guess** = the rest. Nothing was installed or executed: the npm package and the macOS arm64 native archive were downloaded into `/tmp` and read statically (the repo forbids running postinstall scripts without authorization, and the npm package's `postinstall` downloads and unpacks the native binary).

Sources:

- npm registry `https://registry.npmjs.org/@bytedance%2Fdoubao-cli` (README, `package.json`, `artifacts.json`), latest `2.38.4`, fetched 2026-11-27. (verified)
- Native archive `https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao_cli/2.38.4/doubao-cli-2.38.4-darwin-arm64-signed-signed.tar.gz`, SHA-256 matched `artifacts.json`; read `README.md`, `manifest.json`, `resources/js_app/cli-help.txt`, `resources/js_app/entry-cli-router/main.js`, `strings` of `doubao`. (verified)
- Quick start `https://www.doubao.com/work/docs/zh-cn/articles/218099810377-cli-quick-start` (updated 2026-11-26) and agent install guide `https://www.doubao.com/work/docs/zh-cn/articles/247733152152-install-cli-agent` (updated 2026-11-09), read through `r.jina.ai`. (verified)
- Volcengine Ark Coding Plan overview `https://docs.volcengine.com/docs/82379/1925114` and Claude Code setup `https://docs.volcengine.com/docs/82379/1928262`, read through `r.jina.ai`. (verified)
- Doubao app membership prices: 36Kr `https://www.36kr.com/p/3797229255843078`. (verified as press report, not an official price page)
- Coding Plan price tiers: third-party `https://codepick.dev/en/guides/ark-coding-plan-guide/`. (guess-grade; official price page not opened)
- Cairn: `main` at `c6ff36868`. (verified)

## 0. Conclusions

1. **Doubao CLI is a real, official ByteDance product: npm `@bytedance/doubao-cli`, binary `doubao`, version 2.38.4 (published 2026-11-26), first published 2026-10-30.** It is the terminal/automation front of the Doubao Work (`豆包工作`) agent product, not a thin chat client: it edits files, runs commands, has a sandbox (`sbox/`), MCP helper and a shared background service. (verified)
2. **Login is a Doubao consumer account, by QR code scanned in the Doubao or Feishu mobile app — not browser OAuth and not an API key.** `doubao login [--qr=small|full|png]`, `doubao auth status --verify`, `doubao logout`. The session is stored as Chromium-style encrypted cookies (`protected_cookie_store`, `os_crypt` with the macOS Keychain). It is not a portable token Cairn could copy to another computer the way it copies the Devin key. (verified for the commands; derived for storage)
3. **It is drivable by another program: `doubao acp serve` (alias `--acp`) speaks ACP v1 JSON-RPC over stdio** with `loadSession`, `session/list|load|resume|close|delete`, `session/set_model|set_mode|set_config_option`, `session/request_permission`, `session/cancel`. There is also `doubao -p <prompt> --output-format stream-json` whose lines are Claude-style `{"type":"stream_event",…,"event":{"type":"content_block_delta",…}}`. So it fits Cairn's existing generic ACP backend (the one Devin and Antigravity use). (verified)
4. **Recommendation: build `doubao` as a fourth ACP runtime modelled on Antigravity's host-login mode** — the subscription row binds one Runner, and only that Runner (where the user scanned the QR) runs Doubao steps. Do not try to harvest and ship the cookie session. Separately, and cheaply, **Volcengine Ark "Coding Plan" already works today through Cairn's existing Anthropic-compatible provider path** (`https://ark.cn-beijing.volces.com/api/coding` + Ark API key), and Ark lists "Pi" — the runtime Cairn uses — among supported tools. That is a different subscription (Volcengine developer account), not the Doubao app membership. (derived)
5. **Biggest unknowns, each needing a live check on the Mac mini before a plan is written:** whether `doubao acp serve` still finds its login when Cairn sets `HOME` to `~/.cairn/homes/doubao` and runs it under Seatbelt (Keychain reads, `~/Library/Application Support/doubao_cli`); whether two concurrent ACP sessions on one account are allowed (the bundle README says "Exit other CLI processes using the same account first" and has `cli_instance_lock`); whether a non-mainland account can sign in; and what membership tier `-p`/ACP consumes. (guess)

## 1. What the product is

| Fact | Value | Tag |
|---|---|---|
| Name | Doubao CLI, part of Doubao Work | verified |
| Package | `@bytedance/doubao-cli` on the public npm registry, licence "SEE LICENSE IN LICENSE" (proprietary), no repo link | verified |
| Binary | `doubao` (`scripts/run.cjs` → native `…/doubao_cli/app/current/doubao`) | verified |
| Install | `npm install -g @bytedance/doubao-cli --registry=https://registry.npmjs.org/`; `postinstall` downloads a signed native archive from `lf-flow-web-cdn.doubao.com` and checks SHA-256 | verified |
| Version | 2.38.4 latest, 7 versions since 2026-10-30; bundled JS app `1.0.0.180` | verified |
| Platforms | Windows x64, macOS ARM64, Linux x64 only (no Intel Mac, no Linux arm64); Node ≥ 18 for the npm wrapper | verified |
| Install location | macOS `~/Library/Application Support/doubao_cli/app`, Linux `$XDG_DATA_HOME` or `~/.local/share/doubao_cli/app`, Windows `%LOCALAPPDATA%\doubao_cli\app` | verified (`scripts/runtime.cjs`) |
| Native size | ~55 MB archive, ~154 MB unpacked; Chromium/V8-based ("aha" runtime) | verified |
| Update | `doubao update`, SHA-256-checked, refuses to run while an instance is live | verified |
| Background service | `--service-start/stop/status`; "The shared service is managed automatically" | verified |

Not the same thing: `@doubao-dev/cli` (`dbx`) is the Doubao app-plugin developer tool; the open-source `trae-agent` (`trae-cli`) is a separate research agent; Ark CLI (`@volcengine/ark-cli`, `arkcli`) only configures other tools for the Ark Coding Plan. (verified for dbx and arkcli from their docs; trae-agent from search results only — guess)

## 2. Login and credentials

| Item | Finding | Tag |
|---|---|---|
| Method | `doubao login` prints a QR code; scan with the Doubao or Feishu mobile app and approve. `--qr=png` writes a temporary PNG path as `QR_IMAGE=<path>` for agents to show | verified |
| Check | `doubao auth status --verify` — exit code + status, revalidates the saved session online | verified |
| Logout | `doubao logout` also stops running tasks of that account | verified |
| API key mode | none in the CLI | verified (help text has no key option) |
| Identity hosts | `accounts.doubao.com`, `accounts.feishu.cn`, `feishu.doubao.com` | verified (bundle strings) |
| Storage | encrypted cookie store (`aha/doubao_cli/auth/protected_cookie_store.cc`) using Chromium `os_crypt` + macOS Keychain (`keychain_password_mac.mm`, "[SessionStorage] Keychain lookup failed") plus a device identity (`pc_device_identity.cc`) | derived (strings, not run) |
| Portability | session is device-bound encrypted cookies, not a bearer token file | derived |
| Region | QR login through the Doubao/Feishu apps implies a mainland Doubao account; whether overseas phone numbers or networks work is not documented | guess |

## 3. Programmatic modes

From `resources/js_app/cli-help.txt` (verified):

- `doubao -p "<prompt>"` one-shot; `-p -` reads the prompt from stdin (UTF-8, ≤ 1 MiB).
- `--output-format text|json|stream-json` (`--json` = `json`), valid only with `-p`, `--list`, `model list`.
- `-C <dir>` working directory; `--model <id>`, `--effort none|minimal|low|medium|high|xhigh|max`.
- `--permission-mode ask_always|ask_risky|always_allow`; `--dangerously-bypass-approvals-and-sandbox`.
- `-c/--continue`, `--resume <id> -p …`, `--list [--json]`, `--export <id>`, `model list --json`.
- `doubao acp serve [--model <m>] [--effort <e>]` / `--acp`: ACP v1 over stdio; defaults to per-call approval for side-effecting tools; restart the ACP connection after login/logout.

From `entry-cli-router/main.js` (verified): `initialize` requires `protocolVersion >= 1` and a non-empty `clientInfo.name`; response advertises `agentInfo {name:"doubao"}`, `loadSession: true`, `sessionCapabilities.list`, MCP capabilities; handlers exist for `authenticate`, `session/new|prompt|cancel|load|resume|list|close|delete|set_mode|set_model|set_config_option` and it sends `session/request_permission` and `session/update`. The `stream-json` writer emits Claude-shaped `stream_event` / `content_block_delta` / `text_delta` lines with `session_id` and `message_id`.

Not yet known: whether ACP `session/update` carries token usage, whether `authenticate` can trigger the QR flow (Devin's desktop login drives `authenticate`), the model ids `model list` returns. (guess — needs a live run)

## 4. Subscriptions and quota

Two different ByteDance subscriptions are in play:

| | Doubao app membership (what `doubao` CLI uses) | Volcengine Ark Coding Plan |
|---|---|---|
| Account | Doubao consumer account (QR via Doubao/Feishu app) | Volcengine (cn-beijing) or BytePlus (international) developer account |
| Credential | device-bound session | Ark API key |
| Price | free basic tier; Standard CNY 68/mo, Enhanced CNY 200/mo, Pro CNY 500/mo with 5x/20x/50x quota (press report, 36Kr) | Lite / Pro tiers; price not read from the official page this session |
| Quota rule | not documented for the CLI | 5-hour window from first request, weekly (Monday 00:00) and monthly windows; exhausted quota waits, never bills balance |
| Models | not documented; `doubao model list` | `ark-code-latest` (console-selected Auto), `doubao-seed-evolving`, `doubao-seed-2.1-pro/lite`, `doubao-seed-2.0-mini`, GLM 5.x, DeepSeek v4.x, Kimi k2.8/k3.1 |
| Use rule | — | quota only in listed coding tools (Claude Code, Codex CLI, Pi, OpenCode, Cline, Cursor, TraeCode, ...); using the coding Base URL elsewhere risks abuse/policy enforcement (`有可能被识别为滥用/违规`) |

Tags: Doubao membership row — press report (verified as reported, not official); Ark row — verified on the Ark docs except price.

## 5. Compatible endpoints existing CLIs can use

| Protocol | Base URL | Tag |
|---|---|---|
| Anthropic-compatible (Claude Code, Pi with `anthropic-messages`) | `https://ark.cn-beijing.volces.com/api/coding` | verified |
| OpenAI-compatible | `https://ark.cn-beijing.volces.com/api/coding/v3` | verified |
| International (BytePlus ModelArk) | `https://ark.ap-southeast.bytepluses.com/api/coding` | derived (search snippet of BytePlus docs) |
| Do not use | `https://ark.cn-beijing.volces.com/api/v3` — bills pay-as-you-go, not the plan | verified |

Claude Code config per Ark: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=<Ark key>`, `ANTHROPIC_MODEL` (+ the Haiku/Sonnet/Opus/subagent model vars) in `~/.claude/settings.json`. (verified)

The Doubao app membership exposes no such endpoint; it is reachable only through `doubao`. (derived — no endpoint in docs or help)

## 6. Options

| Option | User sees | Pros | Cons |
|---|---|---|---|
| A. `doubao` ACP runtime, host login bound to one Runner (Antigravity host-keyring pattern) | Add Doubao subscription -> QR shown in Cairn (`--qr=png`) -> scan on phone -> that computer runs Doubao steps | uses the Doubao membership the owner asked for; ACP already supported; no token leaves the computer | one Runner per subscription; closed-source binary under Seatbelt + HOME isolation unproven; concurrency per account unknown; no Intel Mac |
| B. Harvest the session and ship it per step (Devin pattern) | same, but any Runner works | multi-Runner | cookies are Keychain-encrypted and device-bound; likely breaks and may trip ByteDance risk control (`MetaSecML`, `bdms`) |
| C. `-p --output-format stream-json` instead of ACP | — | simpler | no steering, no permission round-trips; ACP strictly better here |
| D. Ark Coding Plan as a provider preset (Anthropic-compatible) | Volcengine Ark Coding Plan provider with an API key field | works on the current pi runtime and Claude Code paths with a preset row; Pi is on Ark's supported list | different product and account than the Doubao app; API-key UX, not a login |

Recommendation: A for Doubao CLI subscription, optionally D as a small separate preset. Before the plan, run a live spike on the Mac mini (install with scripts enabled — needs the owner's authorization for the postinstall — scan once, then: `doubao acp serve` under Cairn's runtime HOME and confine profile; two parallel sessions; usage fields in `session/update`; `model list --json`; `authenticate` behaviour). (derived)

## 7. Cairn code areas a `doubao` runtime touches

The closest existing patterns are Devin (ACP + managed binary) and Antigravity host-login mode (`docs/design/antigravity-subscription-source.md`, `docs/design/subscription-only-sources.md`). (verified by reading those files)

Shared ids and wire:
- `packages/shared/src/agent-backend.ts` (`BACKEND_RUNTIME_IDS`)
- `packages/shared/src/brief-file.ts` (`BRIEF_BACKEND_IDS`)
- `packages/shared/src/records/machine.ts` (`MACHINE_RUNTIMES`, heartbeat capability block like `capabilities.antigravity`)
- `packages/shared/src/records/model-source.ts`, `records/routing-rule.ts`, `records/step.ts` (`harness` enum), `capability-routing.ts`, `model-routing.ts`
- new `packages/shared/src/doubao-subscription.ts` / `doubao-local.ts` (mirrors `antigravity-subscription.ts`, `devin-local.ts`)
- `scripts/product-surface-registry.json` for any new `CAIRN_*` var or settings key

Daemon:
- `apps/daemon/src/backend/runtime-channels.ts` — a managed channel that fetches `@bytedance/doubao-cli` `artifacts.json` (or the npm tarball) and verifies SHA-256, like `createDevinManaged`
- `apps/daemon/src/machine-loop.ts` — `createAcpBackend({ harness: 'doubao', … })`, capability probe, model catalog
- `apps/daemon/src/backend/acp.ts` — per-harness branches (`harness === 'devin' | 'antigravity'`), permissions/modes mapping to `ask_always|ask_risky|always_allow`
- new `apps/daemon/src/backend/doubao-acp.ts` update normalizer (like `devin-acp.ts`)
- `apps/daemon/src/runtime-homes.ts` (`RuntimeId`), `step-env.ts` (HOME handling), `step-preflight.ts` (missing-subscription message), `credentials.ts`, `backend/confine.ts` (Keychain and `Application Support/doubao_cli` read access), `agent-config.ts`, `self-update.ts`
- `apps/daemon/test/runtime-stubs.ts`, `test/machine-loop-harness.ts`

Server:
- `apps/server/src/db/schema.ts` + a drizzle migration for `doubao_subscription` (with `runnerId` binding, as in `0251_antigravity_runner_binding.sql`)
- new `apps/server/src/services/doubao-subscriptions.ts`, `doubao-subscription-verification.ts`, `machine-doubao-verify.ts`
- `services/dispatch-eligibility.ts`, `machine-claim.ts`, `machine-routing.ts`, `step-route.ts`, `step-queue.ts`, `routing-rules.ts`, `model-routing.ts`, `model-catalog.ts`, `model-fallback.ts`, `subscription-usage.ts`, `runner-offline.ts`, `machine-step-token.ts`, `chief.ts`/`chief-tools.ts`/`coordinator-*.ts` (runtime lists), `backup-service.ts`, `routes-resources.ts`, `routes-machine.ts`

Desktop:
- new `apps/desktop/src/doubao-auth.ts` (spawn `doubao login --qr=png`, relay the PNG, poll `auth status --verify`), `local-credential-actions.ts`, `main.ts`, `preload.ts`, `electron-builder.yml`/`build.mjs` if anything is bundled

Web (run `node scripts/design-rules-for.mjs` first):
- `apps/web/src/resources/` (new `doubao-subscriptions.tsx`, `add-provider-flow.tsx`, `create-provider-dialog.tsx`, `providers-page.tsx`, `subscription-detail.tsx`, `model-routing-page.tsx`, `upstream-model-groups.ts`)
- `apps/web/src/api/` (new `doubao-subscriptions.ts`, `mappers.ts`, `model-routing.ts`), `board/` login banner, `components/brand-marks.tsx`, `components/model-identity.tsx`, `icons/lobehub-mono.ts`, `tray/tray-groups.ts`, `i18n/en.ts`, `fixtures/accounts.ts`
- `.claude/skills/verify-cairn/feature-map.json` via `node scripts/generate-feature-map.mjs`

For option D only: a provider preset in the server's provider catalog (`apps/server/src/services/providers.ts` and the web add-provider flow) with `api: 'anthropic-messages'` and base URL `https://ark.cn-beijing.volces.com/api/coding`; pi has no built-in Volcengine provider in `@earendil-works` 1.5.0. (derived — grep of the installed packages found no `volces`)

Plan gate: this is a new runtime with persisted state and a protocol, so it needs a `docs/design/doubao-runtime.md` plan with independent review before code.

## 8. Live spike on MacBook (2026-11-28)

Measured directly against the owner's logged-in MacBook install (`@bytedance/doubao-cli` `2.38.4`, native binary `~/Library/Application Support/doubao_cli/app/current/doubao`). Never logged or stored cookies/tokens/IDs.

1. **Isolated `HOME`, Keychain access, and portability (`verified`)**:
   - The npm wrapper `~/.local/bin/doubao` (`scripts/run.cjs`) resolves `appRoot()` from `os.homedir()` (`$HOME`) and exits 1 (`ENOENT`) when `HOME` points to an isolated directory.
   - Running the native `doubao` binary with an overridden/isolated `HOME` triggers a macOS GUI modal (`Keychain Not Found … bundleSeedID / Reset To Defaults`) because `session_storage_mac.mm` / `os_crypt` looks up `~/Library/Keychains/login.keychain-db` via `HOME`.
   - Conclusion: Cairn **must preserve real `HOME` and Keychain access** when running `doubao` (same pattern as `claude-code` and `gemini`), setting `DOUBAO_CLI_NO_UPDATE_CHECK=1`, and resolve the native binary directly when present.
   - Static inspection of the native binary (`strings` / `entry-cli-router/main.js`) and `doubao-cli-pc-login` confirms Doubao login is **non-portable across machines**: `doubao-cli-pc-login/{device,account,<uid>/session}` are encrypted binary stores sealed via `os_crypt` Keychain (`session_storage_mac.mm`), hardware-bound device identity (`pc_device_identity.cc` / `IOPlatformUUID`), and `libMetaSecML.dylib` (`bdms.cc`), with `OAuth requires encrypted credential storage`, zero env-var login (`DOUBAO_TOKEN` etc.), and zero token-export CLI flags. Credential profiles (import once, run anywhere) are therefore infeasible; Doubao login is strictly valid on the computer where QR login was completed (`豆包登录只在扫码的那台电脑有效`).
2. **Concurrent sessions on one account (`verified`)**:
   - Running two `doubao acp serve` processes simultaneously on the same logged-in account (using models `"5"` and `"4"`) both completed `session/prompt` in parallel (`stopReason: "end_turn"`, `5.3s` and `10.0s`) without lock errors. No per-account serialization mutex is needed.
3. **ACP usage and quota reporting (`verified`)**:
   - `session/prompt` returns `{"stopReason":"end_turn"}` with no `usage` object.
   - `session/update` emits `available_commands_update`, `agent_message_chunk`, `tool_call`, `tool_call_update`, etc., and emits no `usage_update`.
   - `entry-cli-router/main.js` has no `/usage` command and no quota/rate-limit API endpoint. Cairn will display `近 24 小时 · N 次运行` and `豆包 不提供剩余用量` (same as Devin).
4. **ACP protocol, models, modes, resume, and auth errors (`verified`)**:
   - `initialize` returns `protocolVersion: 1`, `agentInfo: { name: "doubao", version: "2.38.4" }`, `agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, promptCapabilities: {}, mcpCapabilities: {} }`.
   - `session/new` returns `modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }, { id: "bypass_permissions" }] }`, `configOptions` (`category: "model"`, `id: "model"` with 17 models; `category: "thought_level"`, `id: "effort"` with per-model subset of `low|medium|high|xhigh|max`), and `models.availableModels`.
   - `session/set_config_option` (`configId: "model"`) switches models and updates available `effort` levels.
   - `session/set_mode` (`bypass_permissions`) executes tool calls (`read` on `hello.txt`) with zero permission prompts; `session/load` resumes an existing `sessionId` across a fresh `doubao acp serve` process and returns `{ modes, configOptions, models, _meta }`.
   - `doubao model list --json` prints `[cli-chat]` log lines around one JSON line `{"type":"result","subtype":"success","result":{"type":"model_list","models":[...]}}` (~0.46s) containing all models and per-model `efforts` / `default_effort`.
   - Auth failure in ACP emits JSON-RPC `-32000` (`Authentication required: Run doubao login in a terminal and reconnect.`) and login-expired strings (`登录已失效，请运行 doubao login 重新登录。`).
5. **Cairn stdio MCP tools & permission gate (`verified`)**:
   - Even though `initialize` reports `mcpCapabilities: {}`, `session/new` accepts stdio `mcpServers` (launched via `doubao_mcp_helper`, rejecting non-stdio or relative commands). Passing Cairn's real `openAcpTools` stdio server (`cairn_ping`) in `bypass_permissions` mode invoked `executeRemoteTool("cairn_ping", { msg: "hello" })` and returned `"PONG:hello"` with `stopReason: "end_turn"` and 0 permission prompts.
   - Switching to `default` mode and prompting `Run shell command: echo hi` triggered `session/request_permission` (`{"title":"Bash","kind":"execute","rawInput":{"command":"echo hi"}}`), which Cairn rejected with `reject_once`. Doubao names MCP calls `mcp__<server>__<tool>` (`mcp__cairn__<tool>`), which Cairn's `isHostToolCall` already matches during restricted turns.
   - `promptCapabilities` is `{}` (no image capability); Cairn's `imageSupport` records `false` so image attachments degrade cleanly without failing the turn.
6. **ACP client delegation (`fs/*` / `terminal/*`) measurement (`verified`, historical note)**:
   - Advertising `clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }` on `doubao acp serve` (`2.38.4`) and prompting it to read `sample.txt`, append `edited-by-doubao`, and run `echo PROBE_CMD_OK` executed all file reads/writes and shell execution locally inside `doubao` itself (`delegatedMethods: []`, `delegatesFsOrTerminal: false`, `sampleFileAfter: "hello-original\nedited-by-doubao\n"`, `stopReason: "end_turn"`). Transcript archived at `~/Pictures/cairn-review/doubao/acp-delegation.json`.
   - Conclusion: `doubao` executes tools locally rather than delegating `fs/*` or `terminal/*` to a remote ACP client, so each Runner executes its own local tasks using that computer's own login.

## 9. Runner-driven QR login & managed binary inspection (2026-11-28)

Measured directly against the `@bytedance/doubao-cli` `2.38.4` installation and native Mach-O binary (`~/Library/Application Support/doubao_cli/app/current/doubao`), plus read-only checks on the headless `macmini` runner host:

1. **Managed binary feasibility (`verified`)**:
   - `@bytedance/doubao-cli` `2.38.4` ships `artifacts.json` pointing to standalone signed HTTPS archives (`darwin-arm64` ~52 MB `HTTP 200`, `linux-x64`, `win32-x64`) with 64-char SHA-256 checksums and `manifest.json` file checksums.
   - `otool -L` / `otool -l` shows `LC_RPATH: @loader_path` / `@loader_path/.` and relative `resources/js_app` asset loading (`cli-manifest.json`). Extracting the archive under `<cairnHome>/tools/doubao/versions/<version>/` runs completely standalone without `npm install` or npm `postinstall` scripts, while sharing the user's real OS Keychain (`com.bytedance.doubao-cli.session.v1`) and `~/Library/Application Support/doubao_cli` session files when executed with real `HOME`.
2. **`doubao login --qr=png` output & lifecycle (`verified`)**:
   - `doubao login --help`: `用法：doubao login [--qr=small|full|png]` (`--qr=png` prints `QR_IMAGE=<abs-path>` and removes the temp `qrcode.png` on exit).
   - If already logged in, `DOUBAO_CLI_NO_UPDATE_CHECK=1 doubao login --qr=png` immediately prints `登录成功，账号已通过验证` and exits `0` without prompting for a QR scan. Switching accounts requires `doubao logout` first (`需要切换账号时，请先运行 doubao logout，再运行 doubao login`).
   - Binary string table inspection (`login/main.cc`, `qr_login_flow.cc`, `passport_qr_transport.cc`) shows stdout progress lines during unauthenticated login: `QR_IMAGE=<path>`, `请使用豆包移动端扫码并在手机上确认；按 Ctrl+C 可取消`, `已扫描二维码，正在等待手机确认...` (`scanned`), `手机已确认，正在检查账号是否可用…` (`verifying`), `用户已在手机上拒绝本次登录，请扫描下方的新二维码` (refreshed `QR_IMAGE=`), plus failure lines `登录二维码已过期` / `等待扫码确认超时` (`expired`), `用户已在手机上拒绝登录` (`refused`), `该账号需要额外验证` (`unsupported_account`).
3. **Headless Mac mini Keychain & LaunchAgent domain (`verified`)**:
   - `macmini` is `arm64`, where `com.xiechimon.cairn-daemon` runs inside GUI LaunchAgent domain `gui/501` (`asid 100002`, console user `ian` logged in).
   - Binary inspection of `session_storage_mac.mm` shows Keychain calls use `LAContext` + `kSecUseAuthenticationContext`, returning a non-interactive `os_status` error (`Keychain lookup/insertion failed, os_status=`) rather than blocking on a GUI dialog if locked.
4. **Paseo reference & Terms risk note (`verified`)**:
   - `getpaseo/paseo` integrates host ACP tools (`agy acp`) per-machine using each computer's local login (no credential syncing, no Doubao support) and warns that personal OAuth subscriptions are intended for interactive use whereas unattended background runs carry account ToS / compliance risk (`个人订阅用于无人值守任务的条款风险`).
