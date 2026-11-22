# Design rules on demand (2026-11-20)

Research: `docs/research/2026-11-20-scoped-agent-rules.md` — prior art converges on *harness-side auto-attach on file access* (Cursor `globs`, Claude Code `.claude/rules` `paths:` and lazy nested memory files, Devin lazy subdirectory rules, Amp subtree `AGENTS.md`); the fallback that reaches every harness is text in the brief.

## Problem

`apps/web/DESIGN.md` carries all 78 design-rule rows in one file. A lane either loads the whole file (attention diluted) or none of it (the common case: the dispatcher that writes the brief never reads it), and invents components the rules already forbid.

## Mechanism — one path

**Rule rows are plain text produced by `node scripts/design-rules-for.mjs <paths…>`. They enter a lane's context in two ways, both running the same script:**

1. **The dispatcher pastes them into the brief.** `docs/agent-dispatch-prompts.md` tells the brief author to run the script for the files the task names and paste the output block; `design-cairn`'s brief template carries the block. This is the deterministic channel — it fixes the reported failure.
2. **The lane runs it for the files it actually touches** (brief scope drifts). The instruction lives where each harness already looks, one line each:
   - Claude Code (interactive and lanes): root `CLAUDE.md` → `AGENTS.md`, first paragraph; the `design-cairn` skill body (name+description always loaded, body on invoke).
   - Devin CLI: root `AGENTS.md`; plus the nested `apps/web/AGENTS.md`, which it lazy-loads on first file access under `apps/web/` (verified in the installed Devin docs).
   - pi lanes: root `AGENTS.md` (pi loads cwd+ancestor context files at startup; the worktree root file is loaded) and the pasted brief rows.
   - Amp/other lazy-file harnesses also pick up `apps/web/AGENTS.md` free.

What each harness loads: Claude Code → `CLAUDE.md` (= `AGENTS.md` symlink) + `design-cairn` skill + nested `apps/web/AGENTS.md`; Devin → `AGENTS.md` files; pi → ancestor `AGENTS.md` + the brief; every lane → the brief's pasted rows.

## Storage — split by surface, no duplicated rows

Each rule row lives once, in the `## Rules` section of the surface file that owns it (`docs/design/surfaces/*.md`), next to the long tail that already explains it. The section opens with a machine-readable `Scope:` line of repo-relative path prefixes. `apps/web/DESIGN.md` keeps only the process rows (P1–P6, scope `apps/web/`), the token frontmatter and the which-component table; its `## Rules` section links the layout.

| File | Rows | Scope (prefixes under the repo) |
|---|---|---|
| `apps/web/DESIGN.md` | P1–P6 | `apps/web/` |
| `surfaces/foundation.md` | C1–C7, C12, C15, C19, C21, C23–C25; V1–V23, V25, V27–V30; T1–T4; A1–A4; R1 | `apps/web/` |
| `surfaces/conversation.md` | C8, C11, C13, C14, C16–C18 | `src/chief/`, `src/detail/`, `src/components/chat/`, the home-shell `src/board/` files, `e2e chief-*`/`info-card`/`detail-*`, `test chief-*` |
| `surfaces/tasks.md` | C10 | `src/board/tasks-*`/`task-*`, `src/components/thread/`, `src/detail/`, `e2e detail-*`/`tasks-*` |
| `surfaces/sidebar.md` | L1–L9 | `src/board/sidebar*`/`project-*`/`archive*`, `src/components/shell/`, `e2e sidebar*`/`paper-sidebar`/`board-shell`, `test sidebar*`/`tasks-sections` |
| `surfaces/settings.md` | C20, C22 | `src/settings/`, `src/components/settings/`/`providers/`/`model-select-core`, `src/routes/agent-model-select`, `src/usage/`, `src/resources/`, related e2e/test prefixes |
| `surfaces/first-run.md` | C9 | `src/board/first-run-*`, `e2e first-run-*` |
| `surfaces/computers.md` | V26 | `apps/desktop/src/tray-menu.ts`, `src/board/machines-*`/`computer-*`/`fleet-*`/`desktop-update`, `e2e machines-*` |
| `surfaces/motion.md` | V24 | `apps/web/` |

A path can match several files' scopes — the union of rows is the answer (`src/detail/` is both conversation and tasks). A path under `apps/web/` matching nothing surface-specific still gets the P + foundation rows; a path outside `apps/web/` gets nothing, except `apps/desktop/src/tray-menu.ts`, which gets only the computers rows (V26).

## Row ↔ gate link

The `Check` column moves with its row verbatim; `M` rows still name their spec/test path, which `apps/web/test/anti-slop-foundations.test.ts` already enforces (plus the by-hand list, the 60-word cap, dead source paths). The script prints rows verbatim — a pasted brief carries the gate name with the rule.

## Gates updated, not bypassed

`anti-slop-foundations.test.ts` and `design-skill-routing.test.ts` now read the `## Rules` sections of `apps/web/DESIGN.md` plus every `docs/design/surfaces/*.md`, and additionally pin: every `## Rules` section opens with a `Scope:` line of backticked prefixes; every prefix matches at least one existing repo path (no dead scopes); rule ids are unique across all sections. `scripts/design-rules-for.test.mjs` pins the selection: a `src/chief/` path returns the P/V3/C14 rows and not C20/C22/L1; a `src/settings/` path returns C20/C22 and not C14; a non-web path returns nothing.

## Rejected (kept out of this change)

- **Generated `.claude/rules/*.md` `paths:` stubs** — the deterministic auto-attach for Claude lanes, but a second delivery path whose generated copies can drift from the table; the scope metadata here makes it a later add, not a rewrite.
- **A pi `tool_result` `InlineExtension` in `apps/daemon/src/backend/pi.ts`** — the deterministic pi attach; deferred: it edits the backend seam for what the pasted brief already covers.
- **Per-directory `AGENTS.md` holding rows themselves** — scatters the table and pi never lazy-loads nested files.
- **Stuffing all 79 rows into every brief** — the original problem restated.

## Failure behavior

Script unreadable or file moved → it exits non-zero with the path named; a dead `Scope:` prefix fails the gate test, not the lane; a rule id in two files fails the uniqueness check; a lane that never runs the script still gets the brief's pasted rows, and today's failure mode is unchanged in the worst case.
