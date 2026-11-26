# Agent config isolation

## Rule

Every harness a step runs reads Cairn's own configuration directory. The user's hooks, skills, global instructions, MCP servers and settings are not loaded; only the sign-in the harness needs is carried in, plus the developer sign-ins every step needs to land its work (below). The repository's project configuration (`.claude/`, `AGENTS.md`, `.agents/`) loads as usual because it lives in the worktree. There are no per-harness exceptions: an existing `CLAUDE_CONFIG_DIR`, a user-installed Devin or a host-keyring Antigravity does not opt a step out.

## State

- On the Runner: `<home>/claude` (Claude Code), the Devin managed home, `<home>/homes/antigravity`, `<home>/homes/antigravity-api-key` and `<home>/homes/gemini`; Antigravity subscription steps use a profile under `<home>/credential-profiles/`.

## Per harness

| Harness | Config home | Credentials carried in |
| --- | --- | --- |
| Claude Code | `CLAUDE_CONFIG_DIR=<home>/claude`, set in the step env | team subscription token in `CLAUDE_CODE_OAUTH_TOKEN`, issued per step |
| Devin | `HOME=` managed home | `WINDSURF_API_KEY`, issued per step |
| Antigravity (`agy`) | `HOME=<home>/homes/antigravity` (`-api-key` with a key), or the subscription profile home | host sign-in: symlinks to the `~/.gemini` token files when present, read through file storage (`AGY_*_FORCE_FILE_*STORAGE`); `settings.json` keeps only the user's `gcp` block. Subscription: token files written into the profile home. API key: `GEMINI_API_KEY` and `modelProvider: gemini` |
| Gemini CLI | `GEMINI_CLI_HOME=<home>/homes/gemini` | symlinks to `~/.gemini/oauth_creds.json` and `google_accounts.json`; `settings.json` keeps only `security.auth` |
| pi on the Runner | resource loader on the Cairn `agentDir` | provider keys from the step token in Cairn's `auth.json` |
| pi Coordinator on the server | builds its own prompt; reads nothing local | — |

`agy` ignores `GEMINI_HOME` (it resolves `~/.gemini` from `HOME`), so a per-step `GEMINI_HOME` never isolated it; `HOME` does.

## Developer sign-ins under a replaced HOME

A harness whose step replaces `HOME` (Devin, every Antigravity mode) would otherwise hide the sign-ins git, `gh` and package managers resolve under it, so the step could commit but not push. Only the harness needs the replaced `HOME`; `git` and `gh` get the user's back:

- The step's `PATH` starts with a per-step directory (in the step's temporary directory, named by `CAIRN_HOST_TOOLS`) holding a `git` and a `gh` launcher, each running the executable the Runner's `PATH` resolved. A launcher swaps `HOME` or an `XDG_*` directory back to the user's only while it still holds the value this step set; a value the caller chose passes through, so a sandboxed `HOME` stays sandboxed, also in a nested step. A tool the Runner cannot find gets no launcher, exactly as in a host run.
- Because the tool itself runs under the user's `HOME`, git configuration, include order, `includeIf`, repository overrides, hooks, signing, credential helpers, the macOS keychain and the `gh` sign-in behave as in a host run. Nothing of the user's is linked or copied into the isolated home, and no git setting is repeated through the environment.
- A login shell rebuilds `PATH` from the system profile. The isolated home carries a `.profile`, a `.zprofile` and a fish `config.fish` that put `CAIRN_HOST_TOOLS` back in front, and do nothing when it is unset. Writing them replaces any link or wrong-typed entry an earlier step left on those paths, without following it. A host `XDG_CONFIG_HOME` outside `HOME` makes fish read the user's own configuration instead.
- Corepack: `COREPACK_HOME` points at the user's cache, and `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` keeps a headless step from waiting for a confirmation.

A read-only verification step gets the Corepack variables only: no launchers and no `CAIRN_HOST_TOOLS`. On Windows the step gets the prompt variable only.

A program that calls `git` or `gh` by absolute path, or that replaces `PATH`, runs under the isolated `HOME` and finds no sign-in. ssh resolves the account's home directory, not `HOME`, and `SSH_AUTH_SOCK` is inherited. A hosted repository's per-step git credential still replaces the user's helpers. As in a host run, `git config --global` inside a step changes the user's real file. Steps are not confined by the operating system: any step can open the user's files by their real paths, so this changes what tools find by default, not what a process can read.

## Credential refresh

Credentials are links, not copies. A refresh by the user's own CLI rewrites the file the link points at, so the next read through the link sees it. Before every step the daemon replaces each link atomically (symlink to a temporary name, then rename): a link that a harness replaced with a regular file during its own refresh points at the user's file again, and a link whose source is gone (the user signed out) is removed. Token-based harnesses get a fresh token from the server on every step.

## Paths that read or write the state

- `assembleStepEnv` (`step-env.ts`): sets the variables above; an Orb guest (`CAIRN_ORB=1`) keeps its image config, whose Claude `settings.json` the nested sandbox needs.
- `sdkTranscriptPath` and its callers (`continueSession`, the session handles, the TUI engine): read `CLAUDE_CONFIG_DIR` from the session env merged over `process.env`, so resume and upload follow the directory the session used.
- `prepareAntigravityHome` / `prepareGeminiHome` (`agent-config.ts`) prepare the isolated harness home before each step: every directory on a credential path must be a real directory (anything else is removed and recreated), a non-link at a credential path is removed before relinking, and `settings.json` is written fresh from the user's file without reading the Cairn copy, so keys an agent added do not persist into later steps.
- The desktop app no longer sets `CLAUDE_CONFIG_DIR` for the Runner; the daemon derives `<home>/claude` per step.

## Failures

- Preparing a Cairn home fails (disk, permissions): the step fails before launch with `Agent config directory setup failed: …`.
- A Claude session created under another directory: `continueSession` throws `SessionNotResumableError`, the existing path for a missing transcript.

## Tests

`apps/daemon/test/step-env.test.ts` (per-harness env, links follow a refresh, re-link after replacement, removal on sign-out, planted-link regression) and `apps/daemon/test/host-developer-access.test.ts` (real `git credential fill`, `gh auth token`, login shells, and git settings and commits compared with a host run, under each replaced `HOME`).
