# ui-cds-dialogs (PR-5)

Claude Desktop redesign PR-5: dialogs / popovers / menus.

## Changes
- Modals (dialog, alert-dialog, shells): `--edge-radius` **16px**, `--dialog-shadow`, scrim `backdrop-blur-md` (12px)
- Popover / dropdown / select popup: `--radius-popover` **12px** + `--shadow-popover` (dark inset highlight, no outer ring)
- Menu rows: `--cds-radius-sm` **4px**, height **32px**
- User menu: same popover shell (no solid border)
- Search panel: 16px shell; input de-boxed (border/radius 0, transparent)
- Registry: dialog/alert/select stay pristine (S5 ratchet); CDS skin on dialog-shell / alert-dialog-shell adapters + call-site classNames / app.css overlay+select-item rules. popover/dropdown already-deviated entries re-frozen.
- Colors frozen

## Evidence
- `before/` / `after/` screenshots
- `after/metrics-after.json`
- e2e: `cds-dialogs.spec.ts` + visual-polish account popover pin
