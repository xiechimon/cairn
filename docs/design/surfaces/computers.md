# Computers and the tray

The computers panel (`board/machines-panel.tsx`) and the native menu-bar tray menu (`apps/desktop/src/tray-menu.ts`). Reference shots: `docs/design/references/settings/`.

## Rules

Scope: `apps/desktop/src/tray-menu.ts` `apps/web/src/board/machines-` `apps/web/src/board/computer-` `apps/web/src/board/fleet-` `apps/web/src/board/machine-capabilities` `apps/web/e2e/machines-` `apps/web/e2e/machine-` `apps/web/e2e/desktop-update` `apps/web/test/machine-` `apps/web/test/computer-` `apps/web/test/fleet-`

| Id | Rule | Check |
|---|---|---|
| V26 | The tray is one native Electron menu with the operating system's palette, font, accent and keyboard handling and no Cairn styling; no web popover exists, so V2, V3 and V5 do not reach it. | H native tray interaction and capture on macOS |

## Entry

The one entry to the computers panel is the laptop button at the top right of the Coordinator home (the round button on the phone); the sidebar footer carries no computers link. The button carries the fleet state as an 8px badge on its icon's corner (`board/fleet-status.ts`): `running` green when all listed machines are online, `destructive` when some are offline, a hollow ring when none are online — never a colour alone (L2): the tooltip and accessible name name any offline computer. The Coordinator machine's state is in the button's tooltip and accessible name; it dims only while the connection is down. An empty fleet shows no dot and `还没有电脑，点这里添加` points at the button itself.

## Panel

The computers panel is a `SidePanel` on the shared shell (`docs/design/surfaces/chrome.md`): rows and menus follow the tasks/sidebar family, the tracked `SegmentedTabs` and the `text-ui` `ink-1` section labels. Machine and Runner rows carry the same state triple as the fleet badge (glyph or dot, the state word, and the name in the tooltip and accessible description), and a computer's screen share opens the computer screen view (`board/computer-screen.tsx`). Adding a computer or a Runner gives the one-line command to copy, as in the reference.

## Tray menu (V26)

The menu-bar tray is a single native Electron menu (`apps/desktop/src/tray-menu.ts`, data from `apps/desktop/src/tray-data.ts`), not a Cairn page: the operating system draws it, so it takes the system font, accent, light and dark, and its own keyboard handling (arrow keys move, Return picks, Esc closes), with no web window, glass sheet or Cairn styling. It is the one place V2, V3 and V5 do not reach. Research cards that serve another task (`research-before-plan`, `research-stuck`) never show; waiting rows come first, 6 rows at most; then one group per online computer that is running, queueing or strained, its heading carrying one pressure percent and level (the worse of memory pressure and CPU utilization; the load average never decides it) and its rows its stalled, running and queued tasks, 5 at most plus a row counting the rest; tasks on no computer follow under the in-progress heading; a usage row with today's tokens and the tightest Claude window shows once anything ran today. Each group sits under its own heading. (Check: a native tray interaction and capture on macOS.)
