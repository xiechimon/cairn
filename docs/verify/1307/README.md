#1307 evidence

Command for the red run, on the test commit before `strictMcpConfig` was set:

```
pnpm --filter @xiechimon/pacman-cli exec vitest run test/claude-mcp-strict.test.ts --reporter=verbose
```

Output: `failing-vitest.txt`. All three cases spawned and failed because argv did not contain `--strict-mcp-config`.

The same command after the fix: `passing-vitest.txt`.

`sdk-argv-probe.json` is a direct `@anthropic-ai/claude-agent-sdk` `query()` with `spawnClaudeCodeProcess`, not the daemon wrapper. Observed:

- `{}`, omitted `mcpServers`, and an in-process `type: "sdk"` server all spawn with `--setting-sources=user,project,local`, no `--mcp-config`, and no `--strict-mcp-config`.
- `strictMcpConfig: true` adds `--strict-mcp-config` in those same shapes.
- A stdio server is the only object inside `--mcp-config`. The sdk server is not serialized there.

## Live daemon session

Claude Code CLI `2.1.299`, ELF `claude.exe` on `PATH` (`live/claude-mcp-list.txt`). User config `~/.claude.json` registered three stdio servers, `dummy_alpha`, `dummy_beta`, and `dummy_gamma`. Each is `node server.mjs <name>` and exposes `ping`, `echo`, and `status`. `claude mcp list` connected to all three.

Both sessions used the verify stack (server `8791`, web `5273`) and a daemon started with `pnpm exec tsx src/cli.ts start --foreground --server http://127.0.0.1:8791`. The agent was `provider=claude-code`, `modelId=stub-1307`, `mcpServers=[]`. The model endpoint was a local stub at `ANTHROPIC_BASE_URL=http://127.0.0.1:8931`. The recorded artifact is the `tools` array on `POST /v1/messages?beta=true`. Byte size is `Buffer.byteLength(JSON.stringify(tools))`.

Main is worktree `6909f67d`. This branch is the daemon that sets `strictMcpConfig`.

| | main | this branch |
| --- | --- | --- |
| argv | no `--strict-mcp-config` | `--strict-mcp-config` present |
| tools | 37 | 28 |
| tool schema bytes | 54482 | 52088 |
| dummy global tools | 9 (2395 bytes) | 0 |
| `mcp__pacman__*` | 8 (4697 bytes) | the same 8 (4697 bytes) |

The dummy server processes logged `initialize` and `tools/list` at 13:57:11Z during the main session. Their logs were not appended during the branch session at 13:57:49Z.

Both builds finished with assistant text `stub-ok` and build error `构建零改动`, because the stub reply did not commit a diff. The tool list was already on the messages request.

Numbers and names: `live/comparison.json`. Request bodies: `live/main-tools.json`, `live/branch-tools.json`. Process argv: `live/main-claude-argv.txt`, `live/branch-claude-argv.txt`.
