```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-08T14:09:31.988Z · commit `d62bc480` · port 8397 · playwright 1.63.0 · workers 4

Specs: chief-panel chief-stream-markdown chief-send-fallback chief-composer-tools chief-drawer-slash chief-drawer-model chief-fab chief-settings agent-identity-chip (9 files) · tests 101 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 25 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 23 | 24 |
| .boundingBox() call sites | 24 | 24 |
| .toHaveCSS() call sites | 2 | 2 |
| visual-matcher assertion sites | 118 | 140 joined |

Comparison rows: 119 — KEPT 119, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (119)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| agent-identity-chip.spec.ts | 61 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 62 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 66 | toBe | 12px | 12px | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 74 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| agent-identity-chip.spec.ts | 75 | toBe | pointer | pointer | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| chief-composer-tools.spec.ts | 333 | toBeLessThanOrEqual | ≤ 602 | 596 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 335 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 336 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 408 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 414 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 439 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 441 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 446 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-drawer-model.spec.ts | 59 | toBeLessThanOrEqual | ≤ 2 | 0.15625 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 60 | toBeLessThanOrEqual | ≤ 2 | 0 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 61 | toBeGreaterThanOrEqual | ≥ 1052 | 1065 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 62 | toBeLessThanOrEqual | ≤ 1432 | 1345 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 110 | toBeGreaterThanOrEqual | ≥ 4.5 | 6.632010330240887 | — | the selected model row is readable in both themes (#751 A) |
| chief-drawer-model.spec.ts | 111 | not.toBe | rgba(0, 0, 0, 0) | rgb(67, 50, 57) | color(srgb …) folded to rgb(67, 50, 57); re-pin the spec to the rgb/hex form (#411) | the selected model row is readable in both themes (#751 A) |
| chief-drawer-model.spec.ts | 159 | not.toBe | rgba(0, 0, 0, 0) | rgb(228, 207, 215) | color(srgb …) folded to rgb(228, 207, 215); re-pin the spec to the rgb/hex form (#411) | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 160 | toBeCloseTo | 1 ±0.05 | 1 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 161 | toBeCloseTo | 1 ±0.05 | 1 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 163 | toBeCloseTo | 20 ±0.05 | 20 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 164 | toBeCloseTo | 20 ±0.05 | 20 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 170 | toBe | 278 | 278 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 188 | toBe | 1 | 1 | — | the picker search is typeahead-only: absent until a key, retracted on clear (#756) |
| chief-drawer-slash.spec.ts | 163 | toBe | 0 | 0 | — | `/clear` runs without sending and toasts confirmation (F1) |
| chief-drawer-slash.spec.ts | 174 | toBe | 0 | 0 | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 179 | toBe | 1 | {"__fn":"() => posts"} | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 191 | toBe | 0 | 0 | — | mid-prompt accept inserts literal text, never runs (F3) |
| chief-drawer-slash.spec.ts | 211 | toBeGreaterThanOrEqual | ≥ 0 | 228.68968200683594 | — | /help opens the command panel with the drawer builtins |
| chief-fab.spec.ts | 50 | toEqual | {"width":"40px","height":"40px","right":"8px","bottom":"8px","position":"fixed"} | {"width":"40px","height":"40px","right":"8px","bottom":"8px","position":"fixed"} | — | the FAB keeps the A0 corner geometry (40x40 @ 8px inset, fixed) |
| chief-fab.spec.ts | 103 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 104 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 105 | toBeCloseTo | 1392 ±0.5 | 1392 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 106 | toBeCloseTo | 684 ±0.5 | 684 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 107 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 108 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-panel.spec.ts | 116 | toBeCloseTo | 1052 ±0.5 | 1052 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 117 | toBeCloseTo | 124 ±0.5 | 124 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 118 | toBeCloseTo | 380 ±0.5 | 380 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 119 | toBeCloseTo | 600 ±0.5 | 600 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 135 | toBe | fixed | fixed | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 137 | toBe | 12px | 12px | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 139 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 140 | toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 142 | toBe | 15 | 15 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 144 | toMatch | {"__regex":"/^rgb\\(/"} | rgb(38, 34, 31) | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 147 | toBeGreaterThanOrEqual | ≥ 240 | 1052 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 160 | toBeCloseTo | 1200 ±0.5 | 1200 | — | board content never yields to the window (D1 overlay, no yield) |
| chief-panel.spec.ts | 170 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board content never yields to the window (D1 overlay, no yield) |
| chief-panel.spec.ts | 184 | toBeCloseTo | 1200 ±0.5 | 1200 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 191 | toBeGreaterThan | > 0 | 281 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 192 | toBeLessThanOrEqual | ≤ 1 | 0 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 215 | toBeCloseTo | 1052 ±0.5 | 1052 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 215 | toBeCloseTo | 1052 ±0.5 | 1052 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 215 | toBeCloseTo | 1052 ±0.5 | 1052 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 216 | toBeCloseTo | 124 ±0.5 | 124 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 216 | toBeCloseTo | 124 ±0.5 | 124 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 216 | toBeCloseTo | 124 ±0.5 | 124 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 380 ±0.5 | 380 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 380 ±0.5 | 380 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 380 ±0.5 | 380 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 600 ±0.5 | 600 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 600 ±0.5 | 600 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 600 ±0.5 | 600 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 225 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 225 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 225 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 226 | toBeCloseTo | 240 ±0.5 | 240 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 226 | toBeCloseTo | 240 ±0.5 | 240 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 226 | toBeCloseTo | 240 ±0.5 | 240 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 242 | toBeCloseTo | 1052 ±0.5 | 1052 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 243 | toBeCloseTo | 124 ±0.5 | 124 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 244 | toBeCloseTo | 380 ±0.5 | 380 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 245 | toBeCloseTo | 600 ±0.5 | 600 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 249 | toBeCloseTo | 712 ±0.5 | 712 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 250 | toBeCloseTo | 712 ±0.5 | 712 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 256 | toBe | 712 | 712 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 304 | toBe | 60 | 60 | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 308 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 309 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 310 | toBe | auto | auto | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-send-fallback.spec.ts | 151 | toBe | 1 | {"__fn":"() => posts"} | — | stale slot: send goes out, fallback toast names it, row heals to 默认 |
| chief-send-fallback.spec.ts | 187 | toBe | 1 | {"__fn":"() => posts"} | — | fresh slot: send goes out with no fallback toast |
| chief-send-fallback.spec.ts | 191 | toBeGreaterThan | > 0 | {"__fn":"() => chiefGets.length"} | — | fresh slot: send goes out with no fallback toast |
| chief-settings.spec.ts | 79 | toBeCloseTo | 16 ±0.05 | 16 | — | agent dialog search keeps its own 16px inset (#872 blast radius) |
| chief-settings.spec.ts | 229 | not.toBe | rgba(0, 0, 0, 0) | rgb(228, 207, 215) | color(srgb …) folded to rgb(228, 207, 215); re-pin the spec to the rgb/hex form (#411) | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 230 | toBeCloseTo | 1 ±0.05 | 1 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 231 | toBeCloseTo | 1 ±0.05 | 1 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 232 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 233 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 241 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 245 | toBe | 367 | 367 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 268 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 330 | toBeLessThanOrEqual | ≤ 202 | 200 | — | 压缩模型 long value truncates, full name on title (dark, #772) |
| chief-settings.spec.ts | 330 | toBeLessThanOrEqual | ≤ 202 | 200 | — | 压缩模型 long value truncates, full name on title (light, #772) |
| chief-stream-markdown.spec.ts | 296 | toBe | 2 | 2 | — | F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675） |
| chief-stream-markdown.spec.ts | 335 | toBe | auto | auto | — | F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动 |
| chief-stream-markdown.spec.ts | 598 | toBe | 24 | 24 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 604 | toBe | 1.5 | 1.5 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 746 | toBe | 44 | 44 | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 747 | toBe | 14px | 14px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 757 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 758 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 847 | toEqual | {"display":"flex","grow":"1","minW":"0px","imgW":24,"imgH":24,"colRightOfImg":"true","colBesideImg":"true"} | {"__fn":"() => thinking.evaluate(row => {\n      var _row$querySelector;\n      const img = (_row$querySelecto… | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 864 | toHaveCSS | display: flex | flex | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 865 | toHaveCSS | flex-grow: 1 | 1 | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 1073 | toBe | ellipsis | ellipsis | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1074 | toBe | hidden | hidden | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1075 | toBeGreaterThan | > 294 | 774 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1077 | toBeLessThanOrEqual | ≤ 298 | 298 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1083 | toBeLessThanOrEqual | ≤ 0 | 0 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |

```
