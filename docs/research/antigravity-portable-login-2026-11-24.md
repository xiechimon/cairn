# Antigravity Portable Login Across Runners (Research & Design)

Date: 2026-11-24
Goal: Allow a Cairn user to sign in to a Google Antigravity subscription once in Cairn and dispatch Antigravity steps to every connected Runner (local Mac, remote macOS Runners with no host Antigravity login, Linux, and Windows) with no per-machine login.

Evidence tags used throughout:
- **Measured**: Verified directly from primary source code, official documentation, installed binaries, or live isolated-HOME execution in this session.
- **Inferred**: Deduced directly from **Measured** facts and re-checkable.
- **Hypothesized**: Unverified hypothesis (explicitly flagged wherever present).

---

## Phase 1: Prior-Art & Primary-Source Research

### 1. What Cairn Actually Runs Today (**Measured**)

Cairn's managed installer (`packages/shared/src/node/antigravity-install.ts`) does **not** run the Go `agy` CLI (`v1.5.16`). It downloads the official Google ACP Registry package `antigravity-acp` (`v1.5.2`) from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` (`dl.google.com/agy-extensions/releases/...`), which ships two Mach-O/ELF/PE executables:
- `agy_acp_server.par` (macOS/Linux) / `agy_acp_server.exe` (Windows) — a self-contained Python PAR archive (`google3/cloud/developer_experience/antigravity_extensions/acp_server/*.py`).
- `localharness_external` — the Go/C++ agent harness launched by `agy_acp_server.par`.

ACP Registry distribution (`~/.cairn/tools/antigravity/registry-cache.json`, **Measured**):
- `darwin-aarch64`, `darwin-x86_64`: `./agy_acp_server.par`
- `linux-x86_64`, `linux-aarch64`: `./agy_acp_server.par --uid=`
- `windows-x86_64`, `windows-aarch64`: `./agy_acp_server.exe`

Today Cairn supports only two Antigravity subscription modes (`apps/server/src/services/antigravity-subscriptions.ts:activeAntigravitySubscriptionMode`):
- `host` (`tokenCipher === null`): relies on each Runner's own host login (macOS Keychain or `~/.gemini/antigravity-acp/acp_token.json`). Runners without a host login report `capabilities.antigravity.authenticated: false` and are rejected at dispatch (`apps/server/src/services/machine-routing.ts:55-58`).
- `token` (`tokenCipher !== null`): stores a Google AI Studio `GEMINI_API_KEY`, delivered per step via `MachineTokenResponse.antigravityToken` and injected as `env.GEMINI_API_KEY` with `settings.json` `{"auth": {"type": "gemini-api-key"}}` (`apps/daemon/src/step-env.ts`, `apps/daemon/src/agent-config.ts`).

---

### 2. How Each Runtime Stores and Accepts OAuth Credentials (macOS / Linux / Windows)

#### A. Antigravity ACP Server (`agy_acp_server.par` v1.5.2 — Cairn's managed binary) (**Measured**)

Source verified directly inside `~/.cairn/tools/antigravity/versions/1.5.2/agy_acp_server.par`:

1. **Custom home directory (`GEMINI_HOME`)** (`acp_server/paths.py:43,75-190`):
   - `GEMINI_HOME` overrides `~/.gemini` directly (it names the `.gemini` directory itself).
   - Every ACP file resolves lazily from `$GEMINI_HOME/antigravity-acp/`:
     - `settings.json` — `{"auth": {"type": "oauth-personal"}}` (also supports `"oauth-business"`, `"gemini-api-key"`, `"agent-platform"`, `"gateway"`).
     - `acp_token.json` — consumer personal Google Account OAuth blob.
     - `acp_business_token.json` — Gemini Enterprise OAuth blob.
     - `conversations/<session_id>.db` and `<session_id>.meta` — session resume trajectories (`acp_server/session_store.py:49-61`).
     - `brain/` — per-conversation harness artifacts (`acp_server/paths.py:228-238`).

2. **Cross-platform storage & keychain-less override (`AGY_ACP_FORCE_FILE_STORAGE`)** (`acp_server/oauth/credential_store.py:11-18,39-43,206-273`, `oauth/macos_keychain.py`):
   - **Env flag `AGY_ACP_FORCE_FILE_STORAGE=1` (also `"true"` / `"yes"`)**: forces `FileCredentialStore` (`$GEMINI_HOME/antigravity-acp/acp_token.json`, mode `0600` under a `0700` dir, atomic write via `tempfile.NamedTemporaryFile` + `os.replace`) **even on macOS**, completely bypassing macOS Keychain.
   - **Linux and Windows (`sys.platform != "darwin"`)**: `create_default_store` **always** uses `FileCredentialStore` (`acp_token.json`), never an OS keychain (`credential_store.py:12-14,240-241`).
   - **macOS (when `AGY_ACP_FORCE_FILE_STORAGE` is unset)**: probes `/usr/bin/security default-keychain` and runs a 3-second set/get/delete probe via `ctypes` over `Security.framework` using `service="gemini"`, `account="antigravity-acp"` (consumer) or `"antigravity-acp-business"` (business). Falls back to `FileCredentialStore` if no default keychain exists or the probe fails.
   - Verified on a logged-in macOS host's Keychain metadata (without reading secrets): `service="gemini"` has both `account="antigravity"` (for `agy` CLI) and `account="antigravity-acp"` (for `agy_acp_server.par`), while a secondary macOS Runner without local login has neither (`SecKeychainSearchCopyNext: item not found`).

