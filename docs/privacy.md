# Privacy

Cairn is self-hosted and has no built-in product analytics, advertising trackers, or background crash reporting. By default, your projects, conversations, tasks, memory, and credentials stay on your own server and Runner machines. Data leaves your machines only through integrations, authentication, observability, or explicit actions you configure or trigger.

## What Cairn stores locally

- **Server data directory** (`~/.cairn/server` for npm, `~/Library/Application Support/@cairn/desktop` on macOS, `$XDG_CONFIG_HOME/@cairn/desktop` on Linux, or `/data` in Docker):
  - `server.db`: SQLite database holding conversations, tasks, projects, schedules, memory documents, routing rules, and encrypted credentials.
  - `secretbox.key`: encryption key used to seal model API keys, subscription tokens, secrets & environment variables, Vault entries, and integration credentials stored in `server.db`.
  - `vapid.json`: Web Push key pair generated on first start.
  - Hosted bare Git repositories, task attachments, step session records, and `feedback.jsonl` (if you submit an in-app feedback report).
- **Runner data directory** (`~/.cairn` for CLI Runners, or the desktop app's bundled runner folder):
  - `machine.json` (Runner enrollment credentials), `daemon.log`, and `workspaces/` (isolated git worktrees where tasks execute directly on the Runner host).
  - Isolated per-agent configuration and history directories (for example `<home>/claude`), separate from your personal `~/.claude` or `~/.gemini`, carrying in only your sign-in ([design](design/agent-config-isolation.md)).

## Task session records

When a task finishes a step, the Runner uploads that step's session record (the agent's messages, tool calls, and tool output) to your Cairn server (the `--server` you configured). This upload goes only to your own server, not to any third party. The server stores it under its attachments directory to support resuming sessions across machines and exporting trajectories.

Before uploading, the Runner replaces strings that look like secrets (GitHub and `sk-` style keys, bearer tokens, `token=` values) with `[REDACTED]`. If it cannot redact a record, it skips uploading it. Source code and file contents printed by the agent are uploaded as they appear, so treat the server's disk as holding anything an agent read.

The server deletes a session record 30 days after its last write, and deletes the record of a removed step after a 7-day grace period.

## What leaves your machines when configured

Data is sent to external services only when you connect an integration, enable an optional service, or trigger an explicit action:

- **Model providers & subscriptions (`Settings → Model`)**: Prompts, conversation context, tool results, and relevant code snippets are sent to the model providers, subscription backends, or custom endpoints you connect (such as Anthropic, OpenAI / ChatGPT subscription, Google, xAI, GitHub Copilot, Devin, Antigravity, or a custom OpenAI/Anthropic-compatible endpoint). Each provider processes requests under its own terms and privacy policy.
- **GitHub**: When you connect GitHub or work on a GitHub repository, Cairn communicates with GitHub's API and Git endpoints for repository metadata, branches, pull requests, issues, checks, reviews, and OAuth or GitHub App authentication.
- **MCP servers, Composio, and mail (`Settings → Apps`)**:
  - External MCP servers you add receive the tool calls and arguments sent to those servers.
  - If you add a Composio API key, Cairn connects to Composio (`backend.composio.dev`) to list and run actions on your connected third-party apps.
  - If you configure IMAP/SMTP mail accounts, Cairn communicates directly with the mail servers you specify.
- **Chat apps (`Settings → Chat apps`)**: If you connect Telegram, Slack, WeChat, or iMessage, messages and replies exchanged through those bots or bridges travel through the corresponding messaging platform.
- **Push notifications and remote access (`Settings → Remote access`)**:
  - Enabling Web Push or Apple Push Notification service (APNs) sends notification payloads through your browser vendor's push service or Apple's APNs.
  - Enabling Tailscale Serve or embedded `tsnet` (`CAIRN_TSNET=1`) communicates with Tailscale (or your configured `CAIRN_TSNET_CONTROL_URL`) for tailnet coordination. Tailscale log uploading is off by default unless `CAIRN_TSNET_UPLOAD_LOGS` is enabled.
- **Optional observability / Langfuse (`CAIRN_OTEL_ENDPOINT` / `CAIRN_OTEL_ENV_FILE`)**: Off by default. When configured, the server and Runner export OpenTelemetry (OTLP) spans covering Coordinator turns, task steps, tool execution, and token usage to the endpoint you specify (such as a self-hosted or cloud Langfuse instance), with secret redaction applied before export.
- **Optional Clerk authentication (`CAIRN_CLERK_*`)**: Off by default on self-hosted installations. When configured for a remote or hosted deployment, browser sign-in uses Clerk and the server verifies session JWTs against the configured Clerk JWKS URL.
- **Explicit user-initiated actions**:
  - **In-app feedback**: Nothing is sent automatically. If you submit a feedback report in the app, Cairn writes a sanitized copy locally to `feedback.jsonl` and, unless `CAIRN_FEEDBACK_ENDPOINT` is cleared, sends the sanitized message, current route, error summary, OS/architecture/Node version, and (when log inclusion is enabled) redacted tails of recent local log files to the configured endpoint (default `https://feedback.xmon.me/submit`).
  - **macOS desktop updates**: Cairn for Mac checks GitHub Releases for newer desktop versions and downloads update packages from GitHub.
  - **Optional web tools**: Running `cairn web-tools install` or enabling Agent Reach downloads packages from GitHub and PyPI only when you invoke those commands.

## Where to ask

Questions about this document go to the [Q&A category](https://github.com/xiechimon/cairn/discussions) or the issue tracker. Security reports follow [SECURITY.md](../SECURITY.md).
