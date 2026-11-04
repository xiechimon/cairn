```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-08T06:20:13.780Z · commit `159cc3dd` · port 8397 · playwright 1.63.0 · workers 4

Specs: chief-panel chief-stream-markdown chief-send-fallback chief-composer-tools chief-drawer-slash chief-drawer-model chief-fab chief-settings (8 files) · tests 72 passed / 19 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 21 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 18 | 13 |
| .boundingBox() call sites | 21 | 13 |
| .toHaveCSS() call sites | 2 | 2 |
| visual-matcher assertion sites | 103 | 72 joined |

Comparison rows: 90 — KEPT 52, DRIFT 5, NOT-RUN 33, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## DRIFT — baseline no longer holds; classify each row (5)

Expected drift → re-pin the spec value to “new measured”. Suspected regression → fix the code, keep the baseline.

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| chief-panel.spec.ts | 105 | toBeCloseTo | 1022 ±0.5 | 1052 | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 142 | toBeCloseTo | 782 ±0.5 | 1200 | — | board content yields to the panel and the columns keep the D8 guard |
| chief-panel.spec.ts | 204 | toBeCloseTo | 1022 ±0.5 | 1052 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-stream-markdown.spec.ts | 582 | toBe | 24 | 22.88519287109375 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 728 | toBe | 44 | 42 | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |

## NOT-RUN — no runtime record for this assertion site (33)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| chief-fab.spec.ts | 47 | toEqual | (see spec line) | — | — |  |
| chief-fab.spec.ts | 94 | toBeCloseTo | 48 | — | — |  |
| chief-fab.spec.ts | 95 | toBeCloseTo | 48 | — | — |  |
| chief-fab.spec.ts | 96 | toBeCloseTo | (see spec line) | — | — |  |
| chief-fab.spec.ts | 97 | toBeCloseTo | (see spec line) | — | — |  |
| chief-fab.spec.ts | 98 | toBeCloseTo | 48 | — | — |  |
| chief-fab.spec.ts | 99 | toBeCloseTo | 48 | — | — |  |
| chief-panel.spec.ts | 106 | toBeCloseTo | 0 | — | — |  |
| chief-panel.spec.ts | 107 | toBeCloseTo | 418 | — | — |  |
| chief-panel.spec.ts | 108 | toBeCloseTo | 732 | — | — |  |
| chief-panel.spec.ts | 122 | toBe | static | — | — |  |
| chief-panel.spec.ts | 123 | toBe | 0px | — | — |  |
| chief-panel.spec.ts | 124 | toBe | none | — | — |  |
| chief-panel.spec.ts | 127 | toBe | 1px | — | — |  |
| chief-panel.spec.ts | 154 | toBeGreaterThanOrEqual | 280 | — | — |  |
| chief-panel.spec.ts | 164 | toBeCloseTo | (see spec line) | — | — |  |
| chief-panel.spec.ts | 171 | toBeGreaterThan | 0 | — | — |  |
| chief-panel.spec.ts | 172 | toBeLessThanOrEqual | 1 | — | — |  |
| chief-panel.spec.ts | 205 | toBeCloseTo | 0 | — | — |  |
| chief-panel.spec.ts | 206 | toBeCloseTo | 418 | — | — |  |
| chief-panel.spec.ts | 207 | toBeCloseTo | 732 | — | — |  |
| chief-panel.spec.ts | 209 | toBeCloseTo | (see spec line) | — | — |  |
| chief-panel.spec.ts | 214 | toBeCloseTo | 1200 | — | — |  |
| chief-panel.spec.ts | 215 | toBeCloseTo | (see spec line) | — | — |  |
| chief-panel.spec.ts | 229 | toBeCloseTo | (see spec line) | — | — |  |
| chief-panel.spec.ts | 230 | toBeCloseTo | 44 | — | — |  |
| chief-panel.spec.ts | 231 | toBeCloseTo | 418 | — | — |  |
| chief-panel.spec.ts | 232 | toBeCloseTo | (see spec line) | — | — |  |
| chief-panel.spec.ts | 236 | toBeCloseTo | (see spec line) | — | — |  |
| chief-stream-markdown.spec.ts | 588 | toBe | 1.5 | — | — |  |
| chief-stream-markdown.spec.ts | 729 | toBe | 14px | — | — |  |
| chief-stream-markdown.spec.ts | 739 | toBe | 0px | — | — |  |
| chief-stream-markdown.spec.ts | 740 | toBe | 0px | — | — |  |

## KEPT — baseline holds on this build (52)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
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
| chief-drawer-slash.spec.ts | 211 | toBeGreaterThanOrEqual | ≥ 0 | 229.2230224609375 | — | /help opens the command panel with the drawer builtins |
| chief-panel.spec.ts | 199 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 199 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 199 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 291 | toBe | 60 | 60 | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 295 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 296 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 297 | toBe | auto | auto | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
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
| chief-stream-markdown.spec.ts | 281 | toBe | 2 | 2 | — | F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675） |
| chief-stream-markdown.spec.ts | 320 | toBe | auto | auto | — | F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动 |
| chief-stream-markdown.spec.ts | 829 | toEqual | {"display":"flex","grow":"1","minW":"0px","imgW":24,"imgH":24,"colRightOfImg":"true","colBesideImg":"true"} | {"__fn":"() => thinking.evaluate(row => {\n      var _row$querySelector;\n      const img = (_row$querySelecto… | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 846 | toHaveCSS | display: flex | flex | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 847 | toHaveCSS | flex-grow: 1 | 1 | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |

```