3. **Token file schema (`acp_token.json`)** (`oauth/credential_manager.py:156-169,472-491`, `ccpa_connection/oauth_manager.py:45-53,215-224`, verified against key schema of `~/.gemini/antigravity-acp/acp_token.json`):
   ```json
   {
     "client_id": "<Google installed-app OAuth client ID>",
     "client_secret": "<Google installed-app OAuth client secret>",
     "refresh_token": "<user OAuth2 refresh token>",
     "token_uri": "https://oauth2.googleapis.com/token",
     "scopes": [
       "https://www.googleapis.com/auth/cloud-platform",
       "https://www.googleapis.com/auth/userinfo.email",
       "https://www.googleapis.com/auth/aicode"
     ],
     "project_id": "<resolved CCPA project ID, e.g. aicode-consumers>"
   }
   ```
   - Machine-independent JSON (no hostname/username key derivation, no OS keychain wrapping).
   - No per-process env var exists for injecting an OAuth refresh token directly into `agy_acp_server.par`; it always reads from `CredentialStore` (`acp_token.json` when `AGY_ACP_FORCE_FILE_STORAGE=1`, or macOS Keychain otherwise).

4. **Silent refresh, local proxy, and non-interactive failure mode** (`oauth/credential_manager.py:493-608`, `ccpa_connection/proxy_server.py`, `server.py:3346-3369`):
   - On `session/new`, `OAuthManager.get_access_token()` loads `acp_token.json` via `google.oauth2.credentials.Credentials.from_authorized_user_info(info)` and calls `creds.refresh()` silently against `https://oauth2.googleapis.com/token`.
   - `agy_acp_server.par` then runs `onboard.onboard_user` (`loadCodeAssist`) and starts an internal loopback reverse proxy (`127.0.0.1:<ephemeral>`, gated by a per-process random `X-ACP-Proxy-Token`) for `localharness_external`. `localharness_external` never receives the raw refresh token.
   - **Critical caveat (**Measured** in source)**: if `settings.json` has `auth.type: "oauth-personal"` and `acp_token.json` is missing or its `refresh_token` is revoked (`RefreshError`), `get_access_token()` falls back to `_interactive_login_and_store()`, binds `127.0.0.1:0`, calls `webbrowser.open()`, prints `"Open the following link to authenticate the ACP server: <url>"` to `stderr`, and blocks up to 300 seconds (`_LOGIN_TIMEOUT_SECONDS = 300`). Any headless Runner invoking `agy_acp_server.par` must detect this line on `stderr` (or pre-validate) to fail fast instead of hanging 5 minutes and opening a browser on the Runner.

5. **Isolated-HOME live verification (**Measured**)**:
   - Empty isolated `HOME` + `GEMINI_HOME=<tmp>/.gemini` + `AGY_ACP_FORCE_FILE_STORAGE=1` (no `settings.json`, no `acp_token.json`) on this Mac (which has a real host Keychain login): `initialize` succeeded (`antigravity-acp` `1.5.2`), and `session/new` returned `-32000 Authentication required` without reading host Keychain.
   - Isolated `HOME` + `GEMINI_HOME=<tmp>/.gemini` + `AGY_ACP_FORCE_FILE_STORAGE=1` + `settings.json` (`{"auth":{"type":"oauth-personal"}}`) + copied `acp_token.json` (`0600`): `agy_acp_server.par` logged `AGY_ACP_FORCE_FILE_STORAGE set; using file credential storage.`, silently refreshed the access token (`Access token expired. Refreshing silently...`), verified onboarding (`User is already onboarded with project ID: 'aicode-consumers'`, active subscription tier), started its local proxy, and launched the Agent session — with **zero Keychain access**.

#### B. Antigravity CLI (`agy` v1.5.16 Go binary) (**Measured**)

