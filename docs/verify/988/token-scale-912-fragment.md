```
### 1.5 组件件面实测（真实 shadcn 件消费多槽，量渲染对）

#### 暗模 (dark)

| 组件件面 | 角色对 (fg on bg) | 实测 | 阈值 | 结果 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Switch — unchecked (OFF) | `--foreground on --input` | 8.99:1 | 3 | PASS | thumb on track; OFF track = --input (dark renders bg-input/80 over surface) |
| Switch — checked (ON) | `--primary-foreground on --primary` | 14.08:1 | 3 | PASS | thumb on track |
| Switch — track state flip | `--input on --primary` | 8.99:1 | 3 | PASS | OFF→ON track color = primary state carrier (WCAG 1.4.11) |
| Input — border on page bg | `--input on --background` | 1.57:1 | 1.5 | PASS | field boundary hairline (state also carried by focus ring) |
| Button brand — label on fill | `--text-on-accent on --card-button` | 8.14:1 | 4.5 | PASS | brand solid-fill label |

#### 亮模 (light)

| 组件件面 | 角色对 (fg on bg) | 实测 | 阈值 | 结果 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Switch — unchecked (OFF) | `--background on --input` | 1.52:1 | 3 | below 3 | thumb on track; OFF track = --input (dark renders bg-input/80 over surface) |
| Switch — checked (ON) | `--background on --primary` | 17.03:1 | 3 | PASS | thumb on track |
| Switch — track state flip | `--input on --primary` | 11.19:1 | 3 | PASS | OFF→ON track color = primary state carrier (WCAG 1.4.11) |
| Input — border on page bg | `--input on --background` | 1.52:1 | 1.5 | PASS | field boundary hairline (state also carried by focus ring) |
| Button brand — label on fill | `--text-on-accent on --card-button` | 7.38:1 | 4.5 | PASS | brand solid-fill label |

### 1.6 已退役（#952 唯一解冻窗执行；名字仍留在冻结色板正本里，live 已删）

- `--toggle-track`：retired by #952 (consumer .dlg-toggle died with detail/overlays.css; → shadcn Switch)
- `--toggle-knob`：retired by #952 (consumers .dlg-toggle-knob + secondary.css died; → shadcn Switch)

### 1.7 暗模 (dark) 逐槽映射与实测

| 槽位 | 状态 | 旧值 (shadcn 现行) | 新值 (c.css 定版) | 角色对 (fg on bg) | 实测 | 阈值 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--background` | 不变 | `#1f1b18` | `#1f1b18` | `--foreground on --background` | 14.08:1 | 4.5 | PASS |
| `--foreground` | 不变 | `#eee8e4` | `#eee8e4` | `--foreground on --background` | 14.08:1 | 4.5 | PASS |
| `--card` | 不变 | `#26221f` | `#26221f` | `--card-foreground on --card` | 13:1 | 4.5 | PASS |
| `--card-foreground` | 不变 | `#eee8e4` | `#eee8e4` | `--card-foreground on --card` | 13:1 | 4.5 | PASS |
| `--popover` | 不变 | `#26221f` | `#26221f` | `--popover-foreground on --popover` | 13:1 | 4.5 | PASS |
| `--popover-foreground` | 不变 | `#eee8e4` | `#eee8e4` | `--popover-foreground on --popover` | 13:1 | 4.5 | PASS |
| `--primary` | 不变 | `#eee8e4` | `#eee8e4` | `--primary-foreground on --primary` | 14.08:1 | 4.5 | PASS |
| `--primary-foreground` | 不变 | `#1f1b18` | `#1f1b18` | `--primary-foreground on --primary` | 14.08:1 | 4.5 | PASS |
| `--secondary` | 不变 | `#2d2926` | `#2d2926` | `--secondary-foreground on --secondary` | 11.87:1 | 4.5 | PASS |
| `--secondary-foreground` | 不变 | `#eee8e4` | `#eee8e4` | `--secondary-foreground on --secondary` | 11.87:1 | 4.5 | PASS |
| `--muted` | 不变 | `#2d2926` | `#2d2926` | `--muted-foreground on --muted` | 6.56:1 | 4.5 | PASS |
| `--muted-foreground` | 不变 | `#b3aeaa` | `#b3aeaa` | `--muted-foreground on --background` | 7.78:1 | 4.5 | PASS |
| `--accent` | 不变 | `#2d2926` | `#2d2926` | `--accent-foreground on --accent` | 11.87:1 | 4.5 | PASS |
| `--accent-foreground` | 不变 | `#eee8e4` | `#eee8e4` | `--accent-foreground on --accent` | 11.87:1 | 4.5 | PASS |
| `--destructive` | 不变 | `#ffabb7` | `#ffabb7` | `--destructive-foreground on --destructive` | 7.53:1 | 4.5 | PASS |
| `--destructive-foreground` | 不变 | `#48242a` | `#48242a` | `--destructive-foreground on --destructive` | 7.53:1 | 4.5 | PASS |
| `--border` | 不变 | `#2d2926` | `#2d2926` | `--border on --background` | 1.19:1 | — | report-only |
| `--input` | 不变 | `#403c39` | `#403c39` | `--input on --background` | 1.57:1 | 1.5 | PASS |
| `--ring` | 不变 | `#938e8a` | `#938e8a` | `--ring on --background` | 5.27:1 | 3 | PASS |
| `--column` | 不变 | `#1f1b18` | `#1f1b18` | `--foreground on --column` | 14.08:1 | 4.5 | PASS |
| `--col-bg` | 不变 | `#1f1b18` | `#1f1b18` | `--foreground on --col-bg` | 14.08:1 | 4.5 | PASS |
| `--col-head-text` | 不变 | `#d3ceca` | `#d3ceca` | `--col-head-text on --col-bg` | 10.95:1 | 4.5 | PASS |
| `--sidebar-hover` | 不变 | `rgb(255 252 248 / 0.05)` | `rgb(255 252 248 / 0.05)` | `--sidebar-hover on --surface` | 1.16:1 | — | report-only |
| `--sidebar-active` | 不变 | `rgb(255 252 248 / 0.1)` | `rgb(255 252 248 / 0.1)` | `--sidebar-active on --surface` | 1.36:1 | — | report-only |
| `--surface` | 不变 | `#26221f` | `#26221f` | `--foreground on --surface` | 13:1 | 4.5 | PASS |
| `--surface-secondary` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --surface-secondary` | 11.87:1 | 4.5 | PASS |
| `--surface-tertiary` | 不变 | `#403c39` | `#403c39` | `--foreground on --surface-tertiary` | 8.99:1 | 4.5 | PASS |
| `--surface-elevated` | 不变 | `#26221f` | `#26221f` | `--foreground on --surface-elevated` | 13:1 | 4.5 | PASS |
| `--surface-hover` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --surface-hover` | 11.87:1 | 4.5 | PASS |
| `--surface-press` | 不变 | `#403c39` | `#403c39` | `--foreground on --surface-press` | 8.99:1 | 4.5 | PASS |
| `--text-secondary` | 不变 | `#d3ceca` | `#d3ceca` | `--text-secondary on --background` | 10.95:1 | 4.5 | PASS |
| `--text-tertiary` | 不变 | `#b3aeaa` | `#b3aeaa` | `--text-tertiary on --background` | 7.78:1 | 4.5 | PASS |
| `--text-dim` | 不变 | `#797571` | `#797571` | `--text-dim on --background` | 3.74:1 | 3 | PASS |
| `--border-default` | 不变 | `#2d2926` | `#2d2926` | `--border-default on --background` | 1.19:1 | — | report-only |
| `--border-strong` | 不变 | `#403c39` | `#403c39` | `--border-strong on --background` | 1.57:1 | 1.5 | PASS |
| `--card-button` | 不变 | `#f294d8` | `#f294d8` | `--text-on-accent on --card-button` | 8.14:1 | 4.5 | PASS |
| `--text-on-accent` | 不变 | `#1f1b18` | `#1f1b18` | `--text-on-accent on --card-button` | 8.14:1 | 4.5 | PASS |
| `--focus-ring` | 不变 | `#f294d8` | `#f294d8` | `--focus-ring on --background` | 8.14:1 | 3 | PASS |
| `--col-dot-idle` | 不变 | `#c4b6ab` | `#c4b6ab` | `--col-dot-idle on --background` | 8.65:1 | 3 | PASS |
| `--col-dot-confirm` | 不变 | `#eea953` | `#eea953` | `--col-dot-confirm on --background` | 8.5:1 | — | report-only |
| `--col-dot-building` | 不变 | `#63c4ff` | `#63c4ff` | `--col-dot-building on --background` | 8.85:1 | 3 | PASS |
| `--col-dot-done` | 不变 | `#77d08c` | `#77d08c` | `--col-dot-done on --background` | 9.11:1 | 3 | PASS |
| `--badge-attention` | 不变 | `#eea953` | `#eea953` | `--badge-attention-fg on --badge-attention` | 6.59:1 | 4.5 | PASS |
| `--badge-attention-fg` | 不变 | `#422b0d` | `#422b0d` | `--badge-attention-fg on --badge-attention` | 6.59:1 | 4.5 | PASS |
| `--badge-done` | 不变 | `#77d08c` | `#77d08c` | `--badge-done on --background` | 9.11:1 | 3 | PASS |
| `--badge-idle` | 不变 | `#c4b6ab` | `#c4b6ab` | `--badge-idle on --background` | 8.65:1 | 3 | PASS |
| `--project-avatar-bg` | 不变 | `#ff9c75` | `#ff9c75` | `--project-avatar-fg on --project-avatar-bg` | 6.58:1 | 4.5 | PASS |
| `--project-avatar-fg` | 不变 | `#472619` | `#472619` | `--project-avatar-fg on --project-avatar-bg` | 6.58:1 | 4.5 | PASS |
| `--agent-avatar-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --agent-avatar-bg` | 11.87:1 | 4.5 | PASS |
| `--chip-idle-bg` | 不变 | `#2d2926` | `#2d2926` | `--chip-idle-fg on --chip-idle-bg` | 6.56:1 | 4.5 | PASS |
| `--chip-idle-fg` | 不变 | `#b3aeaa` | `#b3aeaa` | `--chip-idle-fg on --chip-idle-bg` | 6.56:1 | 4.5 | PASS |
| `--chip-plan-bg` | 不变 | `#433239` | `#433239` | `--chip-plan-fg on --chip-plan-bg` | 6.62:1 | 4.5 | PASS |
| `--chip-plan-fg` | 不变 | `#f8a7e1` | `#f8a7e1` | `--chip-plan-fg on --chip-plan-bg` | 6.62:1 | 4.5 | PASS |
| `--chip-confirm-bg` | 不变 | `#422b0d` | `#422b0d` | `--chip-confirm-fg on --chip-confirm-bg` | 7.6:1 | 4.5 | PASS |
| `--chip-confirm-fg` | 不变 | `#f4b973` | `#f4b973` | `--chip-confirm-fg on --chip-confirm-bg` | 7.6:1 | 4.5 | PASS |
| `--chip-done-bg` | 不变 | `#1a3821` | `#1a3821` | `--chip-done-fg on --chip-done-bg` | 7.8:1 | 4.5 | PASS |
| `--chip-done-fg` | 不变 | `#90daa0` | `#90daa0` | `--chip-done-fg on --chip-done-bg` | 7.8:1 | 4.5 | PASS |
| `--chip-failed-bg` | 不变 | `#48242a` | `#48242a` | `--chip-failed-fg on --chip-failed-bg` | 7.53:1 | 4.5 | PASS |
| `--chip-failed-fg` | 不变 | `#ffabb7` | `#ffabb7` | `--chip-failed-fg on --chip-failed-bg` | 7.53:1 | 4.5 | PASS |
| `--fail-fg` | 不变 | `#ffb091` | `#ffb091` | `--fail-fg on --card` | 8.92:1 | 4.5 | PASS |
| `--seg-active` | 不变 | `#403c39` | `#403c39` | `--foreground on --seg-active` | 8.99:1 | 4.5 | PASS |
| `--seg-hover` | 不变 | `rgb(255 252 248 / 0.05)` | `rgb(255 252 248 / 0.05)` | `--seg-hover on --surface` | 1.16:1 | — | report-only |
| `--tab-chip-bg` | 不变 | `#26221f` | `#26221f` | `--foreground on --tab-chip-bg` | 13:1 | 4.5 | PASS |
| `--stop` | 不变 | `#ffabb7` | `#ffabb7` | `--stop on --background` | 9.58:1 | 3 | PASS |
| `--diff-add-bg` | 不变 | `#1a3821` | `#1a3821` | `--diff-add-fg on --diff-add-bg` | 5.96:1 | 4.5 | PASS |
| `--diff-add-fg` | 不变 | `#6ac380` | `#6ac380` | `--diff-add-fg on --diff-add-bg` | 5.96:1 | 4.5 | PASS |
| `--diff-del-bg` | 不变 | `#48242a` | `#48242a` | `--destructive on --diff-del-bg` | 7.53:1 | 4.5 | PASS |
| `--dialog-bg` | 不变 | `#26221f` | `#26221f` | `--foreground on --dialog-bg` | 13:1 | 4.5 | PASS |
| `--dialog-box-bg` | 不变 | `#26221f` | `#26221f` | `--foreground on --dialog-box-bg` | 13:1 | 4.5 | PASS |
| `--dialog-row-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --dialog-row-bg` | 11.87:1 | 4.5 | PASS |
| `--dialog-ring` | 不变 | `#403c39` | `#403c39` | `--dialog-ring on --dialog-bg` | 1.45:1 | — | report-only |
| `--range-chip-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --range-chip-bg` | 11.87:1 | 4.5 | PASS |
| `--range-chip-border` | 不变 | `#403c39` | `#403c39` | `--range-chip-border on --range-chip-bg` | 1.32:1 | — | report-only |
| `--tile-orange-bg` | 不变 | `#422b0d` | `#422b0d` | `--tile-orange-fg on --tile-orange-bg` | 7.6:1 | 4.5 | PASS |
| `--tile-orange-fg` | 不变 | `#f4b973` | `#f4b973` | `--tile-orange-fg on --tile-orange-bg` | 7.6:1 | 4.5 | PASS |
| `--tile-indigo-bg` | 不变 | `#433239` | `#433239` | `--tile-indigo-fg on --tile-indigo-bg` | 6.62:1 | 4.5 | PASS |
| `--tile-indigo-fg` | 不变 | `#f8a7e1` | `#f8a7e1` | `--tile-indigo-fg on --tile-indigo-bg` | 6.62:1 | 4.5 | PASS |
| `--tile-hero-bg` | 不变 | `#422b0d` | `#422b0d` | `--foreground on --tile-hero-bg` | 10.93:1 | 4.5 | PASS |
| `--pill-idle-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --pill-idle-bg` | 11.87:1 | 4.5 | PASS |
| `--dash-border` | 不变 | `#403c39` | `#403c39` | `--dash-border on --surface` | 1.45:1 | — | report-only |
| `--row-selected` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --row-selected` | 11.87:1 | 4.5 | PASS |
| `--row-icon-bg` | 不变 | `#403c39` | `#403c39` | `--foreground on --row-icon-bg` | 8.99:1 | 4.5 | PASS |
| `--overlay-divider` | 不变 | `#2d2926` | `#2d2926` | `--overlay-divider on --popover` | 1.09:1 | — | report-only |
| `--overlay-select-indigo` | 不变 | `#433239` | `#433239` | `--spot-text-on-tint on --overlay-select-indigo` | 6.62:1 | 4.5 | PASS |
| `--pick-selected-bg` | 不变 | `#433239` | `#433239` | `--pick-selected-fg on --pick-selected-bg` | 6.62:1 | 4.5 | PASS |
| `--pick-selected-fg` | 不变 | `#f8a7e1` | `#f8a7e1` | `--pick-selected-fg on --pick-selected-bg` | 6.62:1 | 4.5 | PASS |
| `--chief-tab-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --chief-tab-bg` | 11.87:1 | 4.5 | PASS |
| `--chief-tab-active` | 不变 | `#403c39` | `#403c39` | `--foreground on --chief-tab-active` | 8.99:1 | 4.5 | PASS |
| `--notify-icon-bg` | 不变 | `#403c39` | `#403c39` | `--card-button on --notify-icon-bg` | 5.2:1 | 3 | PASS |
| `--menu-icon` | 不变 | `#797571` | `#797571` | `--menu-icon on --popover` | 3.45:1 | 3 | PASS |
| `--overlay-scrim` | 不变 | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `--overlay-scrim on --background` | 1.15:1 | — | report-only |
| `--text-on-veil` | 不变 | `#ffffff` | `#ffffff` | `--text-on-veil on --overlay-scrim` | 19.67:1 | 4.5 | PASS |
| `--spot-soft` | 不变 | `#433239` | `#433239` | `--spot-text-on-tint on --spot-soft` | 6.62:1 | 4.5 | PASS |
| `--accent-soft` | 不变 | `rgb(242 148 216 / 0.14)` | `rgb(242 148 216 / 0.14)` | `--accent-soft on --surface` | 1.32:1 | — | report-only |
| `--danger-soft` | 不变 | `rgb(255 171 183 / 0.14)` | `rgb(255 171 183 / 0.14)` | `--danger-soft on --surface` | 1.36:1 | — | report-only |
| `--spot-text-on-tint` | 不变 | `#f8a7e1` | `#f8a7e1` | `--spot-text-on-tint on --spot-soft` | 6.62:1 | 4.5 | PASS |
| `--spot-disabled` | 不变 | `#a0668e` | `#a0668e` | `--spot-disabled-fg on --spot-disabled` | 2.72:1 | — | report-only |
| `--spot-disabled-fg` | 不变 | `#f7b9e6` | `#f7b9e6` | `--spot-disabled-fg on --spot-disabled` | 2.72:1 | — | report-only |
| `--primary-disabled` | 不变 | `#a0668e` | `#a0668e` | `--spot-disabled-fg on --primary-disabled` | 2.72:1 | — | report-only |
| `--drop-tint-border` | 不变 | `#f294d8` | `#f294d8` | `--drop-tint-border on --column` | 8.14:1 | 3 | PASS |
| `--drop-tint-base` | 不变 | `rgb(242 148 216 / 0.05)` | `rgb(242 148 216 / 0.05)` | `--drop-tint-base on --column` | 1.09:1 | — | report-only |
| `--drop-tint-hover` | 不变 | `rgb(242 148 216 / 0.1)` | `rgb(242 148 216 / 0.1)` | `--drop-tint-hover on --column` | 1.2:1 | — | report-only |
| `--surface-inset` | 不变 | `#1f1b18` | `#1f1b18` | `--foreground on --surface-inset` | 14.08:1 | 4.5 | PASS |
| `--card-bg` | 不变 | `#26221f` | `#26221f` | `--card-foreground on --card-bg` | 13:1 | 4.5 | PASS |
| `--popover-bg` | 不变 | `#26221f` | `#26221f` | `--popover-foreground on --popover-bg` | 13:1 | 4.5 | PASS |
| `--text-primary` | 不变 | `#eee8e4` | `#eee8e4` | `--text-primary on --background` | 14.08:1 | 4.5 | PASS |
| `--code-bg` | 不变 | `#2d2926` | `#2d2926` | `--foreground on --code-bg` | 11.87:1 | 4.5 | PASS |
| `--danger` | 不变 | `#ffabb7` | `#ffabb7` | `--danger on --background` | 9.58:1 | 3 | PASS |
| `--card-border` | 不变 | `#2d2926` | `#2d2926` | `--card-border on --card` | 1.09:1 | — | report-only |

