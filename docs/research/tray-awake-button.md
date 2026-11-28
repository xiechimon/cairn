# Keep-awake disclosure references

| Source | Pattern and decision |
|---|---|
| Cairn [AppKit prototype and menu](../design/native-tray-menu.md), and the owner's before screenshot in `~/Pictures/cairn-review/tray-awake-button/` | Observed: the Runner has a rounded badge, larger target and a second line. Reuse its dimensions, colors and focus treatment; replace the trailing switch check with a disclosure chevron. |
| macOS Control Center Focus, Wi-Fi and Bluetooth | Owner-nominated reference for a round system-colored badge, current mode under the label and a visible path to choices. Pending real-Mac walk; no claims here about Apple's keyboard behavior. |
| Cairn [keep-awake decision](../design/keep-awake-modes.md) | Observed: three modes, AC-only lid mode, power assertion only during work. Keep the mechanics and expose AC unavailability in the opened picker as requested. |
| Existing settings reference set (`docs/design/references/settings/`) | This is OS chrome, not settings; no workflow, style tokens or component borrowed from Amp, t3code, Claude.ai or Linear. |

A native flyout submenu would provide keyboard handling but would split the choices from the tile, contrary to the requested inline placement. Cycling is compact but hides two choices and the AC restriction. Prefer one explicit inline disclosure and test tracking on real AppKit before landing.
