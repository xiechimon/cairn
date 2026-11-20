# Privacy

**Cairn sends nothing.** The product has no analytics service, no telemetry endpoint, no crash reporter and no usage beacon. Nothing about your work leaves the machine that runs the server unless you configure an integration yourself or press a button that opens a page.

The only exception is an integration you set up: once you connect a model provider or GitHub, Cairn talks to that provider because that is what the integration does. The list of providers and tokens is in the team settings, and every one of them is one you added.

## Task session records

When a task finishes a step, the runner uploads that step's session record (the agent's messages, tool calls and tool output) to your Cairn server. It is the same server you set with `--server`; nothing is sent to Anthropic or any other third party by this upload. The server keeps it on disk under its attachments directory and uses it to resume the session on another machine and to export trajectories.

Before the upload the runner replaces strings that look like secrets (GitHub and `sk-` style keys, bearer tokens, `token=` values) with `[REDACTED]`. If it cannot redact a record it does not upload it. Source code and file contents that the agent printed are uploaded as they are, so treat the server's disk as holding anything the agent read.

The server deletes a record 30 days after its last write, and deletes the record of a removed step after a 7-day grace period.

The runner keeps each agent's configuration and history in Cairn's own directories (for example `<home>/claude`), separate from your personal `~/.claude` or `~/.gemini`, and carries in only your sign-in ([design](design/agent-config-isolation.md)).

## Where to ask

Questions about this document go to the [Q&A category](https://github.com/xiechimon/cairn/discussions) or the issue tracker. Security reports follow [SECURITY.md](../SECURITY.md).