Verified from official docs ([Authenticate](https://antigravity.google/docs/install), [CLI Reference](https://antigravity.google/docs/cli/reference), [ACP](https://antigravity.google/docs/ide/extensions/acp), [Headless Mode](https://antigravity.google/docs/cli/headless)), `agy --help`, `agy acp --help`, and binary inspection of `~/.local/bin/agy`:
- Uses `zalando/go-keyring` (`authstore.keychainStore`) across macOS Keychain (`service="gemini"`, `account="antigravity"`), Linux Secret Service (D-Bus), and Windows Credential Manager.
- Has an undocumented file fallback (`authstore.fileStore` -> `~/.gemini/jetski-standalone-oauth-token`) and env var `AGY_CLI_FORCE_FILE_TOKEN_STORAGE` (plus `JETSKI_OAUTH_TOKEN` symbol in binary, undocumented).
- Documented non-interactive auth methods: `GEMINI_API_KEY` (only when `~/.gemini/antigravity-cli/settings.json` sets `"modelProvider": "gemini"`), or Enterprise GCP ADC (`AGY_ADC_AUTH=true` + `gcloud auth application-default login`).
- `agy acp --login` runs an interactive SSH/terminal code-paste login flow (`agy acp --help`).
- No documented CLI flag accepts a refresh token. Because Cairn's managed runtime is `agy_acp_server.par` (not the Go `agy` CLI), Cairn does not depend on `agy`'s undocumented flags.

#### C. Gemini CLI (`@google/gemini-cli`) (**Measured**)

Verified directly from `google-gemini/gemini-cli` `main` source:
- **Home override**: `GEMINI_CLI_HOME` replaces `os.homedir()` ([`paths.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/utils/paths.ts)).
- **Default file path (`oauth_creds.json`)**: when `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE` is not `"true"`, OAuth tokens are stored in plaintext JSON (`0600`) at `$GEMINI_CLI_HOME/.gemini/oauth_creds.json` ([`oauth2.ts:112-151,739-765,828-891`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts)).
- **`GOOGLE_APPLICATION_CREDENTIALS` path**: `fetchCachedCredentialsList()` (`oauth2.ts:739-762`) loads `[oauth_creds.json, process.env.GOOGLE_APPLICATION_CREDENTIALS]` in order. If the JSON has a `type` field other than `"authorized_user"` (e.g. `service_account` / `external_account`), it passes it to `GoogleAuth.fromJSON()` (Vertex/ADC). Otherwise it feeds the JSON directly to `OAuth2Client.setCredentials()` and validates via `getAccessToken()` + `getTokenInfo()`.
- **Per-process access token override**: when both `GOOGLE_GENAI_USE_GCA` and `GOOGLE_CLOUD_ACCESS_TOKEN` are set, Gemini CLI uses that short-lived access token directly (`oauth2.ts:157-167`).
- **Keychain / encrypted file mode**: when `GEMINI_FORCE_ENCRYPTED_FILE_STORAGE=true`, [`OAuthCredentialStorage`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth-credential-storage.ts) uses [`HybridTokenStorage`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/mcp/token-storage/hybrid-token-storage.ts) -> [`KeychainService`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/keychainService.ts) (`@github/keytar`, `service="gemini-cli-oauth"`, `account="main-account"`, bypassed via `GEMINI_FORCE_FILE_STORAGE=true` or on WSL/headless Linux) -> [`FileKeychain`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/fileKeychain.ts) (`$GEMINI_CLI_HOME/.gemini/gemini-credentials.json`). Crucially, `FileKeychain` encrypts with AES-256-GCM using `scrypt('gemini-cli-oauth', '${os.hostname()}-${os.userInfo().username}-gemini-cli')`, making `gemini-credentials.json` **machine+user bound and NOT portable** across hosts.
- Note: Gemini CLI's `oauth_creds.json` uses Gemini CLI's OAuth client (`681255809395-...`, scopes `cloud-platform`, `userinfo.email`, `userinfo.profile`), whereas `agy_acp_server.par` uses Antigravity's OAuth client (`1071006060591-...`, adding scope `https://www.googleapis.com/auth/aicode`) and reads `acp_token.json` (`oauth/credential_manager.py`). Their token files are **not interchangeable**.

---

### 3. Terms of Service Analysis: Sharing One Account Across Machines (**Measured**)

Primary sources read in full:
- [Google Antigravity Additional Terms of Service](https://antigravity.google/terms)
- [Google Antigravity FAQ](https://antigravity.google/docs/faq)
- [Google Antigravity ACP Docs](https://antigravity.google/docs/ide/extensions/acp) and [ACP Registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json)
- [Google Terms of Service](https://policies.google.com/terms)
- [Google One Additional Terms of Service](https://one.google.com/terms-of-service)
- [Gemini CLI Terms & Privacy](https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/tos-privacy.md)

Findings (**Measured**):
1. **One individual using their own account across multiple personal machines (e.g., MacBook + Mac mini + Linux workstation)**:
   - Neither Google Universal Terms, Google One Terms, nor Google Antigravity Additional Terms restricts an individual user to a single machine.
   - Antigravity's own [SSH](https://antigravity.google/docs/ssh) and [Remote Control](https://antigravity.google/docs/remote-control) docs assume one personal account connected across multiple host machines sharing one quota pool.
2. **Sharing one personal Google account across multiple *different people*, or automated account rotation**:
   - Prohibited / unsupported. Google One Terms §1: *"You may not sell or transfer AI credits to another user or account."* Antigravity FAQ: *"automating account rotation, is not supported under consumer plans."* Multi-person teams must use **Gemini Enterprise** (`oauth-business` / ADC) or a **Gemini API key**.
3. **Third-party software calling Google's Antigravity/CCPA backend directly with Antigravity OAuth (e.g., OpenClaw-style OAuth proxy)**:
   - **Explicitly prohibited.** Antigravity Terms §6: *"Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts."* Gemini CLI Terms contain an identical prohibition against directly accessing Gemini Code Assist via third-party software using Gemini CLI OAuth.
   - **Impact on Option 3 (Cairn-side login/API proxy)**: Option 3 is **disqualified on ToS grounds** as well as engineering fragility.
4. **Launching Google's official `agy_acp_server.par` over ACP**:
   - Explicitly supported by Google's ACP distribution and docs: Google publishes `antigravity-acp` (`agy_acp_server.par`) on the public ACP Registry, states in [Other editors (ACP)](https://antigravity.google/docs/ide/extensions/acp#other-clients) that *"Any ACP client can launch Antigravity..."*, recognizes third-party ACP apps including `t3-code` inside `acp_server/client_info.py`, and enforces model/entitlement policy server-side (offering Gemini models to all ACP clients while restricting partner models like Claude to designated IDEs).
   - **Residual policy nuance (flagged transparently)**: Antigravity FAQ also states *"Wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans"* (in the context of `agy -p` headless mode). Cairn already launches official `agy_acp_server.par` via ACP today; delivering the user's own `agy_acp_server.par`-issued `acp_token.json` to run official `agy_acp_server.par` on the user's own Runners (with no third-party CCPA API calls and no account rotation) stays strictly inside the official ACP binary boundary, though multi-user teams should still be advised to use Gemini Enterprise or an API key.

---

### 4. Prior-Art & Option Comparison

| Source / Approach | How credentials are stored & delivered | Trade-offs | Link |
|---|---|---|---|
| **Claude Code in Cairn** (**Measured**) | User runs `claude setup-token` once; Cairn seals the OAuth token in SQLite (`secret-box`) and delivers it per step via `/api/machines/steps/:id/token` (`CLAUDE_CODE_OAUTH_TOKEN`, or fd 3 in Orb); cleared in memory at step end. | Zero persistent credential on Runners; instant revocation; concurrent steps isolated; requires CLI env/fd support. | `apps/server/src/services/credentials.ts`, `apps/daemon/src/backend/claude-code.ts` |
| **Codex / xAI OAuth in Cairn** (**Measured**) | Server stores encrypted `{refresh, access, expires}` JSON in `secret-box`; server refreshes access token on demand in `machine-step-token.ts` and delivers only short-lived access token per step. | Runner never sees refresh token; requires provider API to accept a bearer access token directly (not supported by `agy_acp_server.par`). | `apps/server/src/services/codex-device-login.ts`, `apps/server/src/services/machine-step-token.ts` |
| **Gemini CLI** (**Measured**) | Plaintext `$GEMINI_CLI_HOME/.gemini/oauth_creds.json` (`0600`) or `GOOGLE_APPLICATION_CREDENTIALS`; optional Keychain / hostname-bound `FileKeychain` (`GEMINI_FORCE_ENCRYPTED_FILE_STORAGE=true`); optional `GOOGLE_CLOUD_ACCESS_TOKEN` with `GOOGLE_GENAI_USE_GCA=1`. | `oauth_creds.json` is portable, `gemini-credentials.json` is hostname-bound; incompatible OAuth client/scopes with Antigravity (`aicode` scope missing). | [gemini-cli `oauth2.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/oauth2.ts), [`fileKeychain.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/fileKeychain.ts) |
| **Google OAuth2 for Native Apps (RFC 8252)** (**Measured**) | Loopback `127.0.0.1` + PKCE S256; installed-app `client_id`/`client_secret` are non-confidential; refresh tokens are long-lived (up to 100 active per client/user) and non-rotating by default unless revoked. | Same refresh token safely works across concurrent/sequential sessions on user's own devices; revocation immediately yields `400 invalid_grant`. | [Google OAuth2 Native Apps](https://developers.google.com/identity/protocols/oauth2/native-app) |
| **Option 1 (Recommended): Per-step delivery into ephemeral `GEMINI_HOME` + `AGY_ACP_FORCE_FILE_STORAGE=1`** (**Inferred** from **Measured**) | Cairn captures `acp_token.json` once during login (running `agy_acp_server.par` with `AGY_ACP_FORCE_FILE_STORAGE=1` in a temp dir), seals it in `antigravity_subscription.tokenCipher` (`secret-box`), delivers it per step via existing `/api/machines/steps/:id/token`. Runner writes `acp_token.json` (`0600`) + `settings.json` (`oauth-personal`) into a per-step `0700` `GEMINI_HOME` (symlinking persistent `conversations/` and `brain/` from `~/.cairn/homes/antigravity/.gemini/antigravity-acp/` for session resume), launches official `agy_acp_server.par` with `AGY_ACP_FORCE_FILE_STORAGE=1`, and removes the per-step `GEMINI_HOME` on step cleanup. | Matches Claude's security boundary (zero persistent secrets on Runners, instant revocation, safe concurrent steps, no macOS Keychain access needed in Seatbelt); works identically on macOS, Linux, Windows; preserves `session/resume`; stays inside official `agy_acp_server.par`. Minor trade-off: each step refreshes an access token (~200-500 ms once per step) and writes a `0600` file for the step's duration (mitigated by per-step temp dir, Seatbelt, cleanup + redactor). | `agy_acp_server.par` `paths.py`, `oauth/credential_store.py`, `apps/daemon/src/step-env.ts` |
| **Option 2: Write `acp_token.json` into Runner's persistent managed home (`~/.cairn/homes/antigravity/`)** (**Inferred**) | Server syncs `acp_token.json` into `~/.cairn/homes/antigravity/.gemini/antigravity-acp/` on each Runner and keeps it on disk. | Plaintext refresh token persists indefinitely on every Runner disk; offline Runners retain revoked tokens; concurrent steps on different subscriptions/modes (OAuth vs API key) race on shared `settings.json`/`acp_token.json`; requires new push/sync/wipe protocol. | `apps/daemon/src/agent-config.ts` |
| **Option 3: Cairn-side OAuth / CCPA proxy** (**Measured** ToS + source) | Cairn holds refresh token, refreshes access tokens, and proxies model requests to Google's internal CCPA endpoints (`cloudcode-pa.googleapis.com`). | **Disqualified**: directly violates Antigravity Terms §6 (OpenClaw-class third-party OAuth access to backend APIs), and `agy_acp_server.par` has no consumer-OAuth external proxy hook (re-implementing private CCPA protobufs/JSON wrappers is fragile and unsupported). | [Antigravity Terms §6](https://antigravity.google/terms), `agy_acp_server.par` `ccpa_connection/proxy_server.py` |

---

### 5. Recommendation (**Measured** + **Inferred**)

Adopt **Option 1: Per-step delivery of the `agy_acp_server.par` portable OAuth bundle into a per-step ephemeral `GEMINI_HOME` with `AGY_ACP_FORCE_FILE_STORAGE=1`**.

Why it fits Cairn:
1. **Works out-of-the-box on macOS, Linux, and Windows**: `AGY_ACP_FORCE_FILE_STORAGE=1` + `GEMINI_HOME` is an existing first-party mechanism in `agy_acp_server.par` (`paths.py`, `oauth/credential_store.py`). Linux and Windows already default to `acp_token.json`; setting `AGY_ACP_FORCE_FILE_STORAGE=1` makes macOS match them without touching macOS Keychain.
2. **Tighter security than today's `host` mode**:
   - No Runner needs host login or macOS Keychain access; Seatbelt can drop `Library/Keychains` and `allowKeychainServices` for portable OAuth steps.
   - Zero long-lived credentials rest on Runner disks; deleting/disabling a subscription in Cairn takes effect immediately on the next step.
   - Reuses Cairn's existing encrypted `secret-box` storage (`antigravity_subscription.tokenCipher`) and authenticated per-step delivery channel (`GET /api/machines/steps/:id/token`).
3. **Zero protocol break / full compatibility**: Existing `host` (`tokenCipher === null`) and `GEMINI_API_KEY` subscriptions continue working unchanged; portable OAuth is stored as a typed JSON payload inside `tokenCipher` (matching `codex-device-login.ts`'s precedent) and distinguished cleanly from an API key.
4. **Preserves session resume**: Symlinking `conversations/` and `brain/` from the per-step `GEMINI_HOME/antigravity-acp/` into `~/.cairn/homes/antigravity/.gemini/antigravity-acp/` preserves `session/resume` across turns while keeping `acp_token.json` ephemeral and isolated per step.

Code areas touched:
- `packages/shared/src/antigravity-subscription.ts`, `antigravity-local.ts`, `protocol/machine-wire.ts`
- `apps/server/src/services/antigravity-subscriptions.ts`, `antigravity-subscription-verification.ts`, `credentials.ts`, `machine-step-token.ts`, `machine-routing.ts`, `dispatch-eligibility.ts`
- `apps/daemon/src/credentials.ts`, `agent-config.ts`, `step-env.ts`, `runner.ts`, `step-preflight.ts`, `backend/acp.ts`, `backend/confine-session.ts`
- `apps/desktop/src/antigravity-auth.ts`, `main.ts`, `preload.ts`
- `apps/web/src/resources/antigravity-subscriptions.tsx`, `apps/web/src/api/antigravity-subscriptions.ts`


### Update — Full Go `agy` CLI 1.5.16 (`origin/main` `fdbdbc4ac`) Empirical Addendum (Measured)

Commit `fdbdbc4ac` (`daemon(antigravity): install and run full Antigravity CLI via Google release channel`, landed 2026-11-24) replaced the managed Python `agy_acp_server.par` (v1.5.2) with the full Go **Antigravity CLI (`agy` v1.5.16+)** invoked as `agy acp --app-data-dir antigravity-acp`. Re-measuring against `~/.local/bin/agy` (`1.5.16`, Mach-O arm64, 230 MB) establishes an even cleaner portable credential path:

- **Env var to bypass Keychain (Measured)**: `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` forces `google3/third_party/jetski/cortex/utils/authstore.(*fileStore)` instead of `keyring` (`go_keyring` / macOS Keychain). Note: `AGY_ACP_FORCE_FILE_STORAGE`, `GEMINI_HOME`, and `acp_token.json` do **not** exist in Go `agy 1.5.16`.
- **Credential file path (Measured)**: `$HOME/.gemini/antigravity-acp/antigravity-oauth-token` (when invoked with `--app-data-dir antigravity-acp`; interactive CLI writes `$HOME/.gemini/antigravity-cli/antigravity-oauth-token`), mode `0600`.
- **Minimal machine-independent schema (Measured)**: `codeassistclient.StoredToken` JSON:
  `{"token":{"access_token":"","token_type":"Bearer","refresh_token":"<refresh_token>","expiry":"2020-01-01T00:00:00Z"},"auth_method":"consumer"}`.
  No `client_id`, `client_secret`, `access_token`, or `id_token_email` is needed — `agy` uses its compiled-in OAuth client to refresh, so Cairn stores **zero PII** and **zero hardcoded Google OAuth client secrets**.
- **Isolated Keychain-denied sandbox + session resume proof (Measured)**:
  1. Empty isolated `HOME` with `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`: `session/new` fails fast in 4.57 s with `{"code": -32000, "message": "Authentication required"}`.
  2. Isolated `HOME` under macOS `sandbox-exec` explicitly denying `~/Library/Keychains`, `~/.gemini`, and `com.apple.SecurityServer`/`securityd`/`security.agent`, seeded with ONLY the minimal `refresh_token`-only `antigravity-oauth-token`: `session/new` **succeeds**, silently refreshes the access token, and returns live models (`gemini-4-neon`, `gemini-4-carbon`, `gemini-4-argon`).
  3. A second brand-new ephemeral `HOME` with `conversations/`, `brain/`, and `builtin/` symlinked to a shared directory: `session/load` **succeeds** on the Turn 1 `sessionId`.
  4. Bogus/revoked `refresh_token`: `session/new` **fails fast in 4.04 s** with `{"code": -32000, "message": "Authentication required"}` (no 300 s browser hang).

---

## Phase 2: One-Page Design — Portable Antigravity OAuth Login

### Newcomer Experience

Someone who installs Cairn today and wants Antigravity to run tasks on all their computers meets this change in **Settings → Model Routing → Add Antigravity Subscription**. They click **Sign in with Google** once on their desktop Mac (or import an existing local `antigravity-oauth-token` file). Cairn launches the managed Google `agy acp --app-data-dir antigravity-acp` binary in a temporary `0700` `HOME` with `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, opens the browser for Google sign-in, strips `id_token_email` and short-lived `access_token` to keep only `{ refreshToken, authMethod }`, encrypts it inside Cairn's local database (`secret-box`), deletes the temporary directory, and verifies it via an isolated `agy acp` probe.

- **What they must already know**: Only their personal Google Account (Free, Google AI Pro, or Google AI Ultra). No CLI flags, no keychain setup, no per-machine login on secondary Macs, Linux, or Windows Runners.
- **Accounts / payments / keys asked**: One personal Google Account sign-in (or optional `GEMINI_API_KEY` fallback). Single-user multi-machine use only; multi-person teams should use Gemini Enterprise or an API key.
- **Where it is stored**: Encrypted at rest inside Cairn's SQLite database (`antigravity_subscription.tokenCipher`, sealed with `secret-box`, zero PII). On Runners, materialized only inside a per-step `0700` ephemeral `HOME` (`~/.cairn/homes/antigravity-oauth-steps/<uuid>/.gemini/antigravity-acp/antigravity-oauth-token`, mode `0600`) for the duration of a claimed step and deleted immediately on step cleanup.
- **Where they get stuck / see failures**: If sign-in is cancelled or times out, the dialog offers retry or `GEMINI_API_KEY` paste. If Google revokes the token later, `/verify` reports `auth` failure and running steps fail fast (~4 s) with `-32000 Authentication required` mapped to an actionable re-login message.

#### User Scenario Table

| Scenario | What the user sees | What the system does | Wait & Cost |
|---|---|---|---|
| Sign in once on desktop Mac | Clicks **Sign in with Google**, completes browser OAuth, subscription turns green immediately | Spawns `agy acp --app-data-dir antigravity-acp` with temp `HOME` + `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, reads `antigravity-oauth-token`, strips email/access token, deletes temp dir, seals `{ kind: "antigravity-oauth", refreshToken, authMethod }` in `secret-box`, verifies via isolated `agy acp` | ~5–15 s interactive sign-in; $0 extra |
| Dispatch Antigravity step to a secondary macOS Runner (no host login) | Task runs normally on the secondary Runner without logging in there | Server treats non-null `tokenCipher` as portable on any Runner with `antigravity.installed` and `antigravityOAuthProfile`; delivers `antigravityToken` JSON in `GET /api/machine/token/:stepId`; Runner writes ephemeral `HOME` via `createCredentialProfile` (`0600` `antigravity-oauth-token`), sets `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, runs `agy acp`, deletes ephemeral dir on exit | +1–3 s token refresh at step start; uses account quota |
| Follow-up turn (session resume) on same Runner | Conversation continues seamlessly | Ephemeral `.gemini/antigravity-acp/{conversations,brain}` symlink to persistent `~/.cairn/homes/antigravity-oauth/.gemini/antigravity-acp/{conversations,brain}`; `antigravity-oauth-token` and `builtin/` stay ephemeral per step | 0 ms extra |
| Token revoked in Google Account | Step fails fast ("Antigravity login failed..."); verify shows `Sign-in failed` | `agy acp` returns `-32000 Authentication required` in ~4 s; `/verify` maps `-32000` to `reason: 'auth'`; detail page offers in-place re-login (`PATCH` `{ oauth }`) | ~4 s fail-fast |
| Disable / delete subscription in Cairn | Refused with 409 if steps are running; otherwise removed immediately | DB row disabled/deleted; future steps get no token; zero credentials remain on any Runner disk | Instant |

---

### States & Transitions

Each `antigravity_subscription` row has one of three credential kinds derived from `tokenCipher`:

| `authKind` | `tokenCipher` content | Dispatch eligibility on Runner `M` | Runner env & files |
|---|---|---|---|
| `host` (legacy) | `null` | `M.antigravity.installed && M.antigravity.authenticated` | Symlinks host `~/.gemini` token files + macOS Keychain |
| `api-key` | Sealed plain API key (`AIza...`) | `M.antigravity.installed` | `GEMINI_API_KEY=<key>`, `auth.type: "gemini-api-key"`, no Keychain |
| `oauth` (portable, **new**) | Sealed JSON `{ kind: "antigravity-oauth", refreshToken, authMethod }` | `M.antigravity.installed` (no host login required) | Per-step ephemeral `HOME` (`0700`) under `~/.cairn/homes/antigravity-oauth-steps/<uuid>` with `antigravity-oauth-token` (`0600`), `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, symlinks to persistent `conversations`/`brain`, no Keychain |

Lifecycle state transitions for an `oauth` subscription:
`absent` --(desktop login/import or API create `{ label, oauth }`)--> `stored (enabled if none active)` --(isolated `agy acp` verify succeeds)--> `active` --(Google revokes / `-32000`)--> `auth_failed` --(re-login `PATCH` `{ oauth }`)--> `active`; `active` --(disable/delete with 0 claimed steps)--> `disabled / deleted`.

---

### Storage, Wire Delivery, Refresh, Revocation & Runner Visibility

1. **Encrypted storage (`secret-box`)**: Reuses `antigravity_subscription.tokenCipher` (no schema migration). `parseAntigravityStoredCredential()` discriminates strict Zod-validated `{"kind":"antigravity-oauth","refreshToken":...,"authMethod":...}` (`oauth`) from plain API key strings (`api-key`), failing closed on malformed JSON (`{...`). Rejects `label` containing `refreshToken`. API responses return `hasToken: true` and `authKind: 'host' | 'api-key' | 'oauth'`, never returning secret fields.
2. **Delivery channel (existing per-step token endpoint)**:
   - `openAntigravitySubscriptionCredential()` returns `{ kind: 'api-key', apiKey } | { kind: 'oauth', oauth } | undefined`.
   - `GET /api/machine/token/:stepId` (`machine-step-token.ts`) attaches `antigravityOAuth` only when `owned.status === 'claimed'` (same gate as `claudeSubscriptionToken` / `antigravityToken`), on both worker and coordinator (`chief`) steps.
   - Daemon (`credentials.ts`, `runner.ts`) stores `antigravityOAuth` in `StepCredentials`, clears it via `clearCredentials()`, and adds `refreshToken` to `credentialRedactor` so it never appears in logs, journals, or transcripts.
3. **Ephemeral per-step materialization & Seatbelt**:
   - `prepareAntigravityOAuthHome` creates persistent `0700` `~/.cairn/homes/antigravity-oauth/.gemini/antigravity-acp/{conversations,brain}` and ephemeral `0700` `~/.cairn/homes/antigravity-oauth-steps/<uuid>`, symlinks `{conversations,brain}`, writes `antigravity-oauth-token` (`0600`, atomic temp+rename, no symlink traversal) + `settings.json`, sets `HOME=<stepHome>`, `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, and strips inherited `GEMINI_API_KEY` / `AGY_CLI_FORCE_FILE_TOKEN_STORAGE`. Partial setup errors roll back `<stepHome>` immediately.
   - `stepCleanups` removes `<stepHome>` unconditionally when the step finishes, fails, or is stopped, and daemon startup sweeps any leftover `~/.cairn/homes/antigravity-oauth-steps/*` from prior crashes before claiming steps.
   - macOS Seatbelt (`confine-session.ts`, `acp.ts`): when `CAIRN_ANTIGRAVITY_AUTH_MODE !== 'host'`, drops `Library/Keychains`, `allowKeychainServices` (keeping all four Keychain/trustd Mach prefixes denied), and host `ANTIGRAVITY_CREDENTIAL_FILES`, while granting pinned `state` access only to `<stepHome>` and the two leaf directories `<daemonHome>/homes/antigravity-oauth/.gemini/antigravity-acp/{conversations,brain}`. Because Go `crypto/x509` on macOS calls `SecTrustEvaluateWithError` (`com.apple.trustd`) unless `SSL_CERT_FILE` is set — failing token refresh with `tls: failed to verify certificate: x509: OSStatus -26276` (Measured on a secondary macOS Runner) — `acp.ts` defaults `SSL_CERT_FILE=/etc/ssl/cert.pem` for Seatbelt-confined non-host Antigravity sessions whenever `SSL_CERT_FILE` is unset, keeping `com.apple.trustd` and every Keychain service denied.
4. **Refresh & expiry**: `agy acp` refreshes short-lived access tokens (~1 h) automatically inside `<stepHome>/.gemini/antigravity-acp/antigravity-oauth-token` using `refresh_token`. Server `/verify` verifies `oauth` by spawning `agy acp --app-data-dir antigravity-acp` in a `0700` temp dir with `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` and deleting the dir in `finally` (zero hardcoded Google OAuth client secrets in Cairn): `session/new` OK -> `ok: true`; `-32000` / auth error -> `reason: 'auth'`; timeout -> `'timeout'`; `ENOENT` -> `'unavailable'`.
5. **Revocation**: Disabling/deleting in Cairn stops delivery on the next step with zero residual files on Runners. Revoking in Google Account causes `/verify` to return `auth` and running steps to fail fast (~4 s) with `-32000 Authentication required` (and `acp.ts` also guards against any interactive-auth URL fallback on stderr).
6. **What each Runner shows**: Runners keep reporting `capabilities.antigravity.{installed, version, authenticated, source, models}`. Under an active `oauth` subscription (`tokenCipher !== null`), any Runner with `installed: true` is eligible and routable even when `authenticated: false`, and the board signed-out banner is suppressed (`hasToken: true`).

---

### Read/Write Paths, Failure Behavior & Test Matrix

| Path / Failure Case | Expected Behavior | Test |
|---|---|---|
| Create/read/patch/delete `oauth` subscription via REST | Seals JSON in `tokenCipher`; returns `authKind: 'oauth'`, `hasToken: true`; redacts `refreshToken`; rejects invalid format, both `token`+`oauth`, and label containing `refreshToken` | `apps/server/test/antigravity-subscriptions.test.ts` |
| Verify `oauth` subscription (ok, `-32000` auth error, timeout, ENOENT) | Runs isolated `agy acp` with `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`; maps to `{ ok: true }`, `{ ok: false, reason: 'auth' }`, `'timeout'`, `'unavailable'`; deletes temp dir | `apps/server/test/antigravity-subscriptions.test.ts` |
| Dispatch & claim on Runner with `authenticated: false` | `antigravityUsable` true; `claimStep` succeeds on unauthenticated Runner (worker + chief); `stepToken` delivers `antigravityOAuth` (and omits `antigravityToken`); unclaimed step omits both | `apps/server/test/antigravity-claim.test.ts` |
| Daemon `step-preflight` & `step-env` with `antigravityOAuth` | Preflight passes with `hasAntigravityHostAuth: false`; writes `0600` `antigravity-oauth-token` under ephemeral `HOME`; sets `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`; symlinks `conversations`/`brain`; deletes ephemeral dir on cleanup and sweeps crash leftovers on startup; redacts `refreshToken` | `apps/daemon/test/antigravity-acp.test.ts`, `apps/daemon/test/step-env.test.ts` |
| Seatbelt confinement for `antigravity` with `CAIRN_ANTIGRAVITY_AUTH_MODE=oauth-personal` | Denies `Library/Keychains`, `allowKeychainServices: false` (incl. `com.apple.trustd`), omits host credential files, opens only `<stepHome>` and the two pinned leaf dirs `conversations`/`brain` under `<daemonHome>/homes/antigravity-oauth/.gemini/antigravity-acp/`, and supplies `/etc/ssl/cert.pem` via `SSL_CERT_FILE` when unset so Go TLS verifies without `trustd` | `apps/daemon/test/confine-session.test.ts` |
| Desktop `antigravityLogin` & `antigravityImportOAuth` | Spawns `agy acp` with isolated `HOME` + `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`; captures `antigravity-oauth-token`, strips email, deletes temp dir, returns `{ ok: true, oauth }`; fails closed if file missing | `integration/test/antigravity-desktop-auth.test.ts` |
| Live E2E on a secondary macOS Runner (host has no Antigravity login) | Store portable OAuth in Cairn on primary host -> dispatch Antigravity step to secondary macOS Runner -> completes cleanly with zero host login on secondary Runner and zero residual token files | Live verification on secondary macOS Runner |

---

### Unification with `origin/main` (`train-3`, `88c33945c`..`bb12a7008`)

`origin/main` landed a parallel `oauth-personal` path (`createCredentialProfile`, main-process-only `local-credential-actions.ts`, `oauth-personal:v2:` with Google `sub` binding, `antigravityOAuthProfile` capability, `CAIRN_ANTIGRAVITY_AUTH_MODE`, and serialized `antigravityToken` delivery) that only stored 1-hour access tokens and did not set `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1`, Seatbelt `SSL_CERT_FILE`, or persistent `conversations`/`brain` symlinks. Rebased onto `bb12a7008`, this branch unifies both into one single `oauth-personal` path:

- **Wire & storage**: Keeps `origin/main`'s `MachineTokenResponse.antigravityToken` JSON envelope (`kind: 'oauth-personal'`), `oauth-personal:v2:` Google `sub` binding, and main-process-only desktop handoff, extended with optional durable `refreshToken` (`^1//...`) and `authMethod` (`expiresAt: null`, verified via isolated `agy acp`, renewable in-place after auth failure when `sub` matches).
- **Daemon & Seatbelt**: Uses `createCredentialProfile` + `AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1` (alongside `AGY_ACP_FORCE_FILE_STORAGE=1`), symlinks persistent `conversations`/`brain` under `<cairnHome>/homes/antigravity-oauth`, grants pinned Seatbelt state access only to those two leaf directories (`conversations` and `brain`), redacts dynamically refreshed `ya29.*` and `1//*` tokens across streaming boundaries, and defaults `SSL_CERT_FILE=/etc/ssl/cert.pem` for Seatbelt-confined non-host Antigravity sessions so Go `agy 1.5.16` verifies TLS without opening `com.apple.trustd` or Keychain services.
- **Model probes**: `antigravitySubscriptionUpstreamModels` keeps OAuth strictly server-side — using `fetchAntigravityEntitlements` while the cached access token is fresh and refreshing a fresh access token via isolated server-side `agy acp` (`refreshAntigravityOAuthAccessToken`) when expired, never dispatching OAuth refresh tokens over the API-key-only Runner model-probe channel.
