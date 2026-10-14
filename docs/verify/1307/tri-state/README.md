# #1307 tri-state live session

Measured on the integrated branch after merging `0e577667` (#1314, unconditional `strictMcpConfig`). The product decision is the tri-state from #1311: a missing `mcpServers` field keeps the machine's own MCP config and does not force strict mode. A list, including `[]`, loads only those servers and turns strict mode on. #1314's unconditional flag is not kept, because it would lock the missing-field case the same way as `[]`.

Claude Code CLI `2.1.299`. Daemon `pnpm exec tsx src/cli.ts start --foreground` against an isolated server (`PORT=8794`, `PACMAN_HOME=/tmp/probe-1307/pacman-home`). The daemon resolved `claude` to a wrapper that execs `/home/ubuntu/.local/bin/claude` and appends session argv (`--output-format stream-json`) to `claude-argv.log`. `HOME=/tmp/probe-1307/home` so both the daemon MCP config and the CLI read the same `~/.claude.json`. That file registered three stdio servers, `dummy_alpha`, `dummy_beta`, and `dummy_gamma`. Each is `node server.mjs <name>` and exposes `ping`, `echo`, and `status`.

The agent was `provider=claude-code`, `modelId=stub-1307`. `ANTHROPIC_BASE_URL` pointed at a local stub. The recorded artifact is the `tools` array on `POST /v1/messages?beta=true`. Each session posted that array twice. The first body had `tools: []` (2 bytes). The numbers below are the second body, the one that carried the tool list. Byte size is `Buffer.byteLength(JSON.stringify(tools))`.

The missing-field case sets the machine row `latestCliVersion` to `0.1.9` (below `MCP_MIN_CLI_VERSION` `0.2.0`) so `claimMcpSlugs` omits the field. The agent row still held `['dummy_alpha']`. If the field had been sent, only alpha would load. `[]` and the explicit list use `latestCliVersion=0.2.0`, so the claim carries the array.

All three builds ended `构建零改动`. The stub reply did not commit a diff. The tool list was already on the messages request. Daemon log lines are in `daemon.log`. Dummy server stdio traffic is in `mcp.log`.

| case | claim field | `--strict-mcp-config` | `--mcp-config` | tools | schema bytes | `~/.claude.json` tools |
| --- | --- | --- | --- | --- | --- | --- |
| absent | omitted (version gate, agent row was `['dummy_alpha']`) | absent | absent | 40 | 71399 | 9: alpha, beta, and gamma |
| `[]` | `[]` | present | absent | 31 | 70028 | 0 |
| list | `['dummy_alpha']` | present | only `dummy_alpha` | 34 | 70488 | 3, all `mcp__dummy_alpha__*`. beta and gamma absent |

`mcp__pacman__*` is 8 tools in every case. Daemon log: the absent case has no `[mcp]` line (the claim key was missing). `[]` logged `managed-empty: strict MCP set (runtime config not inherited)`. The list logged `loaded from .../.claude.json: dummy_alpha`. `mcp.log` shows alpha, beta, and gamma `initialize` + `tools/list` during the absent session, no dummy process during `[]`, and only alpha during the list session.

Request bodies: `absent-tools.json`, `empty-tools.json`, `list-tools.json`. Argv: `claude-argv.log`. Per-case records: `case-absent.json`, `case-empty.json`, `case-list.json`.
