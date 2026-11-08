# Sidebar: brand mark vs. Coordinator row icon (2026-11-08)

Question: the expanded sidebar shows a spiral twice in a row: the brand mark next to "Cairn" in the team row, and the spiral on the "Coordinator" nav row just beneath it. How do reference products separate the brand from the first nav rows, and what does the spiral mean elsewhere in Cairn?

Tags: `实测` = seen this round in a capture, live page or source file; `推断` = derived from what was seen; `猜测` = everything else.

## Reference products

| Product | Header (top-left) | First nav rows | Brand mark repeated in a row? | Source |
|---|---|---|---|---|
| claude.ai | Panel-toggle icon, then the serif "Claude" wordmark; no spark logo in the expanded header (`实测`) | `New` (+), `Search`, `Projects`, `Artifacts`, `Scheduled`, `Design`, `Customize`, each with a plain single-weight outline icon (`实测`) | No. The spark appears in the conversation area (greeting, reply), not in the sidebar (`实测` for the sidebar; `推断` for where the spark lives, from the blurred greeting in the contact sheets) | `docs/research/ui-ux-audit-2026-11-06/R20-claudeai-empty.jpg` (captured 2026-11-06); `<scratch-cache>/cairn-design-capture/review3/claude-ai-shell-1440-{light,dark}-01.png` (2026-11-07); crop: `<scratch-cache>/coord-icon/ref-claude-ai-sidebar-top.png` |
| t3code | Panel-toggle icon, then the "T3 Code" wordmark; no separate logo glyph (`实测`) | A `Search` row with filter / new-project / new-thread icon buttons; then threads (`实测`) | No (`实测`) | `docs/research/ui-ux-audit-2026-11-06/R43-t3code-new-thread-empty.jpg`; crop: `<scratch-cache>/coord-icon/ref-t3code-sidebar-top.png`; https://github.com/pingdotgg/t3code |
| Linear | Workspace avatar + workspace name + chevron (a switcher), search and compose buttons on the right (`实测`, product shot on the home page; the docs say the workspace switcher is the dropdown "in the top left-hand corner") | `Pulse`, `Inbox`, `My issues`, `Reviews`, each with a distinct outline icon (`实测`) | No. The Linear Agent is reached through a chat toolbar and ⌘J, not a sidebar row carrying the Linear logo (`实测` from the docs) | https://linear.app (hero product shot), https://linear.app/docs/conceptual-model, https://linear.app/docs/linear-agent; crop: `<scratch-cache>/coord-icon/ref-linear-sidebar-top.png` |

Pattern across all three (`推断`): the header carries the product identity once (wordmark, or workspace avatar), and nav rows use generic outline icons from one family. None of them repeats the product mark on a nav row. claude.ai, the product Cairn copies one-to-one, does not even show its mark in the expanded sidebar header.

Limits: the built-in browser was signed out of claude.ai this round, so the claude.ai evidence is the 2026-11-06/07 captures, not a live walk (`实测`). The Linear evidence is the marketing product shot, not a signed-in workspace (`实测`); the shot may differ from the current app (`猜测`).

## What the spiral means inside Cairn

| Place | Glyph | What it stands for | Source |
|---|---|---|---|
| Team row (expanded sidebar) | `BrandMark`, a CSS mask of `/logo-mark.svg` (closed spiral) | The product | `apps/web/src/board/sidebar.tsx` `BrandMark` (`实测`) |
| Coordinator nav row and collapsed-rail Coordinator link | `SpiralMark` (open spiral, `SPIRAL_PATH`) | The coordinator | `apps/web/src/board/sidebar.tsx` (`实测`) |
| Chief settings, bound-agent placeholder | `ChiefSpiralFace` (spiral on the green `--fab-surface` disc) | The coordinator agent | `apps/web/src/chief/chief-settings.tsx`, `chief-spiral-face.tsx` (`实测`) |
| Agent avatars, chief message rows | `spiralAvatarUrl` seeded spirals; busy agents trace the spiral | Any agent | `apps/web/src/lib/spiral-avatar.ts`, `components/ui/seeded-avatar.tsx`, `chief/chief-message-rows.tsx` (`实测`) |
| Design gallery | Status-glyph note "the spiral stays for agents"; mobile `PhoneTabBar` specimen uses `SpiralMark` for its Coordinator tab | Agents / coordinator | `apps/web/src/design/components-stone.tsx`, `components-shell.tsx` (`实测`) |
| Empty-state texture | `texture.tsx` `SpiralMark` (a different component with the same name, a dithered texture) | Decoration | `apps/web/src/components/texture/texture.tsx` (`实测`) |
| Chief FAB | Removed: e2e specs assert `.chief-fab` has count 0; `SpiralMark`'s `busy` branch has no caller passing `true` | — | `apps/web/e2e/chief-fab.spec.ts` and four other specs; grep of `SpiralMark` callers (`实测`) |

Reading (`推断`): in Cairn the spiral already means "an agent", and the coordinator is the agent you talk to. The collision is not that the Coordinator row uses a spiral; it is that the brand mark in the header is also a spiral, so the two sit 40 px apart and read as the same thing twice. The collapsed rail has no brand mark, so the spiral appears only once there (`实测`, `baseline-*-rail.png`).

## Options built (throwaway worktree `.claude/worktrees/coord-icon`, not committed)

| Option | Change | Matches claude.ai? | Keeps the spiral = agent meaning? | Cost |
|---|---|---|---|---|
| a | Coordinator row and rail use lucide `MessagesSquare` | Row icon style yes (outline, 1.75 stroke); header still shows a mark claude.ai does not | No: the coordinator loses the agent glyph used by its own settings and avatars | Two lines in `sidebar.tsx` |
| b | Coordinator row and rail use lucide `Network` | Same as a | No; `Network` reads as an org chart or sitemap as much as an orchestrator (`猜测`) | Two lines in `sidebar.tsx` |
| c | Remove `BrandMark` from the expanded team row (wordmark only); row and rail keep `SpiralMark` | Yes for the header: claude.ai's expanded header has no logo glyph | Yes | One line; three e2e specs assert the brand mark in the team row and would need updating (`paper-sidebar.spec.ts`, `accent-typo.spec.ts`, `shell-consistency.spec.ts`) |

Not built: moving the panel toggle to the left of the wordmark as claude.ai does. It is a separate layout change for ian to decide.

Screenshots (1x, light and dark, active Coordinator row with the attention badge at 4, scenario `home-c`, plus the collapsed rail): `<scratch-cache>/coord-icon/{baseline,option-a,option-b,option-c}-{light,dark}[-rail].png`. Patches: `<scratch-cache>/coord-icon/option-{a,b,c}.patch`.
