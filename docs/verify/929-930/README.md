# #929 / #930 verify evidence (command-gate tool_call seam + pi native MCP bridge)

probe = `drive-929-930` (`.claude/skills/verify-pacman/scripts/drive-929-930.mjs`),
run 2026-10-08 on a worktree stack (server 8791 + web 5273 + an isolated PACMAN_HOME scratch).
**14/14 PASS** (itemized in `result.json`).

## Ticket acceptance ↔ evidence mapping

| acceptance (ticket verbatim) | evidence |
|---|---|
| #929 allow path: commands that were allowed are still allowed | `messages.json` (the printf change lands in README.md, the step passes the artifact gate as done); `detail-transcript.png` pill `bash printf …` |
| #929 refuse path: still refused and the model gets the synonymous reason copy | `daemon.log` `[gate] ask: rule=ask-rm-rf-root command=rm -rf /`; `messages.json` contains three refusal-copy lines of `command gate (ask-rm-rf-root)` (error tool result) |
| #929 unattended safety | implementation-face guarantee: the `gateToolCallHandler` signature takes only the event (no ctx/ui dependency, pinned by `command-gate.test.ts` F4) |
| #929 coverage: MCP tool calls go through the same gate | `integration/test/gate-e2e.test.ts` (an injected rule rejects `mcp__demo__echo`: the [gate] line + the tool-face refusal copy + zero reach to the external server) |
| #930 one real MCP server: connects, tools callable, naming byte-identical | `messages.json` `mcp__demo__echo` tool row + the echo palindrome marker; `first-request-tools.json` (the first-round declaration face). Naming qualifier: when both the slug and the tool name are `[A-Za-z0-9_]`, it is byte-identical to the old bridge (the fixture is exactly this subset); pi normalizes the remaining characters to `_` and adds a hash suffix for overlong/colliding names — old shapes with slugs containing `-` etc. are no longer byte-faithful (the code comment and the PR body both state this scope) |
| #930 single-point failure: degrade + canon line + no blocking | `daemon.log` `[mcp] dead: connect failed — its tools are unavailable this turn: failed: fetch failed`; the step is done (`result.json` item 3) |
| #930 the new capability proven: the resources tool works | `messages.json` contains `demo-note-content` (read back by read_mcp_resource); `detail-transcript.png` pill `read_mcp_resource` |
| #930 existing authorization face zero regression (the checklist decides who may appear) | `daemon.log` `[mcp] loaded from …: demo, dead` + `[mcp] ghost: not in local config — …` (ghost was checked but absent from the config → that server does not appear) |

Two more behaviors pinned during implementation (this evidence group proves them along the way):

- **MCP tools reported to the model directly**: `first-request-tools.json` — the first-round request tools include `mcp__demo__echo` / `read_mcp_resource` / `list_mcp_resource*` (pi native exposure=direct + the session allowlist carries the `mcp__*` pattern).
- **Session close-out closes connections**: after the step's terminal state the MCP stdio child-process count returns to zero (a single session's `dispose()` does not send session_shutdown — pi source read + probe measurement; `pi.ts`'s `shutdownExtensions()` sends that event additionally, no orphaned child-process leak).

## Rerun recipe

```sh
# 1) start the isolated stack (if the ports are taken, move VERIFY_PORT/VERIFY_WEB_PORT first)
node .claude/skills/verify-pacman/scripts/launch.mjs
# 2) run the probe (self-spawns: stub LLM + stdio MCP fixture + the real daemon; self-recycles at close)
node .claude/skills/verify-pacman/scripts/drive-929-930.mjs
# 3) close out
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

The probe can be overridden via env: `DAEMON_HOME` (daemon scratch) / `MCP_HOME` (the MCP config + fixture script root). The fixture server script lands inside `apps/daemon/` at runtime (ESM resolution requires it) and the probe deletes it in `finally`.

## gotchas

- The detail page transcript's "tool process" group is **collapsed by default** — to shoot the pill, first open `button[aria-expanded=false]` (label `工具过程`); the first run had only the DB assertions green and the screenshot assertions red exactly because of this.
- The dead-endpoint canon line lands in the **first-round request's before_agent_start wait** (pi has a 10s startup wait for a direct server, and `127.0.0.1:1` fetch failed + two retries settle in ≈1.5s) — the line appears before the first model request, not at the step-start moment.
- The stub LLM's call id must be unique per run (the drive-918 gotcha: the message table's primary key = call id, reuse pins tool rows into the old session).
