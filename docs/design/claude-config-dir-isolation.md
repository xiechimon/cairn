# Claude config directory isolation

## State

`CLAUDE_CONFIG_DIR` decides where the Claude Code SDK reads user settings, hooks and plugins and where it writes session transcripts (`<dir>/projects/<slug>/<sessionId>.jsonl`). The daemon reads the same variable to find a transcript (`sdkTranscriptPath`), to resume a session (`continueSession`) and to upload it (`readSessionJsonlForUpload`).

## Rule

A task session never shares its configuration or history with the user's own Claude Code. The daemon uses `<home>/claude` unless `CLAUDE_CONFIG_DIR` is already set. The desktop app and the orb image already set it; `isolateClaudeConfigDir` gives the standalone `cairn start` the same default.

## Paths that read or write the state

- SDK child process: inherits `process.env`, so it reads settings and writes transcripts under the directory.
- `sdkTranscriptPath`, `continueSession`: read `process.env.CLAUDE_CONFIG_DIR` and so follow the daemon.
- `readDefaultClaudeOauthExpiresAt`: reads `<dir>/.credentials.json`. Tasks authenticate with the injected `CLAUDE_CODE_OAUTH_TOKEN`, so an empty directory is the expected case.
- Doctor and login helpers: unchanged; they honour an explicit variable.

## Transitions and failures

- Variable unset or empty: set to `<home>/claude` once at daemon start, before any step runs.
- Variable set: kept as is, including a relative path rejected later by the existing checks.
- A session created before this change lives under the user's `~/.claude`: `continueSession` throws `SessionNotResumableError`, the existing path for a missing transcript.
- The directory is created by the SDK on first write; the daemon creates nothing new.

## Tests

`apps/daemon/test/claude-config-dir-isolation.test.ts`: default under home, explicit value kept, empty value treated as unset.
