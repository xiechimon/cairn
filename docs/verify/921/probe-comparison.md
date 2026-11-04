```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-05T13:54:50.322Z · commit `d9e90e55` · port 8398 · playwright 1.63.0 · workers 4

Specs: all (101 files) · tests 787 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 150 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 131 | 132 |
| .boundingBox() call sites | 104 | 104 |
| .toHaveCSS() call sites | 17 | 17 |
| visual-matcher assertion sites | 778 | 961 joined |

Comparison rows: 780 — KEPT 780, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (780)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| accent-typo.spec.ts | 45 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 45 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 46 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 46 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 55 | toBe | 600 | 600 | — | headline tier 600 holds (light) |
| accent-typo.spec.ts | 55 | toBe | 600 | 600 | — | headline tier 600 holds (dark) |
| accent-typo.spec.ts | 80 | toBe | rgb(21, 20, 15) | rgb(21, 20, 15) | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 80 | toBe | rgb(234, 232, 238) | rgb(234, 232, 238) | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 81 | not.toBe | rgba(0, 0, 0, 0) | rgb(21, 20, 15) | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 81 | not.toBe | rgba(0, 0, 0, 0) | rgb(234, 232, 238) | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 82 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 82 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 101 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(87, 83, 78)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(87, 83, 78)"} | — | res-back hover shows no background change (light) |
| accent-typo.spec.ts | 101 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(176, 175, 182)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(176, 175, 182)"} | — | res-back hover shows no background change (dark) |
| accent-typo.spec.ts | 118 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 118 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 119 | toBe | none | none | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 119 | toBe | none | none | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 123 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(85, 83, 74)"} | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(85, 83, 74)"} | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 123 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(176, 175, 182)"} | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(176, 175, 182)"} | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 169 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 169 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 170 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(85, 83, 74)","opacity":"1","iconX":204,"iconY":14.5,"ico… | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(85, 83, 74)","opacity":"1","iconX":204,"iconY":14.5,"ico… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 170 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(176, 175, 182)","opacity":"1","iconX":204,"iconY":14.5,"… | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(176, 175, 182)","opacity":"1","iconX":204,"iconY":14.5,"… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 175 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 175 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 176 | toEqual | {"bg":"rgba(28, 25, 23, 0.05)","shadow":"none","color":"rgb(85, 83, 74)","opacity":"1","iconX":13,"iconY":14.5… | {"bg":"rgba(28, 25, 23, 0.05)","shadow":"none","color":"rgb(85, 83, 74)","opacity":"1","iconX":13,"iconY":14.5… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 176 | toEqual | {"bg":"rgba(255, 255, 255, 0.05)","shadow":"none","color":"rgb(176, 175, 182)","opacity":"1","iconX":13,"iconY… | {"bg":"rgba(255, 255, 255, 0.05)","shadow":"none","color":"rgb(176, 175, 182)","opacity":"1","iconX":13,"iconY… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 198 | toBe | solid | solid | — | res-back keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 198 | toBe | solid | solid | — | res-back keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 199 | toBe | 2px | 2px | — | res-back keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 199 | toBe | 2px | 2px | — | res-back keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 201 | toBe | rgb(136, 57, 239) | rgb(136, 57, 239) | — | res-back keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 201 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | res-back keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 256 | toBe | rgb(199, 62, 62) | rgb(199, 62, 62) | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (light) |
| accent-typo.spec.ts | 256 | toBe | rgb(224, 90, 90) | rgb(224, 90, 90) | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (dark) |
| accent-typo.spec.ts | 257 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (light) |
| accent-typo.spec.ts | 257 | toBe | rgb(23, 23, 26) | rgb(23, 23, 26) | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (dark) |
| accent-typo.spec.ts | 258 | toBeGreaterThanOrEqual | ≥ 4.5 | 5.015485115873926 | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (light) |
| accent-typo.spec.ts | 258 | toBeGreaterThanOrEqual | ≥ 4.5 | 4.923358024780483 | — | P5 danger pair: destructive bg + fg resolve and pass 4.5 (dark) |
| accent-typo.spec.ts | 266 | toBe | rgb(136, 57, 239) | rgb(136, 57, 239) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 266 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 267 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 267 | toBe | rgb(23, 23, 26) | rgb(23, 23, 26) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 268 | toBeGreaterThanOrEqual | ≥ 4.5 | 5.4144670994301265 | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 268 | toBeGreaterThanOrEqual | ≥ 4.5 | 8.805531106228287 | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 285 | toHaveCSS | background-color: rgba(136, 57, 239, 0.14) | rgba(136, 57, 239, 0.14) | color(srgb …) folded to rgba(136, 57, 239, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 285 | toHaveCSS | background-color: rgba(203, 166, 247, 0.14) | rgba(203, 166, 247, 0.14) | color(srgb …) folded to rgba(203, 166, 247, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (dark) |
| accent-typo.spec.ts | 290 | toHaveCSS | background-color: rgba(199, 62, 62, 0.14) | rgba(199, 62, 62, 0.14) | color(srgb …) folded to rgba(199, 62, 62, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 290 | toHaveCSS | background-color: rgba(224, 90, 90, 0.14) | rgba(224, 90, 90, 0.14) | color(srgb …) folded to rgba(224, 90, 90, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (dark) |
| accent-typo.spec.ts | 305 | toHaveCSS | filter: brightness(1.07) | brightness(1.07) | — | P4 brand button hover brightens 1.07 (light) |
| accent-typo.spec.ts | 305 | toHaveCSS | filter: brightness(1.07) | brightness(1.07) | — | P4 brand button hover brightens 1.07 (dark) |
| account-team-cleanse.spec.ts | 78 | toBe | 1 | 1 | — | account switch: default permission renders off; click requests and grants |
| account-team-cleanse.spec.ts | 85 | toBe | 0 | 0 | — | account switch: granted permission renders checked without a click |
| account-team-cleanse.spec.ts | 95 | toBe | 1 | 1 | — | account switch: denied stays off; a click settles without granting |
| agent-create-model.spec.ts | 178 | toBeGreaterThanOrEqual | ≥ 202.91558837890625 | 309.2462463378906 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 179 | toBeLessThanOrEqual | ≤ 529.0844116210938 | 394.6287536621094 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 190 | toBeGreaterThanOrEqual | ≥ 202.91558837890625 | 307.4756164550781 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 191 | toBeLessThanOrEqual | ≤ 529.0844116210938 | 482.7118835449219 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 193 | toBeGreaterThanOrEqual | ≥ 0 | 307.4756164550781 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 194 | toBeGreaterThanOrEqual | ≥ 0 | 514.2000122070312 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 195 | toBeLessThanOrEqual | ≤ 1440 | 729.7999877929688 | — | 创建弹窗：两级菜单不被底栏压住、不越出弹窗体（几何） |
| agent-create-model.spec.ts | 227 | toBeGreaterThanOrEqual | ≥ 195 | 294.41998291015625 | — | 模型很多：选过运行时后菜单不越出裁剪盒，首行可点，40 行一个不少 |
| agent-create-model.spec.ts | 228 | toBeLessThanOrEqual | ≤ 537 | 482.58001708984375 | — | 模型很多：选过运行时后菜单不越出裁剪盒，首行可点，40 行一个不少 |
| agent-delete.spec.ts | 45 | toHaveCSS | font-size: 12px | 12px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-delete.spec.ts | 46 | toHaveCSS | line-height: 16px | 16px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-detail.spec.ts | 179 | toBeLessThanOrEqual | ≤ 8 | 0 | — | 概览：两级菜单贴触发钮右缘且在内容列内（几何） |
| agent-detail.spec.ts | 180 | toBeLessThanOrEqual | ≤ 8 | 8 | — | 概览：两级菜单贴触发钮右缘且在内容列内（几何） |
| agent-detail.spec.ts | 181 | toBeGreaterThanOrEqual | ≥ 455 | 1027 | — | 概览：两级菜单贴触发钮右缘且在内容列内（几何） |
| agent-detail.spec.ts | 182 | toBeLessThanOrEqual | ≤ 1225 | 1207 | — | 概览：两级菜单贴触发钮右缘且在内容列内（几何） |
| agent-detail.spec.ts | 244 | toBeGreaterThan | > -1 | 3 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 245 | toBeLessThan | < 4 | 3 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 391 | toBe | 1 | {"__fn":"() => patches"} | — | 权限 tab：保存失败出可见错误反馈，开关不回弹 |
| agent-detail.spec.ts | 446 | toEqual | ["验收只看真机跑通","PROBE 探针的历史轮次"] | ["验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：搜索扫 content 且 ASCII 大小写不敏感 |
| agent-detail.spec.ts | 464 | toEqual | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 473 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 489 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通"] | ["PROBE 探针的历史轮次","验收只看真机跑通"] | — | 记忆 tab：搜索与排序叠加——排序只在命中集内生效 |
| agent-detail.spec.ts | 579 | toEqual | ["名称","职责","默认 skill","运行时","模型","思考强度"] | ["名称","职责","默认 skill","运行时","模型","思考强度"] | — | 概览：六个字段行长在同一张模板卡里，头像头在卡内 |
| agent-detail.spec.ts | 627 | toEqual | ["11px","11px"] | ["11px","11px"] | — | 记忆/权限卡：首行不吃卡的上圆角与描边（无方角外溢、无 2px 顶边） |
| agent-detail.spec.ts | 628 | toBe | 0px | 0px | — | 记忆/权限卡：首行不吃卡的上圆角与描边（无方角外溢、无 2px 顶边） |
| agent-identity-chip.spec.ts | 54 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 55 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 59 | toBe | 12px | 12px | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 67 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| agent-identity-chip.spec.ts | 68 | toBe | pointer | pointer | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| attachment-strip.spec.ts | 285 | toBe | 120 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 291 | toBe | 1 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 293 | toBe | 1 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 304 | toBe | 120 | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 306 | toEqual | {"x":257,"y":543,"width":124,"height":84} | {"x":257,"y":543,"width":124,"height":84} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 319 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 321 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 332 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 361 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 372 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 402 | toBe | 1 | {"__fn":"() => held.length"} | — | detail face: a failed upload clears the placeholder, toasts, keeps the draft |
| attachment-strip.spec.ts | 444 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 446 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 456 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 518 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 520 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 530 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | chief face: placeholder → settled chip → preview |
| board-dnd-live.spec.ts | 135 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 149 | toBeGreaterThanOrEqual | ≥ 0 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 151 | toEqual | [] | [] | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 183 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: PATCH 409 = 乐观值作废，卡片弹回源列 + toast 点名失败（#638） |
| board-dnd.spec.ts | 347 | toEqual | ["r3-legacy-1","r3-legacy-2"] | ["r3-legacy-1","r3-legacy-2"] | — | 已完成(有变更) → 待处理: reopen commits review, lands after the pinned group |
| board-dnd.spec.ts | 488 | toEqual | [] | [] | — | 重置闸·取消：零提交（卡片不动、计数不动、无请求发出）(#755) |
| board-dnd.spec.ts | 529 | toBe | 0.4 | 0.4 | — | cards from every column arm the drag gesture (#753) |
| board-dnd.spec.ts | 581 | toEqual | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 586 | toBe | 0 | 0 | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 634 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 634 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 636 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 636 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 637 | toBe | 0px | 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 637 | toBe | 0px | 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 647 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 647 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 653 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 653 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 697 | toBe | rgba(136, 57, 239, 0.1) | rgba(136, 57, 239, 0.1) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 697 | toBe | rgba(203, 166, 247, 0.1) | rgba(203, 166, 247, 0.1) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 698 | toBe | rgb(136, 57, 239) | rgb(136, 57, 239) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 698 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 699 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 699 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 703 | toBe | rgba(136, 57, 239, 0.05) | rgba(136, 57, 239, 0.05) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 703 | toBe | rgba(203, 166, 247, 0.05) | rgba(203, 166, 247, 0.05) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 704 | toBe | rgb(136, 57, 239) | rgb(136, 57, 239) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 704 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 710 | not.toBe | rgba(136, 57, 239, 0.05) | rgb(239, 236, 229) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 710 | not.toBe | rgba(203, 166, 247, 0.05) | rgb(23, 23, 26) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 711 | not.toBe | rgba(136, 57, 239, 0.05) | rgb(239, 236, 229) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 711 | not.toBe | rgba(203, 166, 247, 0.05) | rgb(23, 23, 26) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 753 | toEqual | [] | [] | — | committed drop never flashes the card back to the source column |
| board-docked-reflow.spec.ts | 70 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 73 | toBeGreaterThanOrEqual | ≥ 239 | 257 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 74 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 76 | toBeGreaterThan | > 782 | 1196 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 91 | toBeGreaterThanOrEqual | ≥ 16 | 177 | — | the clipped next column peeks >=16px at the scroll edge |
| board-docked-reflow.spec.ts | 107 | toBeGreaterThan | > 0 | {"x":240,"y":44,"width":782,"height":688} | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 113 | toBeLessThanOrEqual | ≤ 1023 | 1005 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 114 | toBeGreaterThanOrEqual | ≥ 239 | 725 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 115 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 126 | toHaveCSS | scrollbar-width: auto | auto | — | overflow discloses itself: the scroller no longer hides its scrollbar |
| board-docked-reflow.spec.ts | 145 | toBeLessThanOrEqual | ≤ 2 | 1 | — | cards keep their resting width while docked |
| board-docked-reflow.spec.ts | 164 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 165 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 171 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 177 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 192 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 194 | toBeGreaterThanOrEqual | ≥ 239 | 257 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 198 | toBeLessThanOrEqual | ≤ 0 | 0 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 213 | toBeLessThanOrEqual | ≤ 1201 | 1183 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 214 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 215 | toBeGreaterThan | > 609 | 903 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 216 | toBeGreaterThan | > 315 | 609 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 217 | toBeGreaterThan | > 21 | 315 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 226 | toBeLessThanOrEqual | ≤ 1200 | 1200 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 229 | toBeGreaterThan | > 280 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 230 | toBeLessThan | < 282 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 231 | toBeLessThanOrEqual | ≤ 1 | 0 | — | resting geometry at 1440 is untouched by the floor token |
| board-filter.spec.ts | 96 | toContain | rgba(0, 0, 0, 0) | ["rgba(0, 0, 0, 0)","transparent"] | — | 旧场景（无 projectNames）不渲染仓库面；右动作区恰好一钮 = 无底色类型钮；+任务 不存在 |
| board-filter.spec.ts | 474 | toHaveCSS | background-color: rgb(239, 68, 68) | rgb(239, 68, 68) | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 497 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 498 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 499 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 500 | toBe | 94.5 | 94.5 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 502 | toBe | 26.5 | 26.5 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-overflow.spec.ts | 34 | toBeLessThanOrEqual | ≤ 733 | 719 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 36 | toBeGreaterThanOrEqual | ≥ 43 | 56 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 48 | toBe | auto | auto | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 49 | toBeGreaterThan | > 624 | 1224 | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 57 | toBeGreaterThan | > 0 | 400 | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 71 | toBeGreaterThan | > 0 | {"x":258,"y":94,"width":279,"height":624} | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 80 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 列头固定：列表滚动时 header 的视口位置不动 |
| board-overflow.spec.ts | 97 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 113 | toBeGreaterThan | > 0 | 600 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 114 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 132 | toBeLessThanOrEqual | ≤ 733 | 719 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| board-overflow.spec.ts | 136 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| card-press.spec.ts | 53 | not.toBe | rgb(221, 216, 204) | rgb(231, 227, 218) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 53 | not.toBe | rgb(53, 53, 61) | rgb(30, 30, 34) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 57 | toHaveCSS | background-color: rgb(221, 216, 204) | rgb(221, 216, 204) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 57 | toHaveCSS | background-color: rgb(53, 53, 61) | rgb(53, 53, 61) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 62 | toBe | 1 | 1 | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 62 | toBe | 1 | 1 | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 71 | toHaveCSS | background-color: rgb(231, 227, 218) | rgb(231, 227, 218) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 71 | toHaveCSS | background-color: rgb(30, 30, 34) | rgb(30, 30, 34) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 78 | toHaveCSS | user-select: none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 82 | toBe | none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 111 | toBe | 0 | 0 | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| chat-md-toolout.spec.ts | 75 | toBe | rgb(234, 232, 238) | rgb(234, 232, 238) | — | A3: the output block is left aligned, mono, normal contrast — not a chat-note |
| chat-md-toolout.spec.ts | 115 | toBeGreaterThan | > 290 | 308 | — | B3: nested list items indent past their parent |
| chat-type-measure.spec.ts | 29 | toBe | 15px | 15px | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 31 | toBe | 24px | 24px | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 49 | toBe | 1.6 | 1.6 | — | chat body reads at 15px on a unitless 1.6 — the 24px pitch survives |
| chat-type-measure.spec.ts | 80 | toBeGreaterThan | > 67.5 | 67.95796699669967 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 81 | toBeLessThanOrEqual | ≤ 68.5 | 67.95796699669967 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 88 | toBe | center | center | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 89 | toBeGreaterThan | > 0 | 321.109 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 90 | toBe | 321.109px | 321.109px | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 96 | toBeLessThanOrEqual | ≤ 1193 | 1192 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 109 | toBe | 14px | 14px | — | composer placeholder steps to 14px — one notch under the 15px body |
| chat-type-measure.spec.ts | 110 | toBe | 15px | 15px | — | composer placeholder steps to 14px — one notch under the 15px body |
| chat-type-measure.spec.ts | 128 | toBe | 24 | 24 | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 129 | toBe | 15px | 15px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 130 | toEqual | {"w":20,"h":20} | {"w":20,"h":20} | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 131 | toBe | 31px | 31px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 171 | toEqual | [] | [] | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 175 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 176 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 179 | toBeGreaterThanOrEqual | ≥ 16 | 21 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 180 | toBeLessThanOrEqual | ≤ 32 | 21 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| checkbox-unified.spec.ts | 69 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 70 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 71 | toHaveCSS | clip-path: inset(50%) | inset(50%) | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 102 | toBeGreaterThan | > 15.5 | 16 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 103 | toBeLessThan | < 16.5 | 16 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 104 | toBeGreaterThan | > 15.5 | 16 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 105 | toBeLessThan | < 16.5 | 16 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 106 | toHaveCSS | border-radius: 0px | 0px | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 108 | toHaveCSS | font-size: 13px | 13px | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 113 | toBeGreaterThan | > 7.5 | 8 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 114 | toBeLessThan | < 8.5 | 8 | — | accept: tile 几何 = 16×16 / 圆角 0 / 与文字 gap 8 / 文字 13px |
| checkbox-unified.spec.ts | 128 | toContain | 0.1s | background-color, box-shadow, transform \| 0.1s, 0.1s, 0.08s \| ease-out, ease-out, ease-out | — | accept: 手作三值 = tile 底色 100ms / 勾进场 140ms overshoot / 勾退场 90ms |
| checkbox-unified.spec.ts | 129 | toContain | 0.08s | background-color, box-shadow, transform \| 0.1s, 0.1s, 0.08s \| ease-out, ease-out, ease-out | — | accept: 手作三值 = tile 底色 100ms / 勾进场 140ms overshoot / 勾退场 90ms |
| checkbox-unified.spec.ts | 136 | toContain | 0.14s | 0.14s, 0.14s \| cubic-bezier(0.34, 1.4, 0.64, 1), cubic-bezier(0.34, 1.4, 0.64, 1) | — | accept: 手作三值 = tile 底色 100ms / 勾进场 140ms overshoot / 勾退场 90ms |
| chief-composer-tools.spec.ts | 326 | toBeLessThanOrEqual | ≤ 610 | 604 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 328 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 329 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 400 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 406 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 431 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 433 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 438 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-drawer-model.spec.ts | 59 | toBeLessThanOrEqual | ≤ 2 | 0.5 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 60 | toBeLessThanOrEqual | ≤ 2 | 0 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 61 | toBeGreaterThanOrEqual | ≥ 1022 | 1036 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 62 | toBeLessThanOrEqual | ≤ 1440 | 1316 | — | the model row is a control that opens the anchored model popover |
| chief-drawer-model.spec.ts | 110 | toBeGreaterThanOrEqual | ≥ 4.5 | 6.183474025421862 | — | the selected model row is readable in both themes (#751 A) |
| chief-drawer-model.spec.ts | 111 | not.toBe | rgba(0, 0, 0, 0) | rgb(54, 49, 64) | color(srgb …) folded to rgb(54, 49, 64); re-pin the spec to the rgb/hex form (#411) | the selected model row is readable in both themes (#751 A) |
| chief-drawer-model.spec.ts | 159 | not.toBe | rgba(0, 0, 0, 0) | rgb(218, 203, 221) | color(srgb …) folded to rgb(218, 203, 221); re-pin the spec to the rgb/hex form (#411) | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 160 | toBeCloseTo | 1 ±0.05 | 1 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 161 | toBeCloseTo | 1 ±0.05 | 1 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 163 | toBeCloseTo | 20 ±0.05 | 20 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 164 | toBeCloseTo | 20 ±0.05 | 20 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 170 | toBe | 278 | 278 | — | the selected row fill bleeds to the popover edges (#872) |
| chief-drawer-model.spec.ts | 187 | toBe | 1 | 1 | — | the picker search is typeahead-only: absent until a key, retracted on clear (#756) |
| chief-drawer-slash.spec.ts | 162 | toBe | 0 | 0 | — | `/clear` runs without sending and toasts confirmation (F1) |
| chief-drawer-slash.spec.ts | 173 | toBe | 0 | 0 | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 178 | toBe | 1 | {"__fn":"() => posts"} | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 190 | toBe | 0 | 0 | — | mid-prompt accept inserts literal text, never runs (F3) |
| chief-drawer-slash.spec.ts | 210 | toBeGreaterThanOrEqual | ≥ 0 | 230.22000122070312 | — | /help opens the command panel with the drawer builtins |
| chief-fab.spec.ts | 47 | toEqual | {"width":"48px","height":"48px","right":"504px","bottom":"104px"} | {"width":"48px","height":"48px","right":"504px","bottom":"104px"} | — | the gated FAB keeps the family geometry (48×48, pane offset, composer 让位) |
| chief-fab.spec.ts | 92 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 93 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 94 | toBeCloseTo | 1376 ±0.5 | 1376 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 95 | toBeCloseTo | 668 ±0.5 | 668 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 96 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 97 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-panel.spec.ts | 102 | toBeCloseTo | 1022 ±0.5 | 1022 | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 103 | toBeCloseTo | 0 ±0.5 | 0 | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 104 | toBeCloseTo | 418 ±0.5 | 418 | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 105 | toBeCloseTo | 732 ±0.5 | 732 | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 119 | toBe | static | static | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 120 | toBe | 0px | 0px | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 121 | toBe | none | none | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 124 | toBe | 1px | 1px | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 125 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | the panel docks flush right as a full-height 418 column (board) |
| chief-panel.spec.ts | 139 | toBeCloseTo | 782 ±0.5 | 782 | — | board content yields to the panel and the columns keep the D8 guard |
| chief-panel.spec.ts | 150 | toBeGreaterThanOrEqual | ≥ 280 | 280 | — | board content yields to the panel and the columns keep the D8 guard |
| chief-panel.spec.ts | 160 | toBeCloseTo | 1200 ±0.5 | 1200 | — | closing restores the board grid to its resting geometry |
| chief-panel.spec.ts | 167 | toBeGreaterThan | > 0 | 281 | — | closing restores the board grid to its resting geometry |
| chief-panel.spec.ts | 168 | toBeLessThanOrEqual | ≤ 1 | 0 | — | closing restores the board grid to its resting geometry |
| chief-panel.spec.ts | 195 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 195 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 195 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 200 | toBeCloseTo | 1022 ±0.5 | 1022 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 200 | toBeCloseTo | 1022 ±0.5 | 1022 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 200 | toBeCloseTo | 1022 ±0.5 | 1022 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 201 | toBeCloseTo | 0 ±0.5 | 0 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 201 | toBeCloseTo | 0 ±0.5 | 0 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 201 | toBeCloseTo | 0 ±0.5 | 0 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 202 | toBeCloseTo | 418 ±0.5 | 418 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 202 | toBeCloseTo | 418 ±0.5 | 418 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 202 | toBeCloseTo | 418 ±0.5 | 418 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 203 | toBeCloseTo | 732 ±0.5 | 732 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 203 | toBeCloseTo | 732 ±0.5 | 732 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 203 | toBeCloseTo | 732 ±0.5 | 732 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 205 | toBeCloseTo | 782 ±0.5 | 782 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 205 | toBeCloseTo | 782 ±0.5 | 782 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 205 | toBeCloseTo | 782 ±0.5 | 782 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 210 | toBeCloseTo | 1200 ±0.5 | 1200 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 211 | toBeCloseTo | 240 ±0.5 | 240 | — | pages: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 211 | toBeCloseTo | 240 ±0.5 | 240 | — | resources: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 211 | toBeCloseTo | 240 ±0.5 | 240 | — | secondary: the main column narrows by 418 while docked and restores on close |
| chief-panel.spec.ts | 225 | toBeCloseTo | 1022 ±0.5 | 1022 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 226 | toBeCloseTo | 44 ±0.5 | 44 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 227 | toBeCloseTo | 418 ±0.5 | 418 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 228 | toBeCloseTo | 688 ±0.5 | 688 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 232 | toBeCloseTo | 782 ±0.5 | 782 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 233 | toBe | 1022 | 1022 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 239 | toBe | 712 | 712 | — | detail: the panel occupies the right-pane slot, mutually exclusive (D7) |
| chief-panel.spec.ts | 285 | toBe | 60 | 60 | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 289 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 290 | toBe | 60px | 60px | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-panel.spec.ts | 291 | toBe | auto | auto | — | composer keeps one fixed size whether or not a draft is restored (XMON-102) |
| chief-send-fallback.spec.ts | 146 | toBe | 1 | {"__fn":"() => posts"} | — | stale slot: send goes out, fallback toast names it, row heals to 默认 |
| chief-send-fallback.spec.ts | 182 | toBe | 1 | {"__fn":"() => posts"} | — | fresh slot: send goes out with no fallback toast |
| chief-send-fallback.spec.ts | 186 | toBeGreaterThan | > 0 | {"__fn":"() => chiefGets.length"} | — | fresh slot: send goes out with no fallback toast |
| chief-settings.spec.ts | 64 | toBeCloseTo | 16 ±0.05 | 16 | — | agent dialog search keeps its own 16px inset (#872 blast radius) |
| chief-settings.spec.ts | 206 | not.toBe | rgba(0, 0, 0, 0) | rgb(218, 203, 221) | color(srgb …) folded to rgb(218, 203, 221); re-pin the spec to the rgb/hex form (#411) | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 207 | toBeCloseTo | 1 ±0.05 | 1 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 208 | toBeCloseTo | 1 ±0.05 | 1 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 209 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 210 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 215 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 219 | toBe | 218 | 218 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 240 | toBeCloseTo | 12 ±0.05 | 12 | — | 压缩模型 selected row fill bleeds to the menu edges (#872) |
| chief-settings.spec.ts | 302 | toBeLessThanOrEqual | ≤ 202 | 200 | — | 压缩模型 long value truncates, full name on title (dark, #772) |
| chief-settings.spec.ts | 302 | toBeLessThanOrEqual | ≤ 202 | 200 | — | 压缩模型 long value truncates, full name on title (light, #772) |
| chief-stream-markdown.spec.ts | 269 | toBe | 2 | 2 | — | F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675） |
| chief-stream-markdown.spec.ts | 303 | toBe | auto | auto | — | F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动 |
| chief-stream-markdown.spec.ts | 687 | toBe | 44 | 44 | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 688 | toBe | 14px | 14px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 698 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 699 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| collapse-family.spec.ts | 74 | toBe | 1 | 1 | — | both sidebar groups persist side by side |
| collapse-family.spec.ts | 77 | toBe | 1 | 1 | — | both sidebar groups persist side by side |
| composer-inline-mention.spec.ts | 286 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter with a highlight inserts WITHOUT sending; the second Enter sends (r9 §5 fix) |
| composer-inline-mention.spec.ts | 299 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter without a highlight sends as typed (F1: composer-wire-reject law survives) |
| composer-inline-mention.spec.ts | 361 | toBe | 29 | 29 | — | insert lands a trailing space and the caret after it — typing continues outside the token (F6) |
| composer-inline-mention.spec.ts | 536 | toBeLessThanOrEqual | ≤ 632 | 627 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 538 | toBeLessThanOrEqual | ≤ 8 | 2 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 539 | toBeLessThanOrEqual | ≤ 8 | 1 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 619 | toBe | 1 | {"__fn":"() => sent.length"} | — | files: Enter inserts the bare path with a trailing space and sends on second Enter |
| composer-inline-mention.spec.ts | 657 | not.toBe | none | enter | — | chips: Enter-select renders the file chip with a fresh pop |
| composer-inline-mention.spec.ts | 779 | toBe | 1 | {"__fn":"() => sent.length"} | — | five-kind: todo Enter-inserts the plain #seq token without sending |
| composer-inline-mention.spec.ts | 806 | toBe | 1 | {"__fn":"() => sent.length"} | — | five-kind: machine Enter-inserts without sending; second Enter sends |
| composer-paste.spec.ts | 295 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 301 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 305 | toBe | 57 | {"__fn":"() => input.evaluate(el => el.selectionStart)"} | — | detail face: a mid-line image paste lands the token whole-line at the caret |
| composer-paste.spec.ts | 319 | toBe | 2 | {"__fn":"() => uploads.grants.length"} | — | detail face: one multi-image paste puts every token on its own line |
| composer-paste.spec.ts | 321 | toEqual | ["pasted-image-1.png","pasted-image-2.png"] | ["pasted-image-1.png","pasted-image-2.png"] | — | detail face: one multi-image paste puts every token on its own line |
| composer-paste.spec.ts | 338 | toEqual | [] | [] | — | detail face: a text-only paste is never preventDefaulted (FM7 zero change) |
| composer-paste.spec.ts | 355 | toEqual | [] | [] | — | detail face: a non-whitelisted paste is rejected with a toast, grant never fires |
| composer-paste.spec.ts | 374 | toEqual | [] | [] | — | detail face: an over-cap paste is rejected with a toast, grant never fires |
| composer-paste.spec.ts | 387 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a non-image whitelist file (text/plain) is accepted under its real name |
| composer-paste.spec.ts | 420 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face: a mixed file+text clipboard takes the files and drops the text |
| composer-paste.spec.ts | 471 | toBe | 0 | 0 | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 474 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 476 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 481 | toBe | 1 | {"__fn":"() => steers"} | — | detail face: Enter during the upload does not send; after it lands, Enter sends the token |
| composer-paste.spec.ts | 524 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | new-task face: paste inserts the token line-atomic into the spec and save carries it |
| composer-paste.spec.ts | 551 | toBe | 0 | 0 | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 553 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 555 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 560 | toBe | 1 | {"__fn":"() => creates"} | — | new-task face: save is blocked while the paste upload is in flight |
| composer-paste.spec.ts | 602 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | detail face probe: a real Cmd/Ctrl+V clipboard image paste rides the same chain |
| composer-slash.spec.ts | 333 | toBeGreaterThanOrEqual | ≥ 0 | 230.22000122070312 | — | /help opens the command panel |
| composer-slash.spec.ts | 334 | toBeLessThanOrEqual | ≤ 732 | 447.7799987792969 | — | /help opens the command panel |
| composer-wire-reject.spec.ts | 158 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: a rejected steer (409) keeps the draft word for word |
| composer-wire-reject.spec.ts | 179 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: an accepted steer clears the draft |
| composer-wire-reject.spec.ts | 213 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: a rejected send (500) keeps the draft and toasts |
| composer-wire-reject.spec.ts | 239 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: an accepted send clears the draft |
| dead-buttons.spec.ts | 493 | toBeLessThan | < 1.5 | 0 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 494 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 495 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
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
| detail-3pane.spec.ts | 163 | toBe | rgb(53, 53, 61) | rgb(53, 53, 61) | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 164 | toBe | 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 166 | toBeLessThanOrEqual | ≤ 2 | 2 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 180 | toBe | 712 | 712 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 181 | toBeCloseTo | 680 ±0.5 | 680 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 189 | toBeCloseTo | 782 ±0.5 | 782 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 190 | toBeCloseTo | 750 ±0.5 | 750 | — | composer width tracks the center column across both pane states (488 pane / 418 chief dock) |
| detail-3pane.spec.ts | 263 | toBe | 1200 | 1200 | — | fresh phase: the brief owns the whole center column, right pane collapses |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 438.6243362426758 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 431.0004196166992 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 452 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 293.1210174560547 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 232.6558074951172 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 159.59999084472656 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 27 | toBeLessThanOrEqual | ≤ 452.5 | 140.46246337890625 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 30.687828063964844 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 34.499794006347656 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 24 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 103.43949890136719 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 133.67210388183594 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 170.1999969482422 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 28 | toBeGreaterThanOrEqual | ≥ 0 | 179.76876831054688 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 469.3121643066406 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 465.5002136230469 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 476 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 396.5605163574219 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 366.3279113769531 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 329.79998779296875 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 29 | toBeLessThanOrEqual | ≤ 500.5 | 320.2312316894531 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 37 | toBeGreaterThan | > 404 | 1640 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 37 | toBeGreaterThan | > 210 | 308 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| dialog-viewport.spec.ts | 65 | toEqual | {"x":192,"y":428,"width":416,"height":32} | {"x":192,"y":428,"width":416,"height":32} | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 129 | toBeLessThanOrEqual | ≤ 312.5 | 297.50470542907715 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| escape-wiring.spec.ts | 89 | toEqual | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | — | 开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 153 | toEqual | {"winAdds":0,"winRems":0} | {"winAdds":0,"winRems":0} | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 154 | toBe | 6 | 6 | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| footer-copy.spec.ts | 27 | toBeGreaterThan | > 20 | 54 | — | C1: robot row copy puts the row text on the clipboard |
| github-issue-writeback.spec.ts | 169 | toBe | 0 | 0 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| github-issue-writeback.spec.ts | 174 | toBe | 1 | 1 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| machines-local.spec.ts | 122 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 123 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 125 | toBe | 1 | 1 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 126 | toBe | 0.35 | 0.35 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 127 | toBe | 12px | 12px | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 128 | toBe | 60 | 60 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-shell-switch.spec.ts | 124 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 125 | toEqual | {"shellEnabled":"true"} | {"shellEnabled":"true"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 140 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 141 | toEqual | {"shellEnabled":"false"} | {"shellEnabled":"false"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 177 | toBe | 1 | {"__fn":"() => patches"} | — | PATCH 失败：开关回滚 + 可见错误反馈 |
| mention-picker-center.spec.ts | 18 | toHaveCSS | transform: none | none | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 23 | toBe | 400 | 400 | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 25 | toBeLessThanOrEqual | ≤ 1 | 0 | — | mention picker stays centered in the production bundle (#448) |
| merge-reject.spec.ts | 237 | toBe | 1 | {"__fn":"() => merges"} | — | 看板入口：server 真拒（403）时弹层不关，server 文案原样显出 |
| merge-reject.spec.ts | 252 | toBe | 1 | {"__fn":"() => merges"} | — | 合并成功（202）时弹层照常关，不留错误行 |
| notify-banner.spec.ts | 73 | toBe | 1 | 1 | — | 开启 → requestPermission() fires; granted hides the bar |
| notify-banner.spec.ts | 88 | toBe | 1 | 1 | — | 开启 → denied resolution also hides the bar |
| notify-banner.spec.ts | 97 | toBe | 0 | 0 | — | scenarios without the flag never render the strip |
| notify-click.spec.ts | 195 | toBe | 1 | {"__fn":"() => context.serviceWorkers().length"} | — | T1: 已开窗口点击 → 客户端路由到 href 且不整页重载，pending 槽被清 |
| notify-click.spec.ts | 195 | toBe | 1 | {"__fn":"() => context.serviceWorkers().length"} | — | T2: 无已开窗口点击 → openWindow(href) + pending 槽交接，落地页消费路由 |
| notify-click.spec.ts | 294 | toBe | 1 | 1 | — | T1: 已开窗口点击 → 客户端路由到 href 且不整页重载，pending 槽被清 |
| notify-click.spec.ts | 325 | toEqual | ["/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16"] | {"__fn":"() => worker.evaluate(() => self.__opened)"} | — | T2: 无已开窗口点击 → openWindow(href) + pending 槽交接，落地页消费路由 |
| notify-click.spec.ts | 374 | toBe | 3 | {"__fn":"() => page.evaluate(() => window.__swNotifs.length)"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 380 | toEqual | {"href":"/app/todo/todo-x"} | {"href":"/app/todo/todo-x"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 383 | toEqual | {"href":"/app/todo/todo-def"} | {"href":"/app/todo/todo-def"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 387 | toEqual | {"href":"/app?chief=chief-xyz"} | {"href":"/app?chief=chief-xyz"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 389 | toBe | 0 | 0 | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 408 | toBe | 1 | {"__fn":"() => page.evaluate(() => window.__pageNotifs.length)"} | — | T3a: SW 注册失败 → 回退页内 Notification，onclick 整页跳 href |
| overlay-focus.spec.ts | 56 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 57 | not.toBe | rgb(0, 95, 204) | rgb(203, 166, 247) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 61 | toBe | solid | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 62 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 73 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 74 | not.toBe | rgb(0, 95, 204) | rgb(203, 166, 247) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 76 | toBe | solid | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 77 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 95 | toBe | solid | solid | — | Tab focus keeps the brand ring (keyboard reachability preserved) |
| overlay-focus.spec.ts | 96 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | Tab focus keeps the brand ring (keyboard reachability preserved) |
| overlay-focus.spec.ts | 125 | toHaveCSS | animation-name: enter | enter | — | backdrop click closes; entry rides the tw-animate-css fade |
| project-github-issues.spec.ts | 184 | toEqual | [{"number":7}] | [{"number":7}] | — | 1. 已连接 github 项目：入口 → 弹层 → 点选导入 → 详情见 issue 标题与全部标签 |
| project-github-issues.spec.ts | 205 | toEqual | ["state=open&page=1"] | ["state=open&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 211 | toEqual | ["state=open&page=1","state=closed&page=1"] | ["state=open&page=1","state=closed&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 219 | toEqual | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-new-fs-pick.spec.ts | 137 | toBe | 1 | 1 | — | 在飞期按钮 disabled，双击单发 |
| project-new-repo.spec.ts | 242 | toBe | none | none | — | the name input focus ring is the brand ring, not the UA default |
| project-new-repo.spec.ts | 243 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | the name input focus ring is the brand ring, not the UA default |
| project-new-repo.spec.ts | 244 | toContain | rgb(203, 166, 247) | rgb(203, 166, 247) 0px 0px 0px 1px | — | the name input focus ring is the brand ring, not the UA default |
| project-new-repo.spec.ts | 245 | toContain | 1px | rgb(203, 166, 247) 0px 0px 0px 1px | — | the name input focus ring is the brand ring, not the UA default |
| project-new-repo.spec.ts | 259 | toEqual | [{"name":"Plain","teamId":"team-1"}] | [{"name":"Plain","teamId":"team-1"}] | — | untouched submit posts a repo-less body and navigates on 201 |
| project-new-repo.spec.ts | 275 | toEqual | [{"name":"my-repo","teamId":"team-1","kind":"local","localPath":"/tmp/my-repo"},{"name":"pacman","teamId":"tea… | [{"name":"my-repo","kind":"local","localPath":"/tmp/my-repo","teamId":"team-1"},{"name":"pacman","kind":"githu… | — | local and github submits carry kind + their wire field |
| project-new-repo.spec.ts | 319 | toBe | rgb(224, 90, 90) | rgb(224, 90, 90) | — | a 400 localPath reason renders the error row: 路径不存在 |
| project-new-repo.spec.ts | 319 | toBe | rgb(224, 90, 90) | rgb(224, 90, 90) | — | a 400 localPath reason renders the error row: 不是 git 仓库 |
| project-new-repo.spec.ts | 319 | toBe | rgb(224, 90, 90) | rgb(224, 90, 90) | — | a 400 localPath reason renders the error row: 需要绝对路径 |
| project-new-repo.spec.ts | 319 | toBe | rgb(224, 90, 90) | rgb(224, 90, 90) | — | a 400 localPath reason renders the error row: invalid body at localPath: case none |
| project-tasks-toolbar.spec.ts | 46 | toBe | grid | grid | — | view toggle swaps rows for grid cards and persists |
| providers-tabs.spec.ts | 127 | toBe | 456 | 456 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 129 | toBe | 456 | 456 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 131 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 132 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 137 | toBeLessThanOrEqual | ≤ 518.109375 | 518.109375 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| review-reject.spec.ts | 160 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 161 | toBe | 0 | 0 | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 197 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM3: 更多菜单出现「请求修改」入口，弹层收反馈后走同一动作面 |
| review-reject.spec.ts | 252 | toBe | 1 | {"__fn":"() => steerPosts"} | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 253 | toBe | 0 | 0 | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 273 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM2: 打回被拒（409 竞态）draft 逐字保留 + 提示行显性，不静默吞 |
| search-close-flash.spec.ts | 28 | toHaveCSS | transform: none | none | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-close-flash.spec.ts | 28 | toHaveCSS | transform: none | none | — | 三连击：关→开落在开态且输入聚焦 |
| search-close-flash.spec.ts | 71 | toBeLessThanOrEqual | ≤ 0.631221 | 0.511221 | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-focus.spec.ts | 122 | not.toBe | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.1) | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 127 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 137 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 147 | not.toBe | rgba(0, 0, 0, 0) | rgba(255, 255, 255, 0.1) | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 150 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 154 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 181 | toHaveCSS | transform: none | none | — | the caret is not clipped where it meets the input edge |
| search-focus.spec.ts | 208 | toBeGreaterThanOrEqual | ≥ 14 | 16 | — | the caret is not clipped where it meets the input edge |
| search-result-rows.spec.ts | 96 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(first)"} | — | 静息无常亮;hover 哪行亮哪行,且只亮一行 |
| search-result-rows.spec.ts | 134 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(second)"} | — | 鼠标一动让位:键盘光标交还 hover |
| segmented-controls.spec.ts | 42 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | page-tab: unselected hover tints the chip — dark + light |
| segmented-controls.spec.ts | 44 | toBe | rgba(255, 255, 255, 0.05) | rgba(0, 0, 0, 0) | — | page-tab: unselected hover tints the chip — dark + light |
| segmented-controls.spec.ts | 49 | toBe | rgba(28, 25, 23, 0.05) | {"__fn":"() => bg(lightFiles)"} | — | page-tab: unselected hover tints the chip — dark + light |
| segmented-controls.spec.ts | 59 | toBe | rgb(30, 30, 34) | rgb(30, 30, 34) | — | page-tab: selected chip keeps its fill under hover, same geometry as the hover tint |
| segmented-controls.spec.ts | 62 | toBe | rgb(30, 30, 34) | rgb(30, 30, 34) | — | page-tab: selected chip keeps its fill under hover, same geometry as the hover tint |
| segmented-controls.spec.ts | 76 | toBe | 0px | 0px | — | page-tab: selected chip keeps its fill under hover, same geometry as the hover tint |
| segmented-controls.spec.ts | 86 | toEqual | {"x":840,"y":10,"width":50,"height":24} | {"x":840,"y":10,"width":50,"height":24} | — | page-tab: selected chip keeps its fill under hover, same geometry as the hover tint |
| segmented-controls.spec.ts | 105 | toBe | 1px | 1px | — | page-tab group rides the official hairline ring (r2 24b/24c probe) |
| segmented-controls.spec.ts | 106 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | page-tab group rides the official hairline ring (r2 24b/24c probe) |
| segmented-controls.spec.ts | 107 | toBe | 30 | 30 | — | page-tab group rides the official hairline ring (r2 24b/24c probe) |
| segmented-controls.spec.ts | 108 | toBe | 3 | 3 | — | page-tab group rides the official hairline ring (r2 24b/24c probe) |
| segmented-controls.spec.ts | 109 | toBe | 3 | 3 | — | page-tab group rides the official hairline ring (r2 24b/24c probe) |
| segmented-controls.spec.ts | 133 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | sched freq: dark active chip reads against the container, hover tints the rest |
| segmented-controls.spec.ts | 134 | toBe | rgb(30, 30, 34) | rgb(30, 30, 34) | — | sched freq: dark active chip reads against the container, hover tints the rest |
| segmented-controls.spec.ts | 137 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => bg(weekly)"} | — | sched freq: dark active chip reads against the container, hover tints the rest |
| segmented-controls.spec.ts | 140 | toBe | rgb(231, 227, 218) | rgb(231, 227, 218) | — | sched freq: dark active chip reads against the container, hover tints the rest |
| segmented-controls.spec.ts | 143 | toBe | rgba(28, 25, 23, 0.05) | {"__fn":"() => bg(lightWeekly)"} | — | sched freq: dark active chip reads against the container, hover tints the rest |
| segmented-controls.spec.ts | 150 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => bg(history)"} | — | files seg + tasks view toggle: hover tints the unselected (dark) |
| segmented-controls.spec.ts | 155 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => bg(grid)"} | — | files seg + tasks view toggle: hover tints the unselected (dark) |
| segmented-controls.spec.ts | 164 | toBe | rgba(28, 25, 23, 0.05) | {"__fn":"() => bg(dark)"} | — | user-menu 外观 seg: hover tints, click switches the theme |
| segmented-controls.spec.ts | 183 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => bg(git)"} | — | branch-dialog seg: hover tints Git, click swaps the tab body |
| segmented-controls.spec.ts | 199 | toBe | 1px | 1px | — | team layout toggle: official ring border + hover tint + chip token |
| segmented-controls.spec.ts | 200 | toBe | rgb(221, 216, 204) | rgb(221, 216, 204) | — | team layout toggle: official ring border + hover tint + chip token |
| segmented-controls.spec.ts | 201 | toBe | rgb(231, 227, 218) | rgb(231, 227, 218) | — | team layout toggle: official ring border + hover tint + chip token |
| segmented-controls.spec.ts | 205 | toBe | rgba(28, 25, 23, 0.05) | {"border":"1px","groupBg":"rgb(221, 216, 204)"} | — | team layout toggle: official ring border + hover tint + chip token |
| segmented-controls.spec.ts | 214 | toBe | rgba(28, 25, 23, 0.05) | {"__fn":"() => bg(charter)"} | — | chief tabs: hover tints, click swaps the view |
| segmented-controls.spec.ts | 241 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 242 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 243 | toBeLessThanOrEqual | ≤ 1 | 0.015625 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 244 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 248 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 254 | toEqual | {"pillZ":"0","pillPe":"none","tabZ":"1"} | {"pillZ":"0","pillPe":"none","tabZ":"1"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 292 | toEqual | ["left","width"] | {"__fn":"() => page.evaluate(() => [...new Set(window.__pillRuns)].sort())"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 305 | toBeLessThanOrEqual | ≤ 1 | {"__fn":"async () => {\n    const [p, c] = await Promise.all([box(pill), box(charter)]);\n    return Math.max(… | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| shadcn-primitives.spec.ts | 66 | toBe | contents | contents | — | avatar 落点不生成盒：img 的 containing block 仍是 per-face 容器 |
| shadcn-primitives.spec.ts | 69 | toBe | 24 | 24 | — | avatar 落点不生成盒：img 的 containing block 仍是 per-face 容器 |
| shadcn-primitives.spec.ts | 70 | toBe | 24 | 24 | — | avatar 落点不生成盒：img 的 containing block 仍是 per-face 容器 |
| shadcn-primitives.spec.ts | 71 | toBe | 44 | 44 | — | avatar 落点不生成盒：img 的 containing block 仍是 per-face 容器 |
| shadcn-primitives.spec.ts | 94 | toBe | 16 | 16 | — | tag-chip 落点：落在 registry Badge 上，别名类与 per-face 几何双保（卡面 16 / 面板面 20） |
| shadcn-primitives.spec.ts | 105 | toBe | 20 | 20 | — | tag-chip 落点：落在 registry Badge 上，别名类与 per-face 几何双保（卡面 16 / 面板面 20） |
| shell-consistency.spec.ts | 45 | toEqual | {"x":0,"y":0,"width":240,"height":732} | {"x":0,"y":0,"width":240,"height":732} | — | expanded sidebar keeps identical geometry across /app ↔ /app/team ↔ resources hops |
| shell-consistency.spec.ts | 45 | toEqual | {"x":0,"y":0,"width":40,"height":732} | {"x":0,"y":0,"width":40,"height":732} | — | collapsed rail survives route hops (storage-backed on every shell) |
| shell-consistency.spec.ts | 162 | toEqual | {"iconX":19,"nameX":46,"toggleX":197} | {"__fn":"() => headContentX(page)"} | — | the brand head holds its inner geometry across the /app → /app/team hop |
| shell-consistency.spec.ts | 191 | toBe | 1 | {"__fn":"() => page.evaluate(k => localStorage.getItem(k), SIDEBAR_KEY)"} | — | the collapse toggle works off-board and the state rides back |
| shell-consistency.spec.ts | 213 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | no storage + system light boots light |
| shell-consistency.spec.ts | 219 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | no storage + system dark boots dark |
| shell-consistency.spec.ts | 226 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | a stored theme beats the system scheme |
| sidebar-nav.spec.ts | 96 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 100 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => pillBg(row)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 107 | toBe | rgba(28, 25, 23, 0.05) | {"__fn":"() => pillBg(lightRow)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 115 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 117 | toBe | rgba(255, 255, 255, 0.05) | {"__fn":"() => pillBg(row)"} | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 130 | toBe | rgba(255, 255, 255, 0.1) | rgba(255, 255, 255, 0.1) | — | selected row keeps its own pill under hover |
| sidebar-seam.spec.ts | 45 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 45 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 46 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 46 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 47 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 47 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 48 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 48 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 49 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 49 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 52 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 52 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 53 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 53 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 54 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 54 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 55 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 55 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 56 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 56 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 72 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (light) |
| sidebar-seam.spec.ts | 72 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (dark) |
| sidebar-seam.spec.ts | 98 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 98 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 99 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 99 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 100 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 100 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 101 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 101 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 103 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 103 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 104 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 104 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 123 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 123 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 124 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 124 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 125 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 125 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 145 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 145 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 146 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 146 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 147 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 147 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-visual.spec.ts | 60 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 60 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 62 | toBe | 1px | 1px | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 62 | toBe | 1px | 1px | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 64 | toBeGreaterThanOrEqual | ≥ 72 | 196.421875 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 64 | toBeGreaterThanOrEqual | ≥ 72 | 196.421875 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 65 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 65 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 66 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 66 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 68 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 68 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 69 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 69 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 103 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 103 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 106 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 106 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 107 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 107 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 108 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 108 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 112 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 112 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 113 | toBe | 239 | 239 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 113 | toBe | 239 | 239 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 114 | toBe | 240 | 240 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 114 | toBe | 240 | 240 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 141 | toBeGreaterThan | > 6 | 31.400000000000034 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 141 | toBeGreaterThan | > 6 | 34.64999999999999 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 143 | toBeGreaterThan | > 37.400000000000034 | 62.79999999999998 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 143 | toBeGreaterThan | > 40.64999999999999 | 69.30000000000001 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 151 | toBe | rgba(28, 25, 23, 0.1) | rgba(28, 25, 23, 0.1) | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 151 | toBe | rgba(255, 255, 255, 0.1) | rgba(255, 255, 255, 0.1) | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 174 | toBe | absolute | absolute | — | machine-online dot keeps its absolute anchor |
| sidebar-visual.spec.ts | 175 | toBeLessThan | < 2 | 0 | — | machine-online dot keeps its absolute anchor |
| skills-page.spec.ts | 81 | toBeGreaterThan | > 0 | 1 | — | live 列表消费 GET /api/skills（server 换源后 wire 形状不变） |
| skills-page.spec.ts | 137 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 144 | toBeCloseTo | 1440 ±0.5 | 1440 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 145 | toBeGreaterThan | > 768 | 1200 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 154 | toBeGreaterThanOrEqual | ≥ 0 | 668 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 155 | toBeLessThanOrEqual | ≤ 733 | 732 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 158 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 160 | toBe | 0 | 0 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 161 | toBe | 44 | 44 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 162 | toBe | 0 | 0 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-write.spec.ts | 228 | toBeGreaterThanOrEqual | ≥ 2 | 2 | — | live 编辑预填读 404：表单让位错误块，列表失效重取 |
| spec-brief-card.spec.ts | 126 | toBe | 160px | 160px | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 128 | toBe | 100% | 100% | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 147 | toBe | 1px | 1px | — | 4. 简报卡配方 = composer 卡家族（1px 边线 / 方角 / surface-secondary 底） |
| spec-brief-card.spec.ts | 148 | toBe | 0px | 0px | — | 4. 简报卡配方 = composer 卡家族（1px 边线 / 方角 / surface-secondary 底） |
| spec-brief-card.spec.ts | 150 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | 4. 简报卡配方 = composer 卡家族（1px 边线 / 方角 / surface-secondary 底） |
| spec-brief-card.spec.ts | 151 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | 4. 简报卡配方 = composer 卡家族（1px 边线 / 方角 / surface-secondary 底） |
| spec-brief-card.spec.ts | 152 | toBe | 15px | 15px | — | 4. 简报卡配方 = composer 卡家族（1px 边线 / 方角 / surface-secondary 底） |
| spec-brief-card.spec.ts | 170 | toBeLessThanOrEqual | ≤ 2 | 0.04399999999998272 | — | 4b. 宽屏下行宽吃 68ch cap（#470 的 60–75 字符带同律） |
| spec-brief-card.spec.ts | 208 | toBe | baseline | baseline | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 209 | not.toBe | rgb(234, 232, 238) | rgb(176, 175, 182) | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 210 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 214 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-flow.spec.ts | 125 | toBeLessThan | < 44 | -804.296875 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 129 | toBeGreaterThanOrEqual | ≥ 43 | 78.703125 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 130 | toBeGreaterThan | > 200 | 883 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 140 | toBe | 712 | 712 | — | 3. 超长无断点行包进中栏：chat 横向 scrollWidth 等于 clientWidth |
| spinner-live.spec.ts | 66 | toEqual | ["0deg","60deg","120deg"] | ["0deg","60deg","120deg"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 78 | toBe | 900 | 900 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 86 | toBe | 1800 | 1800 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 91 | toEqual | ["-0.9s","-0.6s","-0.3s"] | ["-0.9s","-0.6s","-0.3s"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 99 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 100 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 101 | toBe | relative | relative | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 109 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 110 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 111 | toBe | 9999px | 9999px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 114 | toBe | 1px | 1px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 118 | toBe | 20px | 20px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 134 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 136 | toBe | rgb(203, 166, 247) | rgb(203, 166, 247) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 159 | toBe | 0 | 0 | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 161 | toBe | none | none | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 162 | not.toBe | none | matrix(0.5, 0.866025, -0.866025, 0.5, 0, 0) | — | prefers-reduced-motion freezes the spins with the static settle transform |
| team-org-chart.spec.ts | 57 | toEqual | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 63 | toEqual | ["r3-builder","r5-scribe","r9-scout"] | ["r3-builder","r5-scribe","r9-scout"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 79 | toBe | dashed | dashed | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 80 | toBe | 8px | 8px | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 81 | toBe | 56 | 56 | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 95 | toBe | 44 | 44 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 96 | toBe | 1 | 1 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 105 | toBe | 28 | 28 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 106 | toBe | 127 | 127 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 107 | toBe | 255 | 255 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| theme-toggle.spec.ts | 30 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 36 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 45 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 49 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 55 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | selection survives reload |
| theme-toggle.spec.ts | 64 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | injected storage pins the initial segment (storage injection path) |
| theme-toggle.spec.ts | 72 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | clicking the active segment is a stable no-op |
| theme-toggle.spec.ts | 99 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | theme flip rides the transition suppression and drops it after the paint |
| theme-toggle.spec.ts | 125 | toEqual | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | — | icon + apple-touch-icon carry prefers-color-scheme variants that resolve |
| title-band-clicks.spec.ts | 47 | toBeGreaterThan | > 0 | 1 | — | team right-slot action owns its hit area (设置 slot under the same band) |
| token-gate.spec.ts | 206 | toBe | 200 | 200 | — | 鉴权关：零门页零 token 附带，行为与现状一致 |
| transcript-user-words.spec.ts | 210 | toBe | 24 | 24 | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| transcript-user-words.spec.ts | 211 | toBe | 15px | 15px | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| user-menu-trigger.spec.ts | 87 | toBe | 8 | 8 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 87 | toBe | 8 | 8 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 87 | toBe | 8 | 8 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 88 | toBe | 224 | 224 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 88 | toBe | 224 | 224 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 88 | toBe | 224 | 224 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 90 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 90 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 90 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 91 | toBeLessThanOrEqual | ≤ 5 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 91 | toBeLessThanOrEqual | ≤ 5 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 91 | toBeLessThanOrEqual | ≤ 5 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 93 | toBeGreaterThan | > 0 | 14.5 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 93 | toBeGreaterThan | > 0 | 11 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 93 | toBeGreaterThan | > 0 | 14.5 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 170 | toBeLessThanOrEqual | ≤ 1 | 0 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| visual-polish.spec.ts | 83 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 83 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 84 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 84 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 85 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 85 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 86 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 86 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 98 | toBe | 1px | 1px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 98 | toBe | 1px | 1px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 99 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 99 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 100 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 100 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 101 | not.toContain | inset | none | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 101 | not.toContain | inset | none | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 114 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 114 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 115 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 115 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 118 | toContain | rgba(28, 25, 23, 0.07) 0px 2px 4px 0px | rgb(226, 222, 212) 0px 0px 0px 1px inset, rgba(28, 25, 23, 0.07) 0px 2px 4px 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 118 | toContain | rgba(0, 0, 0, 0.2) 0px 2px 4px 0px | rgb(38, 38, 43) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.2) 0px 2px 4px 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 129 | toBe | 1px | 1px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 129 | toBe | 1px | 1px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 130 | toBe | 0px | 0px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 130 | toBe | 0px | 0px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 131 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 131 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 138 | toBe | none | none | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 140 | toContain | rgba(0, 0, 0, 0.12) 4px 4px 0px 0px | rgba(0, 0, 0, 0.12) 4px 4px 0px 0px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 167 | toBe | rgb(239, 236, 229) | rgb(239, 236, 229) | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 167 | toBe | rgb(23, 23, 26) | rgb(23, 23, 26) | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 168 | toBe | 1px | 1px | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 168 | toBe | 1px | 1px | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 169 | toBe | rgb(226, 222, 212) | rgb(226, 222, 212) | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 169 | toBe | rgb(38, 38, 43) | rgb(38, 38, 43) | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 170 | toBe | none | none | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 170 | toBe | none | none | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 194 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 194 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 195 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 195 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 199 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 199 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 207 | toBeGreaterThan | > 0 | 281 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 207 | toBeGreaterThan | > 0 | 281 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 208 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 208 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 223 | toBe | 1px | 1px | — | collapsed rail keeps the same drawn-seam treatment (#135 裁决 v2) |
| visual-polish.spec.ts | 224 | toBe | none | none | — | collapsed rail keeps the same drawn-seam treatment (#135 裁决 v2) |
| z-ladder.spec.ts | 62 | toEqual | ["true","true","true","true","true"] | ["true","true","true","true","true"] | — | every probe point of the new-task panel hit-tests inside the panel |

```
