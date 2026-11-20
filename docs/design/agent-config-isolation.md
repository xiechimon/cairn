# Agent config isolation

## Rule

Every harness a step runs reads Cairn's own configuration directory. The user's hooks, skills, global instructions, MCP servers and settings are not loaded; only the sign-in the harness needs is carried in. The repository's project configuration (`.claude/`, `AGENTS.md`, `.agents/`) loads as usual because it lives in the worktree. There are no per-harness exceptions: an existing `CLAUDE_CONFIG_DIR`, a user-installed Devin or a host-keyring Antigravity does not opt a step out.

## State

- On the Runner: `<home>/claude` (Claude Code), the Devin managed home, `<home>/agent-homes/antigravity`, `<home>/agent-homes/antigravity-api-key` and `<home>/agent-homes/gemini`.

## Per harness

| Harness | Config home | Credentials carried in |
| --- | --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR=<home>/claude`, set in the step env | team subscription token in `CLAUDE_CODE_OAUTH_TOKEN`, issued per step |
| Devin | `HOME=` managed home | `WINDSURF_API_KEY`, issued per step |
| Antigravity (`agy`) | `HOME=<home>/agent-homes/antigravity` (`-api-key` with a key) | keyring sign-in: symlinks to `~/.gemini/antigravity-cli/antigravity-oauth-token` and `~/.gemini/jetski-standalone-oauth-token` when present, and to `~/Library/Keychains` on macOS; `settings.json` keeps only the user's `gcp` block. API key: `GEMINI_API_KEY` and `modelProvider: gemini` |
| Gemini CLI | `GEMINI_CLI_HOME=<home>/agent-homes/gemini` | symlinks to `~/.gemini/oauth_creds.json` and `google_accounts.json`; `settings.json` keeps only `security.auth` |
| pi on the Runner | resource loader on the Cairn `agentDir` | provider keys from the step token in Cairn's `auth.json` |
| pi Coordinator on the server | builds its own prompt; reads nothing local | — |

`agy` ignores `GEMINI_HOME` (it resolves `~/.gemini` from `HOME`), so a per-step `GEMINI_HOME` never isolated it; `HOME` does.

## Credential refresh

Credentials are links, not copies. A refresh by the user's own CLI rewrites the file the link points at, so the next read through the link sees it. Before every step the daemon replaces each link atomically (symlink to a temporary name, then rename): a link that a harness replaced with a regular file during its own refresh points at the user's file again, and a link whose source is gone (the user signed out) is removed. Token-based harnesses get a fresh token from the server on every step.

## Paths that read or write the state

- `assembleStepEnv` (`step-env.ts`): sets the variables above; an Orb guest (`CAIRN_ORB=1`) keeps its image config, whose Claude `settings.json` the nested sandbox needs.
- `sdkTranscriptPath` and its callers (`continueSession`, the session handles, the TUI engine): read `CLAUDE_CONFIG_DIR` from the session env merged over `process.env`, so resume and upload follow the directory the session used.
- `createSessionConfiner` (macOS Seatbelt): opens the isolated home and the linked credential files as state. An Antigravity API-key step gets no keyring token files.
- `prepareAntigravityHome` / `prepareGeminiHome` (`agent-config.ts`) run unconfined on a directory the previous step could write. They never follow what that step left there: every directory on a credential path must be a real directory (anything else is removed and recreated), a non-link at a credential path is removed before relinking, and `settings.json` is written fresh from the user's file without reading the Cairn copy, so keys an agent added do not persist into later steps.
- The desktop app no longer sets `CLAUDE_CONFIG_DIR` for the Runner; the daemon derives `<home>/claude` per step.

## Failures

- Preparing a Cairn home fails (disk, permissions): the step fails before launch with `Agent config directory setup failed: …`.
- A Claude session created under another directory: `continueSession` throws `SessionNotResumableError`, the existing path for a missing transcript.

## Tests

`apps/daemon/test/step-env.test.ts` (per-harness env, links follow a refresh, re-link after replacement, removal on sign-out), `apps/daemon/test/confine-session.test.ts` (Seatbelt state for the isolated Antigravity home and API-key mode), planted-link regression in `step-env.test.ts`.
