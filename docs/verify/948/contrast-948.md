# #948 overlay/ domain contrast measurement (better-colors, acceptance template v2 item 3)

- Tool: `docs/verify/948/scripts/contrast-948.mjs` (this directory, rerunnable)
- Single token source: `apps/web/src/styles/shadcn.css` (current canon after the #915 value flip)
- Algorithm: WCAG 2.x relative luminance; tint bases = alpha-composited (color-mix rendering equivalent) then measured
- Thresholds: text 4.5:1 (12px/13px regular weight), large text 3:1, non-text (icons/status dots) 3:1
- Pairs: 48 (dark 24 / light 24)
- **FAIL: 0**

| Pair | Theme | Foreground slot | Actual base | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- | --- |
| mention-chip todo | dark | `--spot-text-on-tint` | --spot-soft | 6.73:1 | 4.5 | PASS |
| mention-chip agent | dark | `--chip-done-fg` | --chip-done-bg | 7.84:1 | 4.5 | PASS |
| mention-chip project | dark | `--tile-orange-fg` | --tile-orange-bg | 7.6:1 | 4.5 | PASS |
| mention-chip machine | dark | `--col-dot-building` | --chip-idle-bg | 7.39:1 | 4.5 | PASS |
| mention-chip skill | dark | `--chip-idle-fg` | --chip-idle-bg | 6.55:1 | 4.5 | PASS |
| mention-chip file | dark | `--chip-idle-fg` | --chip-idle-bg | 6.55:1 | 4.5 | PASS |
| mention-icon todo | dark | `--spot-text-on-tint` | 18% tint over --popover-bg | 5.91:1 | 3 | PASS |
| mention-icon skill | dark | `--chip-idle-fg` | 18% tint over --popover-bg | 5.07:1 | 3 | PASS |
| mention-icon agent | dark | `--col-dot-done` | 18% tint over --popover-bg | 5.76:1 | 3 | PASS |
| mention-icon project | dark | `--tile-orange-fg` | 18% tint over --popover-bg | 6.01:1 | 3 | PASS |
| mention-icon machine | dark | `--col-dot-building` | 18% tint over --popover-bg | 5.64:1 | 3 | PASS |
| insert button brand glyph | dark | `--card-button` | --popover-bg | 7.61:1 | 4.5 | PASS |
| delete row ink | dark | `--stop` | --popover-bg | 8.83:1 | 4.5 | PASS |
| delete row hover (danger-soft tint) | dark | `--stop` | --danger-soft over --popover-bg | 6.5:1 | 4.5 | PASS |
| menu icon ink | dark | `--menu-icon` | --popover-bg | 3.46:1 | 3 | PASS |
| body ink on popover | dark | `--text-primary` | --popover-bg | 13.09:1 | 4.5 | PASS |
| secondary ink on surface | dark | `--text-secondary` | --surface | 10.2:1 | 4.5 | PASS |
| tertiary ink on popover | dark | `--text-tertiary` | --popover-bg | 7.25:1 | 4.5 | PASS |
| continue-editing button ink on dialog | dark | `--muted-foreground` | --dialog-bg | 7.25:1 | 4.5 | PASS |
| search input ink on inset | dark | `--text-primary` | --surface-inset | 14.17:1 | 4.5 | PASS |
| in-flight badge on black veil 55% (worst base=white) | dark | `--text-on-veil` | rgb(0 0 0 / 0.55) over white | 4.76:1 | 4.5 | PASS |
| machine dot online | dark | `--col-dot-done` | --surface | 8.49:1 | 3 | PASS |
| machine dot offline | dark | `--col-dot-idle` | --surface | 8.06:1 | 3 | PASS |
| project avatar glyph | dark | `--project-avatar-fg` | --project-avatar-bg | 6.55:1 | 4.5 | PASS |
| mention-chip todo | light | `--spot-text-on-tint` | --spot-soft | 7.63:1 | 4.5 | PASS |
| mention-chip agent | light | `--chip-done-fg` | --chip-done-bg | 8.38:1 | 4.5 | PASS |
| mention-chip project | light | `--tile-orange-fg` | --tile-orange-bg | 5.53:1 | 4.5 | PASS |
| mention-chip machine | light | `--col-dot-building` | --chip-idle-bg | 5.13:1 | 4.5 | PASS |
| mention-chip skill | light | `--chip-idle-fg` | --chip-idle-bg | 5.98:1 | 4.5 | PASS |
| mention-chip file | light | `--chip-idle-fg` | --chip-idle-bg | 5.98:1 | 4.5 | PASS |
| mention-icon todo | light | `--spot-text-on-tint` | 18% tint over --popover-bg | 6.86:1 | 3 | PASS |
| mention-icon skill | light | `--chip-idle-fg` | 18% tint over --popover-bg | 4.89:1 | 3 | PASS |
| mention-icon agent | light | `--col-dot-done` | 18% tint over --popover-bg | 4.04:1 | 3 | PASS |
| mention-icon project | light | `--tile-orange-fg` | 18% tint over --popover-bg | 4.32:1 | 3 | PASS |
| mention-icon machine | light | `--col-dot-building` | 18% tint over --popover-bg | 4.19:1 | 3 | PASS |
| insert button brand glyph | light | `--card-button` | --popover-bg | 6.14:1 | 4.5 | PASS |
| delete row ink | light | `--stop` | --popover-bg | 6.01:1 | 4.5 | PASS |
| delete row hover (danger-soft tint) | light | `--stop` | --danger-soft over --popover-bg | 4.84:1 | 4.5 | PASS |
| menu icon ink | light | `--menu-icon` | --popover-bg | 15.86:1 | 3 | PASS |
| body ink on popover | light | `--text-primary` | --popover-bg | 15.86:1 | 4.5 | PASS |
| secondary ink on surface | light | `--text-secondary` | --surface | 10.72:1 | 4.5 | PASS |
| tertiary ink on popover | light | `--text-tertiary` | --popover-bg | 6.34:1 | 4.5 | PASS |
| continue-editing button ink on dialog | light | `--muted-foreground` | --dialog-bg | 10.72:1 | 4.5 | PASS |
| search input ink on inset | light | `--text-primary` | --surface-inset | 16.71:1 | 4.5 | PASS |
| in-flight badge on black veil 55% (worst base=white) | light | `--text-on-veil` | rgb(0 0 0 / 0.55) over white | 4.76:1 | 4.5 | PASS |
| machine dot online | light | `--col-dot-done` | --surface | 5.23:1 | 3 | PASS |
| machine dot offline | light | `--col-dot-idle` | --surface | 5.54:1 | 3 | PASS |
| project avatar glyph | light | `--project-avatar-fg` | --project-avatar-bg | 4.5:1 | 4.5 | PASS |

All pairs pass the thresholds; the kind identity-color slot mapping (mention-chip.ts header note) is confirmed by measurement.
