# Cairn-owned tool surface at provider adapters

## User scenario

A user who just connected a model asks for a daily competitor brief, or sends a coding task to a Runner. Cairn should make its own schedule (with sensible, stated defaults), not create an invisible job in the model vendor's account. A coder still has workspace tools on the Runner and team-approved connectors. There is no account, key, storage, or billing change.

## Scope

1. The Coordinator uses Cairn's existing schedule operation for recurring work. For a reversible missing detail it uses project references or a well-known default, stores that choice in the schedule prompt, and tells the user. Genuine directions and irreversible/external approvals still belong to the user.
2. Claude Code launches with a finite `tools` list, never its default tool preset: normal Runner turns get `Read`, `Glob`, `Grep`, `Bash`, `PowerShell`, `Edit`, `Write`, and `NotebookEdit`; read-only and locked turns get only `Read`, `Glob`, and `Grep`; relay-only gets none of these. Add `ToolSearch` only for deferred Cairn tools. Preserve scoped MCP, file operations and Runner shell; provider background orchestration and the native `Skill` launcher are not exposed because neither is a workspace primitive. Use Cairn-managed tasks and skills instead. Keep the existing pure relay and locked permission/MCP contract; managed and inherited MCP behavior is unchanged and is outside the provider-built-in guarantee. Use the same builder on new and resumed sessions. Backstop known harness actions with `CronCreate`, `CronDelete`, `CronList`, `ScheduleWakeup`, `RemoteTrigger`, and `Workflow` in `disallowedTools`. This is a vendor tool boundary, not a filesystem sandbox.
3. Keep configured models selectable: leave Runner `backendFor`, server runtime selection and provider routes untouched. Pi registers Cairn-selected tools in `apps/daemon/src/backend/pi.ts` and `apps/server/src/coordinator/runtime/tools.ts`; the Codex API transport in `apps/server/src/coordinator/runtime/provider.ts` does not start a vendor CLI. Doubao CLI stays prompt-only pending a real vendor switch; the acceptance checklist keeps its row open. Its ACP permission mode is not a boundary for server-side tools. Do not claim end-to-end isolation on any unchanged adapter.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Recurring brief without a competitor list | The reply names the defaults and confirms only a Cairn schedule record | `apps/server/test/coordinator/responsiveness.test.ts` | this change |
| Claude normal new and resumed task, with and without deferred tools | Replace the prior default-preset assertion with exact finite argv and native-action deny-list assertions; the resumed launch retains the session id and its surface | `apps/daemon/test/claude-mcp-strict.test.ts` | this change |
| Claude read-only, locked and relay-only | Read-only retains only the named reads; locked retains `dontAsk`, host-only MCP, and disabled hooks; relay-only stays empty or ToolSearch only. Cairn and managed connector configuration stay available as before | `apps/daemon/test/claude-mcp-strict.test.ts` | this change |
| Locked and ordinary host skills policy | Existing default-preset assertion is replaced; plugin configuration, hooks and permissions outside built-in selection remain as before | `apps/daemon/test/skills-hard-block.test.ts` | this change |
| Opaque ACP server-side tool | The configured model remains selectable; a prompt is not an enforcement guarantee | `apps/daemon/test/doubao-acp.test.ts` | later: verified vendor execution controls |

## Out of scope

- No model removal, rerouting, permission/approval UI, wire/schema changes, or new scheduling mechanism. No change to CLI capabilities that Cairn does not use.
- Doubao CLI 2.38.4's `acp --help` exposes permission mode but no tool allowlist. The read of installed CLI and the documentation in [Doubao CLI as a Cairn runtime](../research/doubao-cli-2026-11-27.md) identify a richer vendor agent rather than a model-only transport. A returned tool notification is not pre-execution approval.

## Review

- Verdict: CONCERNS
- Plan-SHA256: ac4d591481dd576f8eba75459bb43029901e3dc7b330969b2539c7928559240f
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: independent reviewer subagent (first completed plan review; wrapper exited with no verdict)
- Reviewer-Model: claude-sonnet-5-5
- Fix-check: PASS
- Fix-check-Plan-SHA256: 75bdaeb1ea17572bcfb42fb3cd50a870c102ce3547a7bec2ce8e325613cf11b1
- Findings: (1) Replace the default-preset assertion. (2) Enumerate local primitives and background implications. (3) Address native Skill and MCP inheritance. (4) Add known scheduler deny backstop. (5) Assert the actual read-only surface. (6) Test locked and relay-only invariants. (7) Test resume and deferred lookup. (8) Cite Pi/Codex selection and keep Doubao open.