### 1.8 亮模 (light) 逐槽映射与实测

| 槽位 | 状态 | 旧值 (shadcn 现行) | 新值 (c.css 定版) | 角色对 (fg on bg) | 实测 | 阈值 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--background` | 不变 | `#f6f1ec` | `#f6f1ec` | `--foreground on --background` | 17.03:1 | 4.5 | PASS |
| `--foreground` | 不变 | `#120f0b` | `#120f0b` | `--foreground on --background` | 17.03:1 | 4.5 | PASS |
| `--card` | 不变 | `#f0ebe6` | `#f0ebe6` | `--card-foreground on --card` | 16.14:1 | 4.5 | PASS |
| `--card-foreground` | 不变 | `#120f0b` | `#120f0b` | `--card-foreground on --card` | 16.14:1 | 4.5 | PASS |
| `--popover` | 不变 | `#f0ebe6` | `#f0ebe6` | `--popover-foreground on --popover` | 16.14:1 | 4.5 | PASS |
| `--popover-foreground` | 不变 | `#120f0b` | `#120f0b` | `--popover-foreground on --popover` | 16.14:1 | 4.5 | PASS |
| `--primary` | 不变 | `#120f0b` | `#120f0b` | `--primary-foreground on --primary` | 18.31:1 | 4.5 | PASS |
| `--primary-foreground` | 不变 | `#fafafa` | `#fafafa` | `--primary-foreground on --primary` | 18.31:1 | 4.5 | PASS |
| `--secondary` | 不变 | `#eae4e0` | `#eae4e0` | `--secondary-foreground on --secondary` | 15.17:1 | 4.5 | PASS |
| `--secondary-foreground` | 不变 | `#120f0b` | `#120f0b` | `--secondary-foreground on --secondary` | 15.17:1 | 4.5 | PASS |
| `--muted` | 不变 | `#eae4e0` | `#eae4e0` | `--muted-foreground on --muted` | 10.09:1 | 4.5 | PASS |
| `--muted-foreground` | 不变 | `#36322e` | `#36322e` | `--muted-foreground on --background` | 11.32:1 | 4.5 | PASS |
| `--accent` | 不变 | `#eae4e0` | `#eae4e0` | `--accent-foreground on --accent` | 15.17:1 | 4.5 | PASS |
| `--accent-foreground` | 不变 | `#120f0b` | `#120f0b` | `--accent-foreground on --accent` | 15.17:1 | 4.5 | PASS |
| `--destructive` | 不变 | `#9e2c49` | `#9e2c49` | `--destructive-foreground on --destructive` | 7.22:1 | 4.5 | PASS |
| `--destructive-foreground` | 不变 | `#ffffff` | `#ffffff` | `--destructive-foreground on --destructive` | 7.22:1 | 4.5 | PASS |
| `--border` | 不变 | `#eae4e0` | `#eae4e0` | `--border on --background` | 1.12:1 | — | report-only |
| `--input` | 不变 | `#cbc5c1` | `#cbc5c1` | `--input on --background` | 1.52:1 | 1.5 | PASS |
| `--ring` | 不变 | `#8f8985` | `#8f8985` | `--ring on --background` | 3.08:1 | 3 | PASS |
| `--column` | 不变 | `#f6f1ec` | `#f6f1ec` | `--foreground on --column` | 17.03:1 | 4.5 | PASS |
| `--col-bg` | 不变 | `#f6f1ec` | `#f6f1ec` | `--foreground on --col-bg` | 17.03:1 | 4.5 | PASS |
| `--col-head-text` | 不变 | `#595450` | `#595450` | `--col-head-text on --col-bg` | 6.66:1 | 4.5 | PASS |
| `--sidebar-hover` | 不变 | `rgb(28 25 21 / 0.05)` | `rgb(28 25 21 / 0.05)` | `--sidebar-hover on --surface` | 1.1:1 | — | report-only |
| `--sidebar-active` | 不变 | `rgb(28 25 21 / 0.1)` | `rgb(28 25 21 / 0.1)` | `--sidebar-active on --surface` | 1.22:1 | — | report-only |
| `--surface` | 不变 | `#f0ebe6` | `#f0ebe6` | `--foreground on --surface` | 16.14:1 | 4.5 | PASS |
| `--surface-secondary` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --surface-secondary` | 15.17:1 | 4.5 | PASS |
| `--surface-tertiary` | 不变 | `#e2dcd7` | `#e2dcd7` | `--foreground on --surface-tertiary` | 14.06:1 | 4.5 | PASS |
| `--surface-elevated` | 不变 | `#f0ebe6` | `#f0ebe6` | `--foreground on --surface-elevated` | 16.14:1 | 4.5 | PASS |
| `--surface-hover` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --surface-hover` | 15.17:1 | 4.5 | PASS |
| `--surface-press` | 不变 | `#e2dcd7` | `#e2dcd7` | `--foreground on --surface-press` | 14.06:1 | 4.5 | PASS |
| `--text-secondary` | 不变 | `#36322e` | `#36322e` | `--text-secondary on --background` | 11.32:1 | 4.5 | PASS |
| `--text-tertiary` | 不变 | `#595450` | `#595450` | `--text-tertiary on --background` | 6.66:1 | 4.5 | PASS |
| `--text-dim` | 不变 | `#8f8985` | `#8f8985` | `--text-dim on --background` | 3.08:1 | 3 | PASS |
| `--border-default` | 不变 | `#eae4e0` | `#eae4e0` | `--border-default on --background` | 1.12:1 | — | report-only |
| `--border-strong` | 不变 | `#cbc5c1` | `#cbc5c1` | `--border-strong on --background` | 1.52:1 | 1.5 | PASS |
| `--card-button` | 不变 | `#97227e` | `#97227e` | `--text-on-accent on --card-button` | 7.38:1 | 4.5 | PASS |
| `--text-on-accent` | 不变 | `#ffffff` | `#ffffff` | `--text-on-accent on --card-button` | 7.38:1 | 4.5 | PASS |
| `--focus-ring` | 不变 | `#97227e` | `#97227e` | `--focus-ring on --background` | 6.57:1 | 3 | PASS |
| `--col-dot-idle` | 不变 | `#67594d` | `#67594d` | `--col-dot-idle on --background` | 6.01:1 | 3 | PASS |
| `--col-dot-confirm` | 不变 | `#faab3f` | `#faab3f` | `--col-dot-confirm on --background` | 1.71:1 | — | report-only |
| `--col-dot-building` | 不变 | `#006390` | `#006390` | `--col-dot-building on --background` | 5.87:1 | 3 | PASS |
| `--col-dot-done` | 不变 | `#007031` | `#007031` | `--col-dot-done on --background` | 5.57:1 | 3 | PASS |
| `--badge-attention` | 不变 | `#faab3f` | `#faab3f` | `--badge-attention-fg on --badge-attention` | 6.46:1 | 4.5 | PASS |
| `--badge-attention-fg` | 不变 | `#4c2e00` | `#4c2e00` | `--badge-attention-fg on --badge-attention` | 6.46:1 | 4.5 | PASS |
| `--badge-done` | 不变 | `#007031` | `#007031` | `--badge-done on --background` | 5.57:1 | 3 | PASS |
| `--badge-idle` | 不变 | `#67594d` | `#67594d` | `--badge-idle on --background` | 6.01:1 | 3 | PASS |
| `--project-avatar-bg` | 不变 | `#cd6033` | `#cd6033` | `--project-avatar-fg on --project-avatar-bg` | 4.51:1 | 4.5 | PASS |
| `--project-avatar-fg` | 不变 | `#310b00` | `#310b00` | `--project-avatar-fg on --project-avatar-bg` | 4.51:1 | 4.5 | PASS |
| `--agent-avatar-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --agent-avatar-bg` | 15.17:1 | 4.5 | PASS |
| `--chip-idle-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--chip-idle-fg on --chip-idle-bg` | 5.94:1 | 4.5 | PASS |
| `--chip-idle-fg` | 不变 | `#595450` | `#595450` | `--chip-idle-fg on --chip-idle-bg` | 5.94:1 | 4.5 | PASS |
| `--chip-plan-bg` | 不变 | `#e4cfd7` | `#e4cfd7` | `--chip-plan-fg on --chip-plan-bg` | 7.74:1 | 4.5 | PASS |
| `--chip-plan-fg` | 不变 | `#661955` | `#661955` | `--chip-plan-fg on --chip-plan-bg` | 7.74:1 | 4.5 | PASS |
| `--chip-confirm-bg` | 不变 | `#ffe5c8` | `#ffe5c8` | `--chip-confirm-fg on --chip-confirm-bg` | 5.53:1 | 4.5 | PASS |
| `--chip-confirm-fg` | 不变 | `#825100` | `#825100` | `--chip-confirm-fg on --chip-confirm-bg` | 5.53:1 | 4.5 | PASS |
| `--chip-done-bg` | 不变 | `#c3f5cc` | `#c3f5cc` | `--chip-done-fg on --chip-done-bg` | 8.4:1 | 4.5 | PASS |
| `--chip-done-fg` | 不变 | `#004c1f` | `#004c1f` | `--chip-done-fg on --chip-done-bg` | 8.4:1 | 4.5 | PASS |
| `--chip-failed-bg` | 不变 | `#ffdce0` | `#ffdce0` | `--chip-failed-fg on --chip-failed-bg` | 8.88:1 | 4.5 | PASS |
| `--chip-failed-fg` | 不变 | `#6b1f31` | `#6b1f31` | `--chip-failed-fg on --chip-failed-bg` | 8.88:1 | 4.5 | PASS |
| `--fail-fg` | 不变 | `#823a1c` | `#823a1c` | `--fail-fg on --card` | 6.9:1 | 4.5 | PASS |
| `--seg-active` | 不变 | `#e2dcd7` | `#e2dcd7` | `--foreground on --seg-active` | 14.06:1 | 4.5 | PASS |
| `--seg-hover` | 不变 | `rgb(28 25 21 / 0.05)` | `rgb(28 25 21 / 0.05)` | `--seg-hover on --surface` | 1.1:1 | — | report-only |
| `--tab-chip-bg` | 不变 | `#f0ebe6` | `#f0ebe6` | `--foreground on --tab-chip-bg` | 16.14:1 | 4.5 | PASS |
| `--stop` | 不变 | `#9e2c49` | `#9e2c49` | `--stop on --background` | 6.43:1 | 3 | PASS |
| `--diff-add-bg` | 不变 | `#c3f5cc` | `#c3f5cc` | `--diff-add-fg on --diff-add-bg` | 6.47:1 | 4.5 | PASS |
| `--diff-add-fg` | 不变 | `#005f28` | `#005f28` | `--diff-add-fg on --diff-add-bg` | 6.47:1 | 4.5 | PASS |
| `--diff-del-bg` | 不变 | `#ffdce0` | `#ffdce0` | `--destructive on --diff-del-bg` | 5.69:1 | 4.5 | PASS |
| `--dialog-bg` | 不变 | `#f0ebe6` | `#f0ebe6` | `--foreground on --dialog-bg` | 16.14:1 | 4.5 | PASS |
| `--dialog-box-bg` | 不变 | `#f0ebe6` | `#f0ebe6` | `--foreground on --dialog-box-bg` | 16.14:1 | 4.5 | PASS |
| `--dialog-row-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --dialog-row-bg` | 15.17:1 | 4.5 | PASS |
| `--dialog-ring` | 不变 | `#cbc5c1` | `#cbc5c1` | `--dialog-ring on --dialog-bg` | 1.44:1 | — | report-only |
| `--range-chip-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --range-chip-bg` | 15.17:1 | 4.5 | PASS |
| `--range-chip-border` | 不变 | `#cbc5c1` | `#cbc5c1` | `--range-chip-border on --range-chip-bg` | 1.36:1 | — | report-only |
| `--tile-orange-bg` | 不变 | `#ffe5c8` | `#ffe5c8` | `--tile-orange-fg on --tile-orange-bg` | 5.53:1 | 4.5 | PASS |
| `--tile-orange-fg` | 不变 | `#825100` | `#825100` | `--tile-orange-fg on --tile-orange-bg` | 5.53:1 | 4.5 | PASS |
| `--tile-indigo-bg` | 不变 | `#e4cfd7` | `#e4cfd7` | `--tile-indigo-fg on --tile-indigo-bg` | 7.74:1 | 4.5 | PASS |
| `--tile-indigo-fg` | 不变 | `#661955` | `#661955` | `--tile-indigo-fg on --tile-indigo-bg` | 7.74:1 | 4.5 | PASS |
| `--tile-hero-bg` | 不变 | `#ffd099` | `#ffd099` | `--foreground on --tile-hero-bg` | 13.41:1 | 4.5 | PASS |
| `--pill-idle-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --pill-idle-bg` | 15.17:1 | 4.5 | PASS |
| `--dash-border` | 不变 | `#cbc5c1` | `#cbc5c1` | `--dash-border on --surface` | 1.44:1 | — | report-only |
| `--row-selected` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --row-selected` | 15.17:1 | 4.5 | PASS |
| `--row-icon-bg` | 不变 | `#e2dcd7` | `#e2dcd7` | `--foreground on --row-icon-bg` | 14.06:1 | 4.5 | PASS |
| `--overlay-divider` | 不变 | `#eae4e0` | `#eae4e0` | `--overlay-divider on --popover` | 1.06:1 | — | report-only |
| `--overlay-select-indigo` | 不变 | `#e4cfd7` | `#e4cfd7` | `--spot-text-on-tint on --overlay-select-indigo` | 7.74:1 | 4.5 | PASS |
| `--pick-selected-bg` | 不变 | `#e4cfd7` | `#e4cfd7` | `--pick-selected-fg on --pick-selected-bg` | 7.74:1 | 4.5 | PASS |
| `--pick-selected-fg` | 不变 | `#661955` | `#661955` | `--pick-selected-fg on --pick-selected-bg` | 7.74:1 | 4.5 | PASS |
| `--chief-tab-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --chief-tab-bg` | 15.17:1 | 4.5 | PASS |
| `--chief-tab-active` | 不变 | `#e2dcd7` | `#e2dcd7` | `--foreground on --chief-tab-active` | 14.06:1 | 4.5 | PASS |
| `--notify-icon-bg` | 不变 | `#e4cfd7` | `#e4cfd7` | `--card-button on --notify-icon-bg` | 4.99:1 | 3 | PASS |
| `--menu-icon` | 不变 | `#120f0b` | `#120f0b` | `--menu-icon on --popover` | 16.14:1 | 3 | PASS |
| `--overlay-scrim` | 不变 | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `--overlay-scrim on --background` | 5.58:1 | — | report-only |
| `--text-on-veil` | 不变 | `#ffffff` | `#ffffff` | `--text-on-veil on --overlay-scrim` | 6.26:1 | 4.5 | PASS |
| `--spot-soft` | 不变 | `#e4cfd7` | `#e4cfd7` | `--spot-text-on-tint on --spot-soft` | 7.74:1 | 4.5 | PASS |
| `--accent-soft` | 不变 | `rgb(151 34 126 / 0.14)` | `rgb(151 34 126 / 0.14)` | `--accent-soft on --surface` | 1.25:1 | — | report-only |
| `--danger-soft` | 不变 | `rgb(158 44 73 / 0.14)` | `rgb(158 44 73 / 0.14)` | `--danger-soft on --surface` | 1.24:1 | — | report-only |
| `--spot-text-on-tint` | 不变 | `#661955` | `#661955` | `--spot-text-on-tint on --spot-soft` | 7.74:1 | 4.5 | PASS |
| `--spot-disabled` | 不变 | `#bb72a8` | `#bb72a8` | `--spot-disabled-fg on --spot-disabled` | 3.45:1 | — | report-only |
| `--spot-disabled-fg` | 不变 | `#ffffff` | `#ffffff` | `--spot-disabled-fg on --spot-disabled` | 3.45:1 | — | report-only |
| `--primary-disabled` | 不变 | `#bb72a8` | `#bb72a8` | `--spot-disabled-fg on --primary-disabled` | 3.45:1 | — | report-only |
| `--drop-tint-border` | 不变 | `#97227e` | `#97227e` | `--drop-tint-border on --column` | 6.57:1 | 3 | PASS |
| `--drop-tint-base` | 不变 | `rgb(151 34 126 / 0.05)` | `rgb(151 34 126 / 0.05)` | `--drop-tint-base on --column` | 1.08:1 | — | report-only |
| `--drop-tint-hover` | 不变 | `rgb(151 34 126 / 0.1)` | `rgb(151 34 126 / 0.1)` | `--drop-tint-hover on --column` | 1.17:1 | — | report-only |
| `--surface-inset` | 不变 | `#f6f1ec` | `#f6f1ec` | `--foreground on --surface-inset` | 17.03:1 | 4.5 | PASS |
| `--card-bg` | 不变 | `#f0ebe6` | `#f0ebe6` | `--card-foreground on --card-bg` | 16.14:1 | 4.5 | PASS |
| `--popover-bg` | 不变 | `#f0ebe6` | `#f0ebe6` | `--popover-foreground on --popover-bg` | 16.14:1 | 4.5 | PASS |
| `--text-primary` | 不变 | `#120f0b` | `#120f0b` | `--text-primary on --background` | 17.03:1 | 4.5 | PASS |
| `--code-bg` | 不变 | `#eae4e0` | `#eae4e0` | `--foreground on --code-bg` | 15.17:1 | 4.5 | PASS |
| `--danger` | 不变 | `#9e2c49` | `#9e2c49` | `--danger on --background` | 6.43:1 | 3 | PASS |
| `--card-border` | 不变 | `#eae4e0` | `#eae4e0` | `--card-border on --card` | 1.06:1 | — | report-only |


```
