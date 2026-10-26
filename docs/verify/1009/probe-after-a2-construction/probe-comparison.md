```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-09T04:20:16.695Z · commit `3f91585a` · port 8404 · playwright 1.63.0 · workers 4

Specs: detail-3pane detail-narrow chat-type-measure transcript-user-words thinking-row-truncate spec-flow dead-buttons (8 files) · tests 65 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 21 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 22 | 22 |
| .boundingBox() call sites | 3 | 3 |
| .toHaveCSS() call sites | 0 | 0 |
| visual-matcher assertion sites | 92 | 92 joined |

Comparison rows: 83 — KEPT 83, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (83)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| chat-type-measure.spec.ts | 38 | toBe | 15px | 15px | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 40 | toBe | 24px | 24px | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 72 | toBe | 1.6 | 1.6 | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 106 | toBeGreaterThan | > 67.5 | 67.95796699669967 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 107 | toBeLessThanOrEqual | ≤ 68.5 | 67.95796699669967 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 114 | toBe | center | center | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 115 | toBeGreaterThan | > 0 | 321.109 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 116 | toBe | 321.109px | 321.109px | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 122 | toBeLessThanOrEqual | ≤ 1193 | 1192 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 135 | toBe | 14px | 14px | — | composer placeholder steps to 14px — one notch under the 15px body |
| chat-type-measure.spec.ts | 136 | toBe | 15px | 15px | — | composer placeholder steps to 14px — one notch under the 15px body |
| chat-type-measure.spec.ts | 154 | toBe | 24 | 24 | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 155 | toBe | 15px | 15px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 156 | toEqual | {"w":20,"h":20} | {"w":20,"h":20} | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 157 | toBe | 31px | 31px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 206 | toEqual | [] | [] | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 210 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 211 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 214 | toBeGreaterThanOrEqual | ≥ 16 | 21 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 215 | toBeLessThanOrEqual | ≤ 32 | 21 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| dead-buttons.spec.ts | 557 | toBeLessThan | < 1.5 | 0 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 558 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 559 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| detail-3pane.spec.ts | 47 | toBe | 240 | 240 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 48 | toBe | 488 | 488 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 50 | toBe | 240 | 240 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 51 | toBe | 952 | 952 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 53 | toBe | 712 | 712 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 59 | toBe | 1px | 1px | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 60 | toBe | none | none | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 115 | toBe | 0px | 0px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 116 | toBe | 1px | 1px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 120 | toBe | relative | relative | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 122 | toBeCloseTo | 256 ±0.5 | 256 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 123 | toBeCloseTo | 936 ±0.5 | 936 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 125 | toBeCloseTo | 16 ±0.5 | 16 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 128 | toBeCloseTo | 632 ±0.5 | 632 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 130 | toBeGreaterThanOrEqual | ≥ 16 | 16 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 168 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 169 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 173 | toBeCloseTo | 687 ±0.5 | 687 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 174 | toBeLessThanOrEqual | ≤ 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 176 | toBeCloseTo | 8 ±0.5 | 8 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 178 | toBe | rgb(64, 60, 57) | rgb(64, 60, 57) | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 179 | toBe | 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 181 | toBeLessThanOrEqual | ≤ 2 | 2 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 198 | toBe | 712 | 712 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 199 | toBeCloseTo | 680 ±0.5 | 680 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 207 | toBeCloseTo | 712 ±0.5 | 712 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 208 | toBeCloseTo | 680 ±0.5 | 680 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 290 | toBe | 1200 | 1200 | — | fresh phase: the brief owns the whole center column, right pane collapses |
| detail-narrow.spec.ts | 57 | toBeLessThanOrEqual | ≤ 320 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 60 | toBeLessThanOrEqual | ≤ 321 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 61 | toBe | 320 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 73 | toBeLessThanOrEqual | ≤ 360 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 74 | toBeLessThanOrEqual | ≤ 361 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 75 | toBe | 360 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 102 | toBe | 240 | 240 | — | N3: the degradation stops at 768px — the 3-pane shell survives above it |
| detail-narrow.spec.ts | 103 | toBe | 488 | 488 | — | N3: the degradation stops at 768px — the 3-pane shell survives above it |
| detail-narrow.spec.ts | 122 | toBeLessThanOrEqual | ≤ 320 | 320 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 123 | toBeLessThanOrEqual | ≤ 320 | 304 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 124 | toBeLessThanOrEqual | ≤ 320 | 312 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 145 | toBeGreaterThanOrEqual | ≥ 0 | 12 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 146 | toBeLessThanOrEqual | ≤ 320 | 320 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 147 | toBeGreaterThanOrEqual | ≥ 0 | 16 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 148 | toBeLessThanOrEqual | ≤ 320 | 304 | — | N5: head actions and the composer stay inside the 320px viewport |
| spec-flow.spec.ts | 127 | toBeLessThan | < 44 | -797 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 131 | toBeGreaterThanOrEqual | ≥ 43 | 79 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 132 | toBeGreaterThan | > 200 | 876 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 142 | toBe | 712 | 712 | — | 3. 超长无断点行包进中栏：chat 横向 scrollWidth 等于 clientWidth |
| thinking-row-truncate.spec.ts | 180 | toBe | flex | flex | — | T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上） |
| thinking-row-truncate.spec.ts | 182 | toBe | 11 | 11 | — | T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上） |
| thinking-row-truncate.spec.ts | 184 | toBe | 20 | 20 | — | T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上） |
| thinking-row-truncate.spec.ts | 196 | not.toBe | none | 643.477px | — | T2: chat-text 有宽度上限与 min-w-0——robot 行 :419 同款工具类 |
| thinking-row-truncate.spec.ts | 197 | toBe | 0px | 0px | — | T2: chat-text 有宽度上限与 min-w-0——robot 行 :419 同款工具类 |
| thinking-row-truncate.spec.ts | 220 | toBeLessThan | < 187 | 151 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 222 | toBe | ellipsis | ellipsis | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 223 | toBe | hidden | hidden | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 224 | toBeGreaterThan | > 625 | 1810 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 225 | toBeLessThanOrEqual | ≤ 643 | 643 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 234 | toBeLessThanOrEqual | ≤ 0 | 0 | — | T4: 页面级零横向溢出；展开交互不被截断修法砸掉 |
| transcript-user-words.spec.ts | 235 | toBe | 24 | 24 | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| transcript-user-words.spec.ts | 236 | toBe | 15px | 15px | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |

```
