```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-09T06:12:07.335Z · commit `243bb137` · port 8404 · playwright 1.63.0 · workers 4

Specs: attachment-strip attachment-title spec-brief-card chief-composer-tools composer-paste chief-panel chief-stream-markdown (7 files) · tests 74 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 17 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 16 | 16 |
| .boundingBox() call sites | 18 | 18 |
| .toHaveCSS() call sites | 2 | 2 |
| visual-matcher assertion sites | 125 | 145 joined |

Comparison rows: 126 — KEPT 126, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (126)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| attachment-strip.spec.ts | 296 | toBe | 120 | {"x":257,"y":569,"width":201.359375,"height":58} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 302 | toBe | 1 | {"x":257,"y":569,"width":201.359375,"height":58} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 304 | toBe | 1 | {"x":257,"y":569,"width":201.359375,"height":58} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 322 | toBe | 120 | {"x":257,"y":569,"width":201.359375,"height":58} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 324 | toEqual | {"x":257,"y":569,"width":201.359375,"height":58} | {"x":257,"y":569,"width":201.359375,"height":58} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 337 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 339 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 352 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 381 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 392 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 422 | toBe | 1 | {"__fn":"() => held.length"} | — | detail face: a failed upload clears the placeholder, toasts, keeps the draft |
| attachment-strip.spec.ts | 464 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 466 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 476 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 540 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 542 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 552 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | chief face: placeholder → settled chip → preview |
| chief-composer-tools.spec.ts | 333 | toBeLessThanOrEqual | ≤ 602 | 596 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 335 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 336 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 408 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 414 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 439 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 441 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 446 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
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
| chief-panel.spec.ts | 315 | toBe | 120 | 120 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 316 | toBe | 60 | 60 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 317 | toBe | 120px | 120px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 318 | toBe | 60px | 60px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 320 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 321 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-stream-markdown.spec.ts | 296 | toBe | 2 | 2 | — | F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675） |
| chief-stream-markdown.spec.ts | 335 | toBe | auto | auto | — | F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动 |
| chief-stream-markdown.spec.ts | 598 | toBe | 24 | 24 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 604 | toBe | 1.5 | 1.5 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 762 | toBe | 44 | 44 | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 763 | toBe | 14px | 14px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 773 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 774 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 863 | toEqual | {"display":"flex","grow":"1","minW":"0px","imgW":24,"imgH":24,"colRightOfImg":"true","colBesideImg":"true"} | {"__fn":"() => thinking.evaluate(row => {\n      var _row$querySelector;\n      const img = (_row$querySelecto… | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 880 | toHaveCSS | display: flex | flex | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 881 | toHaveCSS | flex-grow: 1 | 1 | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 1089 | toBe | ellipsis | ellipsis | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1090 | toBe | hidden | hidden | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1091 | toBeGreaterThan | > 294 | 774 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1093 | toBeLessThanOrEqual | ≤ 300 | 300 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1099 | toBeLessThanOrEqual | ≤ 0 | 0 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| composer-paste.spec.ts | 296 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 302 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 306 | toBe | 57 | {"__fn":"() => input.evaluate(el => el.selectionStart)"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 320 | toBe | 2 | {"__fn":"() => uploads.grants.length"} | — | detail face: one multi-image paste puts every token on its own line |
| composer-paste.spec.ts | 322 | toEqual | ["pasted-image-1.png","pasted-image-2.png"] | ["pasted-image-1.png","pasted-image-2.png"] | — | detail face: one multi-image paste puts every token on its own line |
| composer-paste.spec.ts | 339 | toEqual | [] | [] | — | detail face: a text-only paste is never preventDefaulted (FM7 zero change) |
| composer-paste.spec.ts | 356 | toEqual | [] | [] | — | detail face: a non-whitelisted paste is rejected with a toast, grant never fires |
| composer-paste.spec.ts | 375 | toEqual | [] | [] | — | detail face: an over-cap paste is rejected with a toast, grant never fires |
| composer-paste.spec.ts | 388 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a non-image whitelist file (text/plain) is accepted under its real name |
| composer-paste.spec.ts | 421 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a mixed file+text clipboard takes the files and drops the text |
| composer-paste.spec.ts | 472 | toBe | 0 | 0 | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 475 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 477 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 482 | toBe | 1 | {"__fn":"() => steers"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 525 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | new-task face: paste inserts the token line-atomic into the spec and save carries it |
| composer-paste.spec.ts | 552 | toBe | 0 | 0 | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 554 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 556 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 561 | toBe | 1 | {"__fn":"() => creates"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 603 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face probe: a real Cmd/Ctrl+V clipboard image paste rides the same chain |
| spec-brief-card.spec.ts | 126 | toBe | 160px | 160px | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 128 | toBe | 100% | 100% | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 147 | toBe | 1px | 1px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 151 | toBe | 10px | 10px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 153 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 154 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 155 | toBe | 15px | 15px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 173 | toBeLessThanOrEqual | ≤ 2 | 0.04399999999998272 | — | 4b. 宽屏下行宽吃 68ch cap（#470 的 60–75 字符带同律） |
| spec-brief-card.spec.ts | 211 | toBe | baseline | baseline | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 212 | not.toBe | rgb(238, 232, 228) | rgb(179, 174, 170) | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 213 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 217 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |

```
