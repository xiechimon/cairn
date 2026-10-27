# How herdr reaches Multica's effect

- Nature: methodology / tooling research, not a research-ticket artifact (in-repo `r<N>-*.md` files are numbered by research ticket; this one is not). No implementation plan.
- Subjects: ① the capability surface of herdr itself (can it grow Multica's effect on its own); ② herdr's extension surface (plugins / socket API / multi-machine); ③ finished products already built in the ecosystem (verified one by one).
- Captured 2026-10-01. Local herdr versions measured: client 0.9.3, server 0.9.1, socket protocol 22, socket `~/.config/herdr/herdr.sock`.
- Online channels: the `github` backend of `agent-reach` (= the `gh` CLI). Plugin READMEs are the projects' own descriptions (first-hand); star counts are a measured snapshot of `gh search repos --topic herdr-plugin`.
- Marking convention: `measured` = ran the command output / captured the original text myself; `inferred` = derived from the original text or code; `guess` = no first-hand evidence. Source nature marked with `[first-hand]` / `[project self-description]` / `[secondhand]`.
- Citation convention: herdr conclusions come from local CLI measurements (`herdr --help`, `herdr api schema --json`, `herdr --skill`, `herdr status`); Multica conclusions are cited from the wiki page ``[[todos.dev vs Multica comparison]]`` (that page is the product of a 2026-09-30 full close-reading of multica.ai's 41 official-doc pages); this document **does not re-fetch the Multica docs for re-verification**.
- Check-in note (2026-10-03): ① the Multica deployment was decommissioned on this machine and on mea on 2026-10-02 (user ratified); this page is kept as methodology and historical comparison; the Multica-side content was secondhand citation at writing time (see above), and this freshness note remains in force. ② The "zero installed plugins" in S7 is a 2026-10-01 snapshot — as of 2026-10-03 this machine has herdr-projects installed and enabled (the coordinator plugin inventoried in S5), which this repo's multi-thread orchestration now uses.

---

## S0 Quick conclusions

1. **herdr itself cannot reach Multica — not for lack of features, but as a different species.** herdr's socket API has **102 methods** in total, and looking at them one by one they are all "topology + agent lifecycle": `workspace.* / tab.* / pane.* / worktree.* / layout.* / agent.* / events.* / plugin.* / notification.show / integration.*`. There is **no task object** in it — no issue, no task, no queue, no run, no dispatch, no persistence of work history. `measured`
2. **What herdr knows is "which agent in which pane is idle / working / blocked / right now", not "who is doing what job".** State is a pane-level transient that lives and dies with the pane; nothing in herdr's own state records "has this thing been done before". `measured`
3. **Multica's effect = a "work-object layer" added on top of a terminal multiplexer.** Board (issue), assignee, run queue, heartbeat and offline queuing, server-side metadata, cross-machine runtimes, the five IM channels, Squad, Autopilot, the Access permission model — not one of these lives in herdr's own capability surface. `measured` (herdr side) / `[secondhand]` (Multica side)
4. **But herdr's plugin layer can reach it, and someone already has.** In the ecosystem, `nelsonPires5/herdr-board` (166★) is a terminal version of Multica's effect: **card = prompt, column = pipeline stage; dragging a card into an automatic column → the daemon queues it → an agent starts in a visible herdr pane; a manual column = a human gate that stops and waits for approval**. `[project self-description]`
5. **The shape of the path is fixed: don't touch herdr itself; the plugin brings its own daemon + its own storage, and herdr serves only as the execution substrate.** herdr-board verbatim: `boardd` is a resident daemon for queue / dispatch / lifecycle, and **all board state lives in `~/.local/share/herdr-board/`; herdr's own state is never modified**. `[project self-description]`
6. **The "Chief" half also has a finished product.** `eliasstravik/herdr-projects` (551★): a coordinator agent that never does the work itself, splitting a goal into multiple threads, each thread an independent agent + independent worktree + independent branch, sharing one set of instructions and memory, with the sidebar grouped by "who needs you". This is exactly the orchestrator shape that Multica lacks and todos has. `[project self-description]`
7. **Only four things genuinely cannot be reached, and all four are "platform" properties, not "orchestration" properties**: server-side shared metadata and multi-user, identity/permission models, heartbeat + offline queuing + capacity gates, and cross-machine sharing (herdr-board is single-machine / single-server). `inferred`
8. **One easy mistake to avoid: herdr's `--machine` is not Multica's server side.** It mirrors a remote machine's herdr server into the local sidebar (the profile `mea` exists on this machine but with `enabled: false`) — it is "control from multiple places", not "one shared ledger". `measured`
9. **Meaning for pacman: this is not pacman's competitor; it is upstream on the same chain.** pacman is the centralized form with "the server in the middle, execution on registered machines"; herdr-board is the form where "everything is on the local machine, the daemon sits right next to your terminal". Both borrow the same batch of mechanisms (visible panes, agent status lights, worktree isolation, human gates), but the ledger sits on opposite sides. `inferred`

---

## S1 Taking the real question apart first: the two are not on one comparison table at all

The taxonomy of six orchestrators (the skeleton of ``[[AI agent orchestrator six-way review]]``) puts herdr and Multica in two different classes:

| Class | Abstraction | What it does | Members |
|---|---|---|---|
| Terminal / session multiplexers | pane, workspace | Run the agents you already have in parallel without replacing them, only surfacing "who is doing what" | Herdr, Orca |
| Management and organization layer | roles, tasks, reporting lines | Treat agents as **employees**, issuing roles and tasks | Paperclip, Multica |

So the phrase "how herdr reaches Multica's effect" contains a gap that must be acknowledged first: **a terminal multiplexer inside one company and an AI-employee simulator were never competing for the same use case.** `[secondhand]`

But that does not mean it cannot be done. The taxonomy describes the **body**, while herdr has something other terminal multiplexers (tmux, zellij) do not: **a first-class extension surface** — the plugin system + socket API. Multica's effect can therefore be **stacked on top of herdr**, rather than **grown inside herdr**.

---

## S2 herdr itself measured: no task among the 102 methods

`herdr api schema --json` → `schemas.request.oneOf` has **102 methods** in total, enumerated in full below (`measured`):

```
server/client    ping · server.stop · server.live_handoff · server.reload_config ·
                server.ssh_agent.register · server.agent_manifests · server.reload_agent_manifests ·
                notification.show · product_announcement.dismiss · release_notes.dismiss ·
                command.invoke · client.window_title.set|clear · client_shell.surface.set · session.snapshot
workspace        workspace.create|list|get|focus|rename|move|move_block|report_metadata|close
worktree        worktree.list|create|open|remove
tab             tab.create|list|get|focus|rename|move|close
agent           agent.list|get|read|explain|send_keys|rename|view.set|view.clear|focus|start|prompt|wait
pane            pane.split|swap|move|zoom|layout|process_info|neighbor|edges|focus_direction|resize|
                scroll|clear|edit_scrollback|selection.read|copy_motion|copy_search|list|current|get|
                focus|input.set|link.activate|link.resolve|rename|send_text|send_keys|send_input|read|
                report_agent|report_agent_session|report_metadata|clear_agent_authority|release_agent|close
                · popup.close · pane.wait_for_output
layout          layout.export|apply|set_split_ratio
events          events.subscribe · events.wait
integration/plugins  integration.list|install|uninstall · plugin.link|list|unlink|enable|disable ·
                plugin.action.list|invoke · plugin.log.list · plugin.pane.open|focus|close
```

Not a single task object. Against Multica's object surface (workspace / project / issue / run / agent / runtime / squad / autopilot), on the herdr side **only the name workspace collides by accident, and the meaning is completely different**: herdr's workspace is "one screen of terminal layout", while Multica's workspace is "one team's shared board". `measured` / `[secondhand]`

Agent states are only four — `idle | working | blocked | done` (plus `unknown`) — and they are **pane-level transients**: when an agent exits, is released, or is replaced, its name and state are cleared together (verbatim from `herdr --skill`: `A name follows the current pane occupant and is cleared when that agent exits, is released, or is replaced.`). **herdr does not record "who finished what yesterday".** `measured`

---

## S3 Multica's effect decomposed into portable mechanisms

Decomposing the Multica side of ``[[todos.dev vs Multica comparison]]`` into mechanisms (dropping the proper nouns), there are nine portable ones plus four that belong only to a platform:

**Portable (the herdr side has a corresponding load-bearing part)**

1. A work-unit object, persisted and traceable (issue: description + status + comments + history)
2. Agents as assignees (identity, not process; executes only when triggered)
3. Queue + dispatch (handing a work unit to an agent, starting a process on its machine)
4. Human gate (Multica's real gate is the **PR**; `in_review` is a state, not a gate)
5. Status written back explicitly by the agent itself via CLI (Multica verbatim: the server does not flip state at run start/end)
6. Worktree isolation (one working directory per task)
7. Experience reuse (skills in `SKILL.md` format, accumulating over time)
8. Review (Multica has none built in; the official tutorial is "make the Reviewer an ordinary agent, triggered with @")
9. Orchestrator / multi-agent routing (Multica has the Squad: the leader only routes and does not implement; todos has the Chief)

**Platform-only (meaningful only with a server / multi-tenancy)**

10. Server-side persisted metadata + cross-device sharing ("execution on your machine, metadata on the server")
11. Identity and permissions (Access three tiers: Only me / Entire workspace / Specific people; run-level `mat_` tokens)
12. Heartbeat (15s) + offline decision (~3 minutes) + queued runs waiting for a machine to return + capacity gates (daemon 20 / agent 6)
13. The five IM channels (Feishu/Lark, Slack, DingTalk, WeCom, Telegram)

---

## S4 herdr's three extension points

herdr does not do these things, but it leaves the door open for doing them. Three measured facts:

1. **A plugin system, and "the entire herdr CLI is the plugin API".** Plugins are ordinary argv commands (Bash/JS/Lua/Rust all fine), calling back into herdr via `HERDR_BIN_PATH`; a manifest can declare actions, events, panes (overlay / popup / split / tab / zoomed), link_handlers, and startup hooks. Install: `herdr plugin install owner/repo[/subdir]` (GitHub shorthand, `--ref` can pin a version, with an interactive manifest preview before confirmation). `measured`
2. **The socket API has event subscription.** `events.subscribe` can subscribe to lifecycle events such as `pane.agent_status_changed`, `pane.output_matched` (push-style, ordered, bounded batching; a subscriber falling too far behind receives `events_lost` instead of silent drops). The companion `notification.show` (`herdr notification show "..." --body ... --sound request`) can pop a herdr notification directly. `measured`
3. **Multi-machine is "control from multiple places", not "shared ledger".** `herdr --machine <label-or-id> <cmd>` forwards commands to a remote herdr server (the local profile `mea` already exists but with `enabled: false`). `herdr --skill` states it explicitly: `herdr machine list` lists **connection profiles, not a cross-machine pane list**. `measured`

Conclusion: **herdr has standardized "terminal + agent lifecycle" into a programmable interface, and so the "task layer" becomes a legitimate third-party implementation location.** This is also why the ecosystem contains the things below.

---

## S5 Ecosystem measured: someone has already done it

`gh search repos --topic herdr-plugin` (2026-10-01 snapshot), the finished products directly related to "turning herdr into a work board", sorted by stars (`measured`):

| Repo | ★ | One sentence (project self-description) | Which Multica mechanism it maps to |
|---|---|---|---|
| `eliasstravik/herdr-projects` | 551 | A coordinator agent that only decomposes and never works; each task gets an independent agent + worktree + branch, sharing instructions/memory, with the sidebar listing "who needs you" | Orchestrator (Squad / Chief) + worktree isolation + status flowing back |
| `nelsonPires5/herdr-board` | 166 | **Board: card = prompt, column = pipeline stage; dragging into an automatic column starts an agent in a visible pane; a manual column is a human gate** | Work unit + queue dispatch + human gate + history |
| `smarzban/tsk` | 162 | "A terminal task board for you and your agents: one shared queue, a TUI for the human, a CLI for the agent" | Work object + dual human/machine interface |
| `aemrebarut/herdr-dagr` | 91 | Draws an agent swarm as a live DAG with review gates and evidence | Review gate + observability |
| `permgps/herdr-telegram-agents` | 72 | Drives agents from Telegram, one topic per agent | IM (the Telegram one) |
| `miiraheart/herdr-beads` | 35 | Turns `bd` (beads) issues into List / Table / Kanban windows, without building its own storage | Work object (external storage) |
| `deimantasnork/captains-deck` | 35 | A read-only Firstmate-flow board plugin | Board view |

Not board-related but filling two other gaps: `persiyanov/herdr-reviewr` (810★, diff-margin annotations sent straight back to the agent = the review mechanism's ready-made interaction form), `dcolinmorgan/herdr-remote` (398★, menu-bar / phone / Telegram monitoring cockpit), `eliasstravik/herdr-agent-progress` (31★, agents self-report task progress into the sidebar).

**Reading the architecture of `herdr-board`** (the closest to Multica, `[project self-description]`):

```
 TUI    CLI      ← the two interfaces for humans and agents
   └──┬──┘
   boardd        ← daemon: queue / dispatch / lifecycle
      │
    herdr        ← one visible pane per run
```

- A **card** carries title, base prompt, harness/model/effort/permission settings, and a target herdr session and workspace.
- A **column** can define a system prompt, automatic or manual triggers, a timeout, and which stage success/failure each goes to.
- Moving a card into an automatic column → queued → the daemon resolves the session, opens/reuses a workspace, and starts an agent in a visible pane.
- The agent reads the card/run environment variables, comments and reports results via the `board` CLI → the daemon applies the column transition (next automatic stage, or a manual gate).
- **A manual column = the pipeline stops and waits for human approval**; `History stays with the card`: comments, runs, results, retries, and archived cards are all reviewable.
- All state lives in `~/.local/share/herdr-board/` (SQLite schema v15); **herdr's own state is never modified**.
- Requires herdr **0.9.0+ / socket protocol 22** (local protocol 22, satisfied); supports Pi / Claude Code / Codex / OpenCode / Antigravity.

Its mechanism-by-mechanism correspondence with Multica is nearly one-to-one: **card ≈ issue, column ≈ pipeline stage, manual column ≈ human gate, `board done` ≈ the agent explicitly writing state, `boardd` ≈ daemon dispatch, the `card-<id>` tab ≈ worktree/session isolation**. The differences are two: herdr-board's gate is "column position" while Multica's gate is "the PR"; herdr-board's state lives in local SQLite while Multica's lives on the server. `inferred`

---

## S6 Mechanism-by-mechanism comparison: reachable / reachable with a patch / unreachable

| Multica mechanism | herdr itself | With plugins stacked | Basis |
|---|---|---|---|
| Work-unit object (issue) | none | yes: `herdr-board` cards / `tsk` tasks / `herdr-beads`'s bd issues | `measured` |
| Agent as assignee | half: recognizes agents in panes, but not bound to tasks | yes: cards carry harness/model/effort + target session/workspace | `measured` |
| Queue + dispatch | none | yes: the `boardd` daemon | `[project self-description]` |
| Human gate | none | yes: manual columns / dagr's review gates | `[project self-description]` |
| Agent self-reports status via CLI | none (only the four pane states) | yes: the `board` CLI (comment / done) | `[project self-description]` |
| Worktree isolation | yes, built in as `worktree.*` | yes, reused directly | `measured` |
| Skills (SKILL.md accumulation) | none | half: `herdr-dagr` has a producer skill; herdr-projects has a `## Remember` memory write-back | `[project self-description]` |
| Review | none | yes: `herdr-reviewr` annotations back to the agent / dagr review gates | `[project self-description]` |
| Orchestrator / multi-agent routing | none | yes: the `herdr-projects` coordinator | `[project self-description]` |
| Server-side metadata + cross-device | no | no: herdr-board state is local; `--machine` is control-from-multiple-places, not a shared ledger | `measured` |
| Identity / permissions (Access / run tokens) | no | no: nothing in the ecosystem | `inferred` |
| Heartbeat / offline queuing / capacity gates | no | half: `boardd` has a queue, but not Multica's 15s heartbeat + 3-minute offline + queued runs waiting for return | `inferred` |
| The five IM channels | no | half: Telegram yes (`herdr-telegram-agents`, `herdr-remote`); Feishu/DingTalk/WeCom no | `measured` |

**The four unreachable items are not "nobody has built them yet"; they are "once built, the result is no longer herdr"**: server-side shared ledger, identity and permissions, heartbeat queuing, and multi-tenancy — all four are **platform** properties. herdr is a **single-user local tool** — moving the ledger to a server, issuing run tokens to agents, and having one machine queue for others: once these are built, what you have built is not herdr anymore; it is another Multica. `inferred`

---

## S7 If you want to land it, what to install

Three tiers by "which effect you want" (all `measured` against the 2026-10-01 ecosystem):

1. **Want "drag cards to dispatch + human gates + history"** → `herdr plugin install nelsonPires5/herdr-board`. It ships its own daemon and storage; after install, `herdr plugin action invoke open-board --plugin herdr-board` opens the board. Requires herdr 0.9.0+ / protocol 22, satisfied locally.
2. **Want "one goal pushes multiple parallel threads + who needs you"** → `herdr plugin install eliasstravik/herdr-projects`. This is the Chief shape, and its threads can land on a saved SSH machine (stronger cross-machine support than herdr-board).
3. **Want "manage from a phone"** → stack `herdr-remote` (menu bar / phone / Telegram, free tunnel) or `herdr-telegram-agents` (one Telegram topic per agent).

Three things to watch: the plugin market is a GitHub-topic auto-index (~1,461 entries, 2026-10-01 snapshot), and **the official side states explicitly "Listings aren't reviewed by Herdr"** — review the manifest and scripts before installing; plugins run real agents and burn real model quota; on this machine `herdr plugin list` is currently empty (zero installed).

> [Check-in note 2026-10-03] The "zero installed" above is a 2026-10-01 snapshot: as of 2026-10-03 this machine has herdr-projects installed and enabled (github:eliasstravik/herdr-projects), which this repo's multi-thread orchestration now uses.

---

## S8 Relationship with pacman

In one sentence: **not a competitor, but another arrangement of the same batch of mechanisms.** `inferred`

- pacman (``[[pacman's own coordinates and borrowing list]]``) = **server in the middle**: the server is the control plane, the daemon on registered machines is the execution plane, the ledger is the SQLite in `~/.pacman`, and cross-machine is native.
- herdr-board = **everything on the local machine**: the daemon (`boardd`) lives right next to your terminal, the ledger is in `~/.local/share/herdr-board/`, and cross-machine needs its own solution.
- The load-bearing parts on both sides are actually the same set: **visible panes, agent status recognition, worktree isolation, human gates, agents self-reporting status**. pacman's `StepJournal` (claimed/running/done/failed) and herdr-board's run/column are two notations for the same thing; pacman's `machine` + `claim` long-polling and `boardd`'s queue/dispatch are two notations for the same thing.
- So the practical use of this research for pacman is: **herdr-board can serve as a "lightweight local lane" alongside pacman** — not worth starting a server + enrolling a machine for small jobs; and it can **serve as a ready-made mirror**: it turned the chain "card → column → pane → self-report → gate" into a runnable terminal product, and it is a live sample for pacman to see "how short this chain can be without a server".

---

## Related

- ``[[todos.dev vs Multica comparison]]`` — the first-hand docs foundation for Multica's effect (all Multica-side content here is cited from it)
- ``[[AI agent orchestrator six-way review]]`` — the three-class taxonomy (why herdr and Multica are not the same class)
- ``[[pacman's own coordinates and borrowing list]]`` — pacman's own coordinates and borrowing list
- ``[[herdr feature unlock list]]`` — herdr feature surface × local unlock status (`--machine` half-unlocked, zero plugin installs, etc.)
- ``[[herdr native multi-agent: the claude lane dispatch recipe]]`` — the lane-dispatch form in local use (handwritten script version; herdr-projects is its productization)
- `docs/research/r10-multica-runtime.md` / `r11-runtime-gap.md` — the Multica runtime model and the pacman gap (existing in-repo research-ticket artifacts)

## Sources

- Local herdr measurements (2026-10-01): `herdr --version` / `herdr status` / `herdr --help` / `herdr api schema --json` / `herdr --skill` / `herdr plugin --help` / `herdr machine list --json` / `herdr plugin list --json`
- Plugin README originals (`gh api repos/<owner>/<repo>/readme`): `nelsonPires5/herdr-board`, `eliasstravik/herdr-projects`, `smarzban/tsk`, `aemrebarut/herdr-dagr`, `cloudmanic/herdr-plus`, `miiraheart/herdr-beads`
- Plugin inventory: `gh search repos --topic herdr-plugin --limit 100` (2026-10-01)
- Multica side (cited, not re-verified): wiki ``[[todos.dev vs Multica comparison]]`` (source = a full close-reading of multica.ai's 41 official-doc pages, 2026-09-30)
