# MCP page (read-only local config surface)

Since spec 13/#368 the MCP page = a read-only projection of the server machine's local `~/.claude.json` mcpServers section: no create/edit entries, the empty-state copy is the configuration guide. The execution surface lives in the daemon: the claim payload carries only the slug list (version gate >= 0.2.0), the daemon reads the config on **its own machine** to resolve endpoints and connects per turn — the credentials (env/headers values) live only in the config file and on the executing machine, they never enter the server DB / wire / API responses.

## Sub-features

- `mcp-list`: GET `/api/teams/{id}/mcp-servers` = the config projection record (label = the key name, slug = the lowercased key, stdio's url slot = the command preview, hasCredential/credentialKeys key names only).
- `mcp-readonly`: the page has no create entry (`[data-testid="resource-new"]` count 0), rows have no more-menu ink (the `[data-testid="resource-row"]` rows carry 0 `button` inside, same canon as dead-buttons.spec), no popups; POST/PATCH/DELETE on the same path = 404.
- `mcp-empty`: a missing config file / no mcpServers section = the empty state, the copy points at `~/.claude.json` (pinned by the fixture e2e dead-buttons #368).
- `mcp-exec`: after agent.mcpServers[] is checked, the daemon resolves and connects on its own machine; an unknown slug produces the degradation row `[mcp] <slug>: not in local config — …`, and each turn prints `[mcp] loaded from <path>: …` with the actually-loaded set.

## How to get to it (user POV)

- Sidebar `资源` ▾ -> MCP; user menu -> MCP; the search-panel navigation row MCP.
- Direct URL `/app/resources/mcp-servers` (live mode, no `?scenario=`).
- Driving (`vp.mjs list mcp-servers` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive mcp-servers readonly-config`: the MCP page's read-only config projection; carry `CAIRN_MCP_CONFIG=<fixture claude.json>` at launch.
  - Cases judged stale and refusing to run without `--force` (the refusal prints the reason): `vp.mjs drive mcp-servers command-gate-mcp-bridge` (agent creation without machineId, 400 since ADR 0019).

## Driving it with verify-cairn

Preconditions:
1. Write the fixture config (do not use the real `~/.claude.json`, to keep real config key names out of the evidence):
   ```sh
   cat > /tmp/verify-claude-368.json <<'EOF'
   {"mcpServers":{
     "demo":{"url":"https://example.invalid/mcp","headers":{"Authorization":"Bearer v3r1fy-header-secret"}},
     "local":{"command":"node","args":["-e","0"],"env":{"PROBE_KEY":"v3r1fy-env-secret"}}
   }}
   EOF
   ```
2. Carry the env at launch (the server process passes `{...process.env}` through):
   ```sh
   CAIRN_MCP_CONFIG=/tmp/verify-claude-368.json VERIFY_REPO_ROOT=<worktree> \
     VERIFY_PORT=<port> VERIFY_WEB_PORT=<port> node .claude/skills/verify-cairn/scripts/launch.mjs
   ```
3. The custom probe:
   ```sh
   VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-mcp.mjs
   ```

- The probe's assertion surfaces: the API JSON (slugs/transport/credentialKeys projection + key values absent + the three write verbs 404), SQLite (the `mcp_server` table does not exist), the UI (rows render as config key names (`[data-testid="resource-row"][data-mcp]` rows + exact in-row text nodes), both `[data-testid="resource-new"]` and in-row `button` are 0) + screenshots.
- The execution surface (the daemon resolving slugs and really connecting to an external MCP server) has no UI-stack recipe — the canonical source = `integration/test/m4b-mcp-e2e.test.ts` (real server + real daemon + stub LLM + an external MCP started inside the test); running that integration test is this surface's evidence; the assertions include a real `mcp__demo__echo` call, the dead-endpoint connect-failed row, the ghost-slug not-in-config row, and the loaded-from row.

## Gotchas

- `CAIRN_MCP_CONFIG` must be exported **before** launch (launch.mjs snapshots the env when starting the detached child process); setting it after the stack is up has no effect, you must cleanup and relaunch.
- Without that env, the server reads the **real** `~/.claude.json` — the user's real config key names would enter the screenshots/API evidence; always use the fixture for verification.
- The record's createdAt/updatedAt = the config file's mtime, the page's relative-time column (`X 分钟前`) means "the configuration was last modified", not the registration time.
- The daemon execution surface reads the config of **the machine the daemon is on** (each machine in a multi-machine setup reads its own, spec 13 Q6) — a single-machine verification stack degenerates to both sides reading the same file; cross-machine divergence is read from the actual path on the `[mcp] loaded from <path>` line.
- After a code change you must relaunch (a worktree under `.claude/worktrees/` is shielded by the vite watch ignore covering the whole worktree, mid-run code changes do not take effect).
- **#944 carrier migration**: class-name hooks -> semantic/data-* carriers (assertion semantics unchanged) — `.res-rowcard--mcp` -> `[data-testid="resource-row"][data-mcp]`, `.res-empty` -> `[data-testid="resource-empty"]`, `.res-row-title` -> copy-first (exact in-row text nodes), `.res-new` -> `[data-testid="resource-new"]`, `.res-row-more` negative -> in-row `button` count 0.
