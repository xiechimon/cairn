# Computers and the tray

The computers panel (`board/machines-panel.tsx`) and the menu-bar tray page (`/tray`, `src/tray/`). Reference shots: `docs/design/references/settings/`.

## Rules

Scope: `apps/web/src/tray/` `apps/web/src/board/machines-` `apps/web/src/board/computer-` `apps/web/src/board/fleet-` `apps/web/src/board/machine-capabilities` `apps/web/e2e/machines-` `apps/web/e2e/machine-` `apps/web/e2e/desktop-update` `apps/web/test/tray-` `apps/web/test/machine-` `apps/web/test/computer-` `apps/web/test/fleet-`

| Id | Rule | Check |
|---|---|---|
| V26 | The `/tray` popover is operating system chrome: system font, system accent, OS light and dark — the one exception to V2, V3 and V5. | H real Mac capture in the `desktop-mac` run |

## Entry

The one entry to the computers panel is the laptop button at the top right of the Coordinator home (the round button on the phone); the sidebar footer carries no computers link. The button carries the fleet state as an 8px badge on its icon's corner (`board/fleet-status.ts`): `running` green when all listed machines are online, `destructive` when some are offline, a hollow ring when none are online — never a colour alone (L2): the tooltip and accessible name name any offline computer. The Coordinator machine's state is in the button's tooltip and accessible name; it dims only while the connection is down. An empty fleet shows no dot and `还没有电脑，点这里添加` points at the button itself.

## Panel

The computers panel is a `SidePanel` on the shared shell (`docs/design/surfaces/chrome.md`): rows and menus follow the tasks/sidebar family, the tracked `SegmentedTabs` and the `text-ui` `ink-1` section labels. Machine and Runner rows carry the same state triple as the fleet badge (glyph or dot, the state word, and the name in the tooltip and accessible description), and a computer's screen share opens the computer screen view (`board/computer-screen.tsx`). Adding a computer or a Runner gives the one-line command to copy, as in the reference.

## Tray page (V26)

The menu bar popover (`/tray`) is operating system chrome, not a Cairn page (it must look and behave like a native tray popover). It is the one exception to V2, V3 and V5: system font at 13px, the system accent for menu highlight and switches that are on, light and dark from the system rather than the Cairn theme, and no fill of its own on macOS, where the window carries Liquid Glass or vibrancy; on Linux it sits on an opaque sheet. Its rows are menu items: 24px, the accent fill on hover and keyboard focus, arrow keys move between them, Esc closes. Research cards that serve another task (`research-before-plan`, `research-stuck`) never show; waiting rows come first, 6 rows at most; then one group per online computer that is running, queueing or strained, its heading carrying memory and load (amber when strained) and its rows its stalled, running and queued tasks, 5 at most plus a row counting the rest; tasks on no computer follow under the in-progress heading; a usage row with today's tokens and the tightest Claude window shows once anything ran today. Each group sits under its own heading. (Check: real Mac capture in the `desktop-mac` run.)
