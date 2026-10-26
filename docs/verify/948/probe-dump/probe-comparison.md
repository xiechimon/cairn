```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-06T00:00:23.318Z · commit `ffe9e34e` · port 8401 · playwright 1.63.0 · workers 4

Specs: overlay-focus mention-picker-center attachment-strip attachment-title dead-buttons newtask-machine-persist newtask-machine-pin newtask-project-persist newtask-project-select newtask-single-field z-ladder escape-wiring agent-delete (14 files) · tests 84 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 1 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 4 | 4 |
| .boundingBox() call sites | 4 | 4 |
| .toHaveCSS() call sites | 4 | 4 |
| visual-matcher assertion sites | 49 | 49 joined |

Comparison rows: 40 — KEPT 40, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (40)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| agent-delete.spec.ts | 48 | toHaveCSS | font-size: 14px | 14px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-delete.spec.ts | 49 | toHaveCSS | line-height: 20px | 20px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| attachment-strip.spec.ts | 296 | toBe | 120 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 302 | toBe | 1 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 304 | toBe | 1 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 315 | toBe | 120 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 317 | toEqual | {"x":257,"y":543,"width":124,"height":84} | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 330 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 332 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 345 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 374 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 385 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 415 | toBe | 1 | {"__fn":"() => held.length"} | — | detail face: a failed upload clears the placeholder, toasts, keeps the draft |
| attachment-strip.spec.ts | 457 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 459 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 469 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 531 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 533 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 543 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | chief face: placeholder → settled chip → preview |
| dead-buttons.spec.ts | 516 | toBeLessThan | < 1.5 | 0 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 517 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 518 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| escape-wiring.spec.ts | 89 | toEqual | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | — | 开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 157 | toEqual | {"winAdds":0,"winRems":0} | {"winAdds":0,"winRems":0} | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 158 | toBe | 6 | 6 | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| mention-picker-center.spec.ts | 21 | toHaveCSS | transform: none | none | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 26 | toBe | 400 | 400 | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 28 | toBeLessThanOrEqual | ≤ 1 | 0 | — | mention picker stays centered in the production bundle (#448) |
| overlay-focus.spec.ts | 57 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 58 | not.toBe | rgb(0, 95, 204) | rgb(216, 156, 252) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 62 | toBe | solid | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 63 | toBe | rgb(216, 156, 252) | rgb(216, 156, 252) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 74 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 75 | not.toBe | rgb(0, 95, 204) | rgb(216, 156, 252) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 77 | toBe | solid | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 78 | toBe | rgb(216, 156, 252) | rgb(216, 156, 252) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 96 | toBe | solid | solid | — | Tab focus keeps the brand ring (keyboard reachability preserved) |
| overlay-focus.spec.ts | 97 | toBe | rgb(216, 156, 252) | rgb(216, 156, 252) | — | Tab focus keeps the brand ring (keyboard reachability preserved) |
| overlay-focus.spec.ts | 126 | toHaveCSS | animation-name: enter | enter | — | backdrop click closes; entry rides the tw-animate-css fade |
| z-ladder.spec.ts | 64 | toEqual | ["true","true","true","true","true"] | ["true","true","true","true","true"] | — | every probe point of the new-task panel hit-tests inside the panel |

```
