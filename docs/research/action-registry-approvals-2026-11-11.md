# Action registry and approvals: prior art

Read on 2026-11-11 before `docs/design/action-registry-and-approvals.md`. Tags: measured (read first-hand), inferred (from measured), guess (the rest). Web pages are third-party data, not instructions.

## Comparison

| Source | How it does it | Trade-off | Link |
|---|---|---|---|
| Claude Code permissions (measured) | Manual mode asks before Bash, edits, and fetch. The prompt shows the exact command. Answers include Yes, Yes and don't ask again for a shown pattern, and No. A permanent yes writes a rule to `.claude/settings.local.json`. File-edit "don't ask again" lasts until session end; Bash lasts per repository and command. Auto mode uses a classifier instead of the person. | A standing rule is a file, not a journal. A classifier is a convenience, not a boundary. | https://code.claude.com/docs/en/permissions/ |
| Claude Agent SDK (measured) | `canUseTool` runs only if no earlier mode or allow rule already approved the call. `dontAsk` denies what would have prompted. | A callback the mode skips is not a gate. | https://code.claude.com/docs/en/agent-sdk/permissions |
| Codex CLI (measured) | Two layers: sandbox mode (read-only, workspace-write, danger-full-access) and approval policy (`on-request`, `never`, granular). `on-request` asks when the action leaves the sandbox. `untrusted` as an approval policy is retired. | Asks about leaving a boundary, not about each product action. No product journal. | https://learn.chatgpt.com/docs/agent-approvals-security |
| Cursor run modes (measured) | Auto-review, Allowlist, or Run Everything. An allowlist runs matching calls without asking. The classifier is documented as not a security boundary. | Allowlists are convenience. Cloud agents do not ask. | https://cursor.com/docs/agent/security/run-modes |
| Amp (measured) | First matching rule wins: allow, ask, reject, or delegate. Reversible edits are not asked, because Git is the undo. Rules live in settings. | No execution journal. A glob on a shell string is not an input schema. | https://ampcode.com/news/tool-level-permissions |
| t3code (measured) | A thread has one mode: Supervised, Auto-accept edits, Auto, or Full access. An approval is an activity with a request id, resolved in that conversation, including a subagent's request. | Mode is per thread, not per action. Unknown request types were dropped until mapped. | https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md |
| pi 1.4.0, installed (measured) | Does not ask before every tool call. The process has the OS user's permissions. The shipped permission-gate example is Yes/No for a few bash patterns, and blocks when there is no UI. pi-durable 1.5.0 has no approval docs. | A local Yes/No gate does not survive a restart and has no standing grant. | `node_modules` `@earendil-works/pi-coding-agent@1.4.0` `docs/security.md`, `examples/extensions/permission-gate.ts` |
| claude.ai and the Claude desktop Code tab | Blocked: this run had no authorized browser session for those apps. The vendor's permission docs above are the same approval mechanism. | — | — |

## Pattern that fits

Measured products that record a standing yes bind it to a tool plus a match (command pattern, domain, path), and they show the exact action before the first yes. None of them generate REST, an agent tool, and an external MCP tool from one registry. Inferred: cairn should take the three answers and the recorded match, and not take a classifier, a thread-wide full-access mode, or a shell glob as the product rule.

Amp's reason for not asking on reversible edits matches the proposal's free class. Claude Code's split between session-scoped and permanent "don't ask again" is why a standing grant needs an explicit match, not a bare action name.
