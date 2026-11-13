# AI-native backend: one action registry

Status: proposal for the owner's review. Nothing here is built. It is a separate project from the Coordinator home redesign.

## Problem

The owner wants cairn to be AI-native: anything a person can do in the app, the agent can do, and no setting waits on a person to click it. Today that is partly true and accidental. The Coordinator has a fixed vocabulary of 47 tools (`CHIEF_TOOL_CATEGORIES` in `packages/shared/src/protocol/chief-tools.ts`: read, organize, execute, private) plus six router tools, and the same tools are served outward by `apps/server/src/services/mcp-face.ts`. The web calls REST routes that are written separately. A capability exists for the agent only when someone remembered to add a tool for it, so the two drift: theme, language, sidebar state, archived-project filters, most settings pages and every panel are reachable only by hand.

## Principle

The agent can do everything the owner can do, except change its own boundary. A reversible action needs no confirmation. An irreversible one asks once.

## Solution

One registry of typed actions on the server. Every surface is generated from it.

| Part | What it is |
|---|---|
| Action | A name, a strict input schema, an output schema, a scope (team, project, user, device), a class (below) and an inverse when one exists. Declared once in `packages/shared`. |
| Handlers | One server function per action. REST routes, Coordinator tools, the MCP face and the CLI all call that function; none carries its own logic. |
| Readable state | Every setting and every piece of interface state an action can change is also a queryable resource, so the agent reads before it writes. |
| Interface actions | Opening a panel, switching theme or language, folding the sidebar, choosing a filter. They are actions like any other; the web applies them from an event, so the agent can drive the interface for the owner. |
| Journal | Every executed action appends a row: actor (owner, Coordinator, thread, MCP client), turn, input, result, inverse. The owner can read it and undo an entry. |
| Events | State changes publish events that wake the Coordinator. The existing wake mechanism stays; polling is not added. |

## Action classes

| Class | Examples | Rule |
|---|---|---|
| Free | Theme, language, panel state, filters, renaming, archiving, creating a task, routing rules | The agent runs it. The journal records it with its inverse. |
| Confirm once | Deleting a project, force-pushing, anything without an inverse | The agent proposes; the owner confirms in the conversation; then it runs. |
| Owner only | The agent's own permission scope, the merge gate, the eval ruler, machine and command boundaries, secret values | No tool exists. The agent can read that the setting exists and what it is, not change it. Secret values are never readable; the agent may use a secret by name. |

The third class is what makes the first safe: an agent that can edit the rules that bound it has no bounds. cairn already protects the eval ruler and the merge gate from pull requests (`packages/shared/merge-gate-paths.json`); this makes the same rule explicit for actions and machine-checked.

## What cairn should and should not have

Should have:

- Any setting changeable in one sentence, with the reply saying what changed and how to undo it.
- A journal view where each entry can be undone.
- Suggestions the agent offers unprompted as quiet chips, never as interruptions.
- Voice as a first-class input.
- Settings pages kept as the place to inspect and verify state.

Should not have:

- A capability that only the interface can reach.
- Multi-step wizards and long forms for work the agent can do from a sentence.
- Settings found only by walking nested menus.
- A private interface for the agent. It takes the same path and the same permission checks as the owner.

## State and failure behavior

| Path | Reads or writes | On failure |
|---|---|---|
| Action call from any surface | Validates input against the schema, checks scope and class, runs the handler, appends the journal row in the same transaction | Schema or permission failure returns a typed error and writes nothing. A handler failure rolls back the change and the journal row together. |
| Undo | Reads the journal row, runs its inverse as a new journaled action | If the state moved since, the inverse refuses and names the conflicting entry; it never overwrites by recency. |
| Confirm once | Stores a pending proposal bound to the turn and the exact input | An answer that does not match the pending input is rejected. A proposal expires with its turn. |
| Interface action | Publishes an event; each open client applies it | A client that does not know the action ignores it and reports that it did, so the agent learns the action had no effect. |
| Registry and surfaces | A test fails when a REST route, a Coordinator tool or an MCP tool exists without a registry entry, or when a class-three path gains a tool | The build is red; nothing ships with a drifted surface. |

## Order of work

1. Registry shape and the migration of the existing 47 tools and their REST twins onto shared handlers. No behavior change.
2. Settings as actions, with the journal and undo.
3. Interface actions and the event that carries them to the web.
4. The three classes as machine-checked rules, including the test that no class-three path has a tool.

Step 1 changes persisted state and the tool protocol, so each step needs its own design review before code. Any step that touches `apps/server/src/services/machine*.ts`, `apps/server/src/routes-machine.ts` or the credential services is owner-routed.

## Open questions for the owner

- Whether a thread, and an outside MCP client, get the same free class as the Coordinator or a narrower one.
- Whether the journal is per team or per user, and how long it is kept.
- Which interface actions the agent may run while the owner is typing, so it never moves the screen under their hands.

## Decisions taken on 2026-11-12

Decided on 2026-11-12: proposed by Claude at ian's delegation and confirmed by ian the same day.

- **Free class of a thread and of an outside MCP client.** A thread gets the same free class as the Coordinator, limited to the project it belongs to. An outside MCP client may read and create tasks; anything else opens per API key through that key's tool whitelist.
- **Journal.** It is stored per team, every row records the operator, and rows do not expire for now.

The third question above, interface actions while the owner is typing, is still open.
