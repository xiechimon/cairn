```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-05T23:18:57.288Z · commit `034bf7d5` · port 8402 · playwright 1.63.0 · workers 4

Specs: search-focus search-result-rows search-close-flash chip-hotzone chip-assign detail-esc avatar-dicebear detail-3pane dead-buttons hotkeys escape-wiring sidebar-search-offboard (13 files) · tests 106 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 13 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 11 | 11 |
| .boundingBox() call sites | 3 | 3 |
| .toHaveCSS() call sites | 2 | 2 |
| visual-matcher assertion sites | 56 | 57 joined |

Comparison rows: 47 — KEPT 47, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (47)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| dead-buttons.spec.ts | 508 | toBeLessThan | < 1.5 | 0 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 509 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 510 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| detail-3pane.spec.ts | 35 | toBe | 240 | 240 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 36 | toBe | 488 | 488 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 38 | toBe | 240 | 240 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 39 | toBe | 952 | 952 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 41 | toBe | 712 | 712 | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 47 | toBe | 1px | 1px | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 48 | toBe | none | none | — | three abutting panes: 240 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 99 | toBe | 0px | 0px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 100 | toBe | 1px | 1px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 104 | toBe | relative | relative | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 106 | toBeCloseTo | 256 ±0.5 | 256 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 107 | toBeCloseTo | 936 ±0.5 | 936 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 109 | toBeCloseTo | 16 ±0.5 | 16 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 112 | toBeCloseTo | 632 ±0.5 | 632 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 114 | toBeGreaterThanOrEqual | ≥ 16 | 16 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 153 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 154 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 158 | toBeCloseTo | 687 ±0.5 | 687 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 159 | toBeLessThanOrEqual | ≤ 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 161 | toBeCloseTo | 8 ±0.5 | 8 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 163 | toBe | rgb(63, 60, 54) | rgb(63, 60, 54) | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 164 | toBe | 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 166 | toBeLessThanOrEqual | ≤ 2 | 2 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 180 | toBe | 712 | 712 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 181 | toBeCloseTo | 680 ±0.5 | 680 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 189 | toBeCloseTo | 782 ±0.5 | 782 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 190 | toBeCloseTo | 750 ±0.5 | 750 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 268 | toBe | 1200 | 1200 | — | fresh phase: the brief owns the whole center column, right pane collapses |
| escape-wiring.spec.ts | 89 | toEqual | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | — | 开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 154 | toEqual | {"winAdds":0,"winRems":0} | {"winAdds":0,"winRems":0} | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 155 | toBe | 6 | 6 | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 三连击：关→开落在开态且输入聚焦 |
| search-close-flash.spec.ts | 82 | toBeLessThanOrEqual | ≤ 0.434657 | 0.314657 | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-focus.spec.ts | 135 | not.toBe | rgba(0, 0, 0, 0) | rgba(255, 252, 248, 0.1) | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 140 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 150 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 160 | not.toBe | rgba(0, 0, 0, 0) | rgba(255, 252, 248, 0.1) | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 163 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 167 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 194 | toHaveCSS | transform: none | none | — | the caret is not clipped where it meets the input edge |
| search-focus.spec.ts | 221 | toBeGreaterThanOrEqual | ≥ 14 | 16 | — | the caret is not clipped where it meets the input edge |
| search-result-rows.spec.ts | 100 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(first)"} | — | 静息无常亮;hover 哪行亮哪行,且只亮一行 |
| search-result-rows.spec.ts | 138 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(second)"} | — | 鼠标一动让位:键盘光标交还 hover |

```
