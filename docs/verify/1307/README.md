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
