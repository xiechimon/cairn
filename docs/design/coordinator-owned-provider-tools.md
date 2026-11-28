# Cairn-owned tool surface at provider adapters

## User scenario

A user who just connected a model asks for a daily competitor brief, or sends a coding task to a Runner. Cairn should make its own schedule (with sensible, stated defaults), not create an invisible job in the model vendor's account. A coder still has workspace tools on the Runner and team-approved connectors. There is no account, key, storage, or billing change.

## Scope

1. The Coordinator uses Cairn's existing schedule operation for recurring work. For a reversible missing detail it uses project references or a well-known default, stores that choice in the schedule prompt, and tells the user. Genuine directions and irreversible/external approvals still belong to the user.
2. Claude Code keeps its default tool preset for normal Runner turns so Cairn's team skills, subagents, todo mirror and web tools keep working, and names the provider's own actions — `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`, `RemoteTrigger`, `Workflow` — in `disallowedTools` for new and resumed sessions. Read-only workspace turns keep today's surface with `Edit` and `Write` denied; locked review turns expose only `Read`, `Glob`, `Grep`; relay-only exposes none of these, with `ToolSearch` added only for deferred Cairn tools. The same deny-list rides on the Claude ACP session meta, and normal ACP turns keep their existing permission setting. Keep managed and inherited MCP behavior unchanged. This is a vendor tool boundary, not a filesystem sandbox.
3. Keep configured models selectable: leave Runner `backendFor`, server runtime selection and provider routes untouched. Pi registers Cairn-selected tools in `apps/daemon/src/backend/pi.ts` and `apps/server/src/coordinator/runtime/tools.ts`; the Codex API transport in `apps/server/src/coordinator/runtime/provider.ts` does not start a vendor CLI. Doubao CLI stays prompt-only pending a real vendor switch; the acceptance checklist keeps its row open. Its ACP permission mode is not a boundary for server-side tools. Do not claim end-to-end isolation on any unchanged adapter.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Recurring brief without a competitor list | The reply names the defaults and confirms only a Cairn schedule record | `apps/server/test/coordinator/responsiveness.test.ts` | this change |
| Claude normal new and resumed task, with and without deferred tools | The default preset stays, the six provider actions are denied, and the resumed launch retains the session id and its surface | `apps/daemon/test/claude-mcp-strict.test.ts` | this change |
| Claude locked and relay-only | Locked retains `dontAsk`, the named reads, host-only MCP and disabled hooks; relay-only stays empty or ToolSearch only. Read-only workspace turns keep today's Edit/Write denial. Cairn and managed connector configuration stay available as before | `apps/daemon/test/claude-mcp-strict.test.ts` | this change |
| Locked and ordinary host skills policy | Ordinary host builds keep the default preset, hooks and plugins while the deny-list carries the provider actions; locked turns keep their existing surface | `apps/daemon/test/skills-hard-block.test.ts` | this change |
| Opaque ACP server-side tool | The configured model remains selectable; a prompt is not an enforcement guarantee | `apps/daemon/test/doubao-acp.test.ts` | later: verified vendor execution controls |

## Out of scope

- No model removal, rerouting, permission/approval UI, wire/schema changes, or new scheduling mechanism. No change to CLI capabilities that Cairn does not use.
- Doubao CLI 2.38.4's `acp --help` exposes permission mode but no tool allowlist. The read of installed CLI and the documentation in [Doubao CLI as a Cairn runtime](../research/doubao-cli-2026-11-27.md) identify a richer vendor agent rather than a model-only transport. A returned tool notification is not pre-execution approval.

## Review

- Verdict: CONCERNS
- Plan-SHA256: b331e67b3d8e3f0b65f1eee8caf5419cc2657bebfd874cbd0f581fe51e7eb1b2
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: independent reviewer subagent (first completed plan review; wrapper exited with no verdict)
- Reviewer-Model: claude-sonnet-5-5
- Fix-check: PASS
- Fix-check-Plan-SHA256: b331e67b3d8e3f0b65f1eee8caf5419cc2657bebfd874cbd0f581fe51e7eb1b2
- Findings: (1) Replace the default-preset assertion. (2) Enumerate local primitives and background implications. (3) Address native Skill and MCP inheritance. (4) Add known scheduler deny backstop. (5) Assert the actual read-only surface. (6) Test locked and relay-only invariants. (7) Test resume and deferred lookup. (8) Cite Pi/Codex selection and keep Doubao open.
- Review-Note: The head review (Opus, 2026-11-29) found that a finite `tools` list dropped Cairn's team skills, subagents, todo mirror and web tools; scope 2 and the two Edge cases rows were rewritten to keep the default preset with the provider-action deny-list, and both recorded hashes were recomputed over that rewritten body.
- Review-Note: The `pi-review.sh` wrapper wrote its marker but exited without a verdict on both the plan and head reviews; each review was completed directly with Opus on the recorded target and its full output is under `~/Pictures/cairn-review/coordinator-own-tools/`.
