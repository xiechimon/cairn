```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-09T14:02:10.805Z · commit `e87186d3` · port 8400 · playwright 1.63.0 · workers 4

Specs: all (112 files) · tests 861 passed / 1 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 155 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 147 | 148 |
| .boundingBox() call sites | 111 | 111 |
| .toHaveCSS() call sites | 19 | 19 |
| visual-matcher assertion sites | 888 | 1098 joined |

Comparison rows: 894 — KEPT 894, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (894)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| accent-typo.spec.ts | 44 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 44 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 45 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 45 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 59 | toBe | 500 | 500 | — | empty-state headline rides the registry EmptyTitle tier (light) |
| accent-typo.spec.ts | 59 | toBe | 500 | 500 | — | empty-state headline rides the registry EmptyTitle tier (dark) |
| accent-typo.spec.ts | 84 | toBe | rgb(18, 15, 11) | rgb(18, 15, 11) | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 84 | toBe | rgb(238, 232, 228) | rgb(238, 232, 228) | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 85 | not.toBe | rgba(0, 0, 0, 0) | rgb(18, 15, 11) | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 85 | not.toBe | rgba(0, 0, 0, 0) | rgb(238, 232, 228) | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 86 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman brand mark + name (light) |
| accent-typo.spec.ts | 86 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman brand mark + name (dark) |
| accent-typo.spec.ts | 105 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(89, 84, 80)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(89, 84, 80)"} | — | resources back chevron hover shows no background change (light) |
| accent-typo.spec.ts | 105 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(179, 174, 170)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(179, 174, 170)"} | — | resources back chevron hover shows no background change (dark) |
| accent-typo.spec.ts | 122 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 122 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 123 | toBe | none | none | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 123 | toBe | none | none | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 127 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(54, 50, 46)"} | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(54, 50, 46)"} | — | the sidebar collapse toggle shows no hover face (light) |
| accent-typo.spec.ts | 127 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(179, 174, 170)"} | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(179, 174, 170)"} | — | the sidebar collapse toggle shows no hover face (dark) |
| accent-typo.spec.ts | 173 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 173 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 174 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(54, 50, 46)","opacity":"1","iconX":203,"iconY":13.5,"ico… | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(54, 50, 46)","opacity":"1","iconX":203,"iconY":13.5,"ico… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 174 | toEqual | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(179, 174, 170)","opacity":"1","iconX":203,"iconY":13.5,"… | {"bg":"rgba(0, 0, 0, 0)","shadow":"none","color":"rgb(179, 174, 170)","opacity":"1","iconX":203,"iconY":13.5,"… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 179 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 179 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 180 | toEqual | {"bg":"rgba(28, 25, 21, 0.05)","shadow":"none","color":"rgb(54, 50, 46)","opacity":"1","iconX":12,"iconY":13.5… | {"bg":"rgba(28, 25, 21, 0.05)","shadow":"none","color":"rgb(54, 50, 46)","opacity":"1","iconX":12,"iconY":13.5… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 180 | toEqual | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(179, 174, 170)","opacity":"1","iconX":12,"iconY… | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(179, 174, 170)","opacity":"1","iconX":12,"iconY… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 203 | toBe | solid | solid | — | resources back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 203 | toBe | solid | solid | — | resources back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 204 | toBe | 2px | 2px | — | resources back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 204 | toBe | 2px | 2px | — | resources back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 206 | toBe | rgb(151, 34, 126) | rgb(151, 34, 126) | — | resources back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 206 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | resources back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 266 | toBe | rgb(158, 44, 73) | rgb(158, 44, 73) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 266 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 267 | toBe | rgb(240, 235, 230) | rgb(240, 235, 230) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 267 | toBe | rgb(38, 34, 31) | rgb(38, 34, 31) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 268 | toBeGreaterThanOrEqual | ≥ 4.5 | 6.092504029110813 | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 268 | toBeGreaterThanOrEqual | ≥ 4.5 | 8.836100618782584 | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 276 | toBe | rgb(151, 34, 126) | rgb(151, 34, 126) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 276 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 277 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 277 | toBe | rgb(31, 27, 24) | rgb(31, 27, 24) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 278 | toBeGreaterThanOrEqual | ≥ 4.5 | 7.378921178215861 | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 278 | toBeGreaterThanOrEqual | ≥ 4.5 | 8.14426711269384 | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 295 | toHaveCSS | background-color: rgba(151, 34, 126, 0.14) | rgba(151, 34, 126, 0.14) | color(srgb …) folded to rgba(151, 34, 126, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 295 | toHaveCSS | background-color: rgba(242, 148, 216, 0.14) | rgba(242, 148, 216, 0.14) | color(srgb …) folded to rgba(242, 148, 216, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (dark) |
| accent-typo.spec.ts | 300 | toHaveCSS | background-color: rgba(158, 44, 73, 0.14) | rgba(158, 44, 73, 0.14) | color(srgb …) folded to rgba(158, 44, 73, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 300 | toHaveCSS | background-color: rgba(255, 171, 183, 0.14) | rgba(255, 171, 183, 0.14) | color(srgb …) folded to rgba(255, 171, 183, 0.14); re-pin the spec to the rgb/hex form (#411) | P4 row hover rides accent-soft, delete row rides danger-soft (dark) |
| account-controls.spec.ts | 129 | toBe | 1 | {"__fn":"() => patchBodies.length"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 130 | toEqual | {"displayName":"落库名字"} | {"displayName":"落库名字"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 143 | toBe | 2 | {"__fn":"() => patchBodies.length"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 169 | toBe | 0 | 0 | — | 开关：granted 态能关掉、关档随刷新持久、能再开回来（S1/S2） |
| account-controls.spec.ts | 187 | toBe | 1 | 1 | — | 开关：denied 态开出偏好档 + 拦截解释、关得掉，两档都随刷新持久（S3/S4） |
| account-controls.spec.ts | 212 | toBe | 1 | 1 | — | 开关：default 态开出驱动 requestPermission，granted 落定后开档持久（S5） |
| account-controls.spec.ts | 271 | toBeGreaterThanOrEqual | ≥ 4 | 4 | — | 探针：帐号卡内每个控件点击都有可观察效果（P1，不只验改名与开关两个） |
| account-team-cleanse.spec.ts | 52 | toBe | 1 | 1 | — | account switch: default permission renders off; click requests and grants |
| account-team-cleanse.spec.ts | 62 | toBe | 0 | 0 | — | account switch: granted permission renders checked without a click |
| account-team-cleanse.spec.ts | 76 | toBe | 1 | 1 | — | account switch: denied 态点击落偏好开档 + 拦截解释（#1031 语义改写） |
| agent-create-model.spec.ts | 189 | toBeGreaterThanOrEqual | ≥ -0.5 | 374.5 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 190 | toBeGreaterThanOrEqual | ≥ -0.5 | 517 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 191 | toBeLessThanOrEqual | ≤ 732.5 | 430.5 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 192 | toBeLessThanOrEqual | ≤ 1440.5 | 933 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 202 | toBeGreaterThanOrEqual | ≥ -0.5 | 438.5 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 203 | toBeGreaterThanOrEqual | ≥ -0.5 | 517 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 204 | toBeLessThanOrEqual | ≤ 732.5 | 578.5 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 205 | toBeLessThanOrEqual | ≤ 1440.5 | 933 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 238 | toBeGreaterThanOrEqual | ≥ -0.5 | 438.5 | — | 模型很多：选过运行时后菜单不越出视口，首行可点，40 行一个不少 |
| agent-create-model.spec.ts | 239 | toBeLessThanOrEqual | ≤ 732.5 | 722 | — | 模型很多：选过运行时后菜单不越出视口，首行可点，40 行一个不少 |
| agent-delete.spec.ts | 48 | toHaveCSS | font-size: 14px | 14px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-delete.spec.ts | 49 | toHaveCSS | line-height: 20px | 20px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-detail.spec.ts | 186 | toBeLessThan | < 1208 | 1125.578125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 187 | toBeGreaterThan | > 1125.59375 | 1269.578125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 190 | toBeLessThanOrEqual | ≤ 454 | 414 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 191 | toBeGreaterThanOrEqual | ≥ 406 | 470 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 193 | toBeGreaterThanOrEqual | ≥ -0.5 | 1125.578125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 194 | toBeGreaterThanOrEqual | ≥ -0.5 | 414 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 195 | toBeLessThanOrEqual | ≤ 1440.5 | 1269.578125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 196 | toBeLessThanOrEqual | ≤ 732.5 | 470 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 258 | toBeGreaterThan | > -1 | 3 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 259 | toBeLessThan | < 4 | 3 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 405 | toBe | 1 | {"__fn":"() => patches"} | — | 权限 tab：保存失败出可见错误反馈，开关不回弹 |
| agent-detail.spec.ts | 460 | toEqual | ["验收只看真机跑通","PROBE 探针的历史轮次"] | ["验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：搜索扫 content 且 ASCII 大小写不敏感 |
| agent-detail.spec.ts | 478 | toEqual | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 490 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 509 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通"] | ["PROBE 探针的历史轮次","验收只看真机跑通"] | — | 记忆 tab：搜索与排序叠加——排序只在命中集内生效 |
| agent-detail.spec.ts | 600 | toEqual | ["名称","职责","默认 skill","运行时","模型","思考强度"] | ["名称","职责","默认 skill","运行时","模型","思考强度"] | — | 概览：六个字段行长在同一张模板卡里，头像头在卡内 |
| agent-detail.spec.ts | 651 | toEqual | ["14px","14px"] | ["14px","14px"] | — | 记忆/权限卡：首行不吃卡的上圆角与描边（无方角外溢、无 2px 顶边） |
| agent-detail.spec.ts | 652 | toBe | 0px | 0px | — | 记忆/权限卡：首行不吃卡的上圆角与描边（无方角外溢、无 2px 顶边） |
| agent-identity-chip.spec.ts | 61 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 62 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 66 | toBe | 12px | 12px | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 74 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| agent-identity-chip.spec.ts | 75 | toBe | pointer | pointer | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| attachment-strip.spec.ts | 296 | toBe | 120 | {"x":257,"y":611,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 302 | toBe | 1 | {"x":257,"y":611,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 304 | toBe | 1 | {"x":257,"y":611,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 315 | toBe | 120 | {"x":257,"y":611,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 317 | toEqual | {"x":257,"y":611,"width":160,"height":16} | {"x":257,"y":611,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 330 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 332 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 345 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 374 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 385 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 415 | toBe | 1 | {"__fn":"() => held.length"} | — | detail face: a failed upload clears the placeholder, toasts, keeps the draft |
| attachment-strip.spec.ts | 457 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 459 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 469 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 533 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 535 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 545 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | chief face: placeholder → settled chip → preview |
| board-dnd-live.spec.ts | 140 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 154 | toBeGreaterThanOrEqual | ≥ 0 | 2 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 156 | toEqual | [] | [] | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 190 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: PATCH 409 = 乐观值作废，卡片弹回源列 + toast 点名失败（#638） |
| board-dnd-live.spec.ts | 212 | toEqual | [] | [] | — | live: review(有变更)→已完成 开 done 闸，取消 = 零 PATCH、卡停源列 (#901) |
| board-dnd-live.spec.ts | 219 | toEqual | [] | [] | — | live: review(有变更)→已完成 开 done 闸，取消 = 零 PATCH、卡停源列 (#901) |
| board-dnd-live.spec.ts | 236 | toEqual | [] | [] | — | live: review(有变更)→已完成 确认后发 PATCH phase=done，乐观落位 (#901) |
| board-dnd-live.spec.ts | 244 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: review(有变更)→已完成 确认后发 PATCH phase=done，乐观落位 (#901) |
| board-dnd.spec.ts | 365 | toEqual | ["r3-legacy-1","r3-legacy-2"] | ["r3-legacy-1","r3-legacy-2"] | — | 已完成(有变更) → 待处理: reopen commits review, lands after the pinned group |
| board-dnd.spec.ts | 506 | toEqual | [] | [] | — | 重置闸·取消：零提交（卡片不动、计数不动、无请求发出）(#755) |
| board-dnd.spec.ts | 566 | toEqual | [] | [] | — | done 闸·取消：review(有变更) 拖已完成开弹层，取消零提交（卡不动、计数不动、无写请求）(#901) |
| board-dnd.spec.ts | 641 | toBe | 0.4 | 0.4 | — | cards from every column arm the drag gesture (#753) |
| board-dnd.spec.ts | 693 | toEqual | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 698 | toBe | 0 | 0 | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 751 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 751 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 752 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 752 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 753 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 753 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 754 | toBe | 14px | 14px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 754 | toBe | 14px | 14px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 768 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 768 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 774 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 774 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 818 | toBe | rgba(151, 34, 126, 0.1) | rgba(151, 34, 126, 0.1) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 818 | toBe | rgba(242, 148, 216, 0.1) | rgba(242, 148, 216, 0.1) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 819 | toBe | rgb(151, 34, 126) | rgb(151, 34, 126) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 819 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 820 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 820 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 824 | toBe | rgba(151, 34, 126, 0.05) | rgba(151, 34, 126, 0.05) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 824 | toBe | rgba(242, 148, 216, 0.05) | rgba(242, 148, 216, 0.05) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 825 | toBe | rgb(151, 34, 126) | rgb(151, 34, 126) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 825 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 831 | not.toBe | rgba(151, 34, 126, 0.05) | rgb(246, 241, 236) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 831 | not.toBe | rgba(242, 148, 216, 0.05) | rgb(31, 27, 24) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 832 | not.toBe | rgba(151, 34, 126, 0.05) | rgb(246, 241, 236) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 832 | not.toBe | rgba(242, 148, 216, 0.05) | rgb(31, 27, 24) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 874 | toEqual | [] | [] | — | committed drop never flashes the card back to the source column |
| board-docked-reflow.spec.ts | 73 | toBeLessThanOrEqual | ≤ 1200 | 1200 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 78 | toEqual | [{"id":"todo","left":257,"width":281},{"id":"building","left":552,"width":281},{"id":"pending","left":847,"wid… | [{"id":"todo","left":257,"width":281},{"id":"building","left":552,"width":281},{"id":"pending","left":847,"wid… | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 79 | toBeLessThanOrEqual | ≤ 1200 | 1200 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 80 | toBeGreaterThanOrEqual | ≥ 199 | 281 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 91 | toBeGreaterThan | > 784 | 876 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 92 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 97 | toEqual | [{"id":"todo","left":257,"width":200},{"id":"building","left":471,"width":200},{"id":"pending","left":685,"wid… | [{"id":"todo","left":257,"width":200},{"id":"building","left":471,"width":200},{"id":"pending","left":685,"wid… | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 98 | toBeGreaterThan | > 784 | 876 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 102 | toBeLessThanOrEqual | ≤ 0 | 0 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 119 | toBeGreaterThan | > 0 | {"x":240,"y":44,"width":784,"height":688} | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 125 | toBeLessThanOrEqual | ≤ 1025 | 1007 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 126 | toBeGreaterThanOrEqual | ≥ 239 | 807 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 127 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 139 | toHaveCSS | scrollbar-width: auto | auto | — | overflow discloses itself while the window is open: scrollbar stays native |
| board-docked-reflow.spec.ts | 157 | toBeLessThanOrEqual | ≤ 1 | 0 | — | cards keep their exact width across window open/close |
| board-docked-reflow.spec.ts | 174 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 175 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 181 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 187 | toBeGreaterThanOrEqual | ≥ 199 | 281 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 207 | toBeLessThanOrEqual | ≤ 1201 | 1183 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 208 | toBeGreaterThanOrEqual | ≥ 199 | 281 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 209 | toBeGreaterThan | > 607 | 902 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 210 | toBeGreaterThan | > 312 | 607 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 211 | toBeGreaterThan | > 17 | 312 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 220 | toBeLessThanOrEqual | ≤ 1200 | 1200 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 223 | toBeGreaterThan | > 200 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 224 | toBeLessThan | < 282 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 225 | toBeLessThanOrEqual | ≤ 1 | 0 | — | resting geometry at 1440 is untouched by the floor token |
| board-filter.spec.ts | 119 | toContain | rgba(0, 0, 0, 0) | ["rgba(0, 0, 0, 0)","transparent"] | — | 旧场景（无 projectNames）不渲染仓库面；右动作区恰好一钮 = 无底色类型钮；+任务 不存在 |
| board-filter.spec.ts | 494 | toHaveCSS | background-color: rgb(239, 68, 68) | rgb(239, 68, 68) | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-filter.spec.ts | 525 | toBe | 20 | 20 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-filter.spec.ts | 526 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-filter.spec.ts | 527 | toBe | 20 | 20 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-filter.spec.ts | 529 | toBe | 4 | 4 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-filter.spec.ts | 531 | toBe | 26.5 | 26.5 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档 |
| board-overflow.spec.ts | 37 | toBeLessThanOrEqual | ≤ 733 | 719 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 39 | toBeGreaterThanOrEqual | ≥ 43 | 56 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 51 | toBe | auto | auto | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 52 | toBeGreaterThan | > 624 | 1224 | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 60 | toBeGreaterThan | > 0 | 400 | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 74 | toBeGreaterThan | > 0 | {"x":258,"y":94,"width":279,"height":624} | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 83 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 列头固定：列表滚动时 header 的视口位置不动 |
| board-overflow.spec.ts | 100 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 116 | toBeGreaterThan | > 0 | 600 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 117 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 135 | toBeLessThanOrEqual | ≤ 733 | 719 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| board-overflow.spec.ts | 139 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| board-zoom-fit.spec.ts | 74 | toBeLessThanOrEqual | ≤ 1069 | 1069 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 74 | toBeLessThanOrEqual | ≤ 960 | 960 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 74 | toBeLessThanOrEqual | ≤ 912 | 912 | — | no horizontal scroll at 125% zoom (1152px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 76 | toBeLessThanOrEqual | ≤ 1310 | 1292 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 76 | toBeLessThanOrEqual | ≤ 1201 | 1183 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 76 | toBeLessThanOrEqual | ≤ 1153 | 1135 | — | no horizontal scroll at 125% zoom (1152px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 199 | 248.25 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 199 | 221 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 199 | 209 | — | no horizontal scroll at 125% zoom (1152px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 80 | toBeLessThanOrEqual | ≤ 0 | 0 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 80 | toBeLessThanOrEqual | ≤ 0 | 0 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 80 | toBeLessThanOrEqual | ≤ 0 | 0 | — | no horizontal scroll at 125% zoom (1152px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 95 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 96 | toBeGreaterThan | > 784 | 876 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 97 | toBeLessThanOrEqual | ≤ 0 | 0 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 107 | toBeLessThanOrEqual | ≤ 1069 | 1069 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 115 | toBeLessThanOrEqual | ≤ 1069 | 1069 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 116 | toBeGreaterThanOrEqual | ≥ 199 | 248.25 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 117 | toEqual | [248,248,248,248] | [248,248,248,248] | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 125 | toBeLessThanOrEqual | ≤ 1069 | 1069 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 126 | toBeGreaterThanOrEqual | ≥ 199 | 248.25 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 127 | toBeLessThanOrEqual | ≤ 0 | 0 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 144 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case card data stays in-column at the 125% boundary width |
| board-zoom-fit.spec.ts | 145 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case card data stays in-column at the 125% boundary width |
| card-press.spec.ts | 56 | not.toBe | rgb(226, 220, 215) | rgb(240, 235, 230) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 56 | not.toBe | rgb(64, 60, 57) | rgb(38, 34, 31) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 60 | toHaveCSS | background-color: rgb(226, 220, 215) | rgb(226, 220, 215) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 60 | toHaveCSS | background-color: rgb(64, 60, 57) | rgb(64, 60, 57) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 65 | toBe | 1 | 1 | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 65 | toBe | 1 | 1 | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 74 | toHaveCSS | background-color: rgb(240, 235, 230) | rgb(240, 235, 230) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 74 | toHaveCSS | background-color: rgb(38, 34, 31) | rgb(38, 34, 31) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 81 | toHaveCSS | user-select: none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 85 | toBe | none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 114 | toBe | 0 | 0 | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| chat-md-toolout.spec.ts | 87 | toBe | rgb(238, 232, 228) | rgb(238, 232, 228) | — | A3: the output block is left aligned, mono, normal contrast — not a chat-note |
| chat-md-toolout.spec.ts | 131 | toBeGreaterThan | > 290 | 308 | — | B3: nested list items indent past their parent |
| chat-tools-identity.spec.ts | 104 | toBe | 31px | 31px | — | I4: expand/collapse interaction and the #470 row geometry are untouched |
| chat-tools-identity.spec.ts | 105 | toBeLessThanOrEqual | ≤ 16 | 16 | — | I4: expand/collapse interaction and the #470 row geometry are untouched |
| chat-tools-identity.spec.ts | 128 | toEqual | [] | [] | — | I5: the identity row draws no rule — the transcript boundary stays air |
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
| checkbox-unified.spec.ts | 72 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 73 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 74 | toHaveCSS | clip-path: inset(50%) | inset(50%) | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 111 | toBeGreaterThan | > 15.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 112 | toBeLessThan | < 16.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 113 | toBeGreaterThan | > 15.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 114 | toBeLessThan | < 16.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 115 | toHaveCSS | border-radius: 4px | 4px | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 117 | toHaveCSS | font-size: 14px | 14px | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 122 | toBeGreaterThan | > 7.5 | 8 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
| checkbox-unified.spec.ts | 123 | toBeLessThan | < 8.5 | 8 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 14px |
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
| chief-drawer-slash.spec.ts | 211 | toBeGreaterThanOrEqual | ≥ 0 | 261.375 | — | /help opens the command panel with the drawer builtins |
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
| chief-panel.spec.ts | 315 | toBe | 120 | 120 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 316 | toBe | 60 | 60 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 317 | toBe | 120px | 120px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 318 | toBe | 60px | 60px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 320 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 321 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
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
| chief-stream-markdown.spec.ts | 1093 | toBeLessThanOrEqual | ≤ 310 | 310 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1099 | toBeLessThanOrEqual | ≤ 0 | 0 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
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
| composer-slash.spec.ts | 333 | toBeGreaterThanOrEqual | ≥ 0 | 262.40869140625 | — | /help opens the command panel |
| composer-slash.spec.ts | 334 | toBeLessThanOrEqual | ≤ 732 | 469.59130859375 | — | /help opens the command panel |
| composer-wire-reject.spec.ts | 160 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: a rejected steer (409) keeps the draft word for word |
| composer-wire-reject.spec.ts | 183 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: an accepted steer clears the draft |
| composer-wire-reject.spec.ts | 218 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: a rejected send (500) keeps the draft and toasts |
| composer-wire-reject.spec.ts | 244 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: an accepted send clears the draft |
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
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 450.30883979797363 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 447.3801727294922 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 452 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 282.18907165527344 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 286.79542541503906 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 178.221435546875 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 149 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 24.845579147338867 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 26.309921264648438 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 24 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 108.90547180175781 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 106.60227966308594 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 160.8892822265625 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 175.5 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 475.1544189453125 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 473.6900939941406 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 476 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 391.09454345703125 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 393.397705078125 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 339.1107177734375 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 324.5 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 388 | 1480 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 167 | 302 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 243 | 356 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 81 | toEqual | {"x":192,"y":428,"width":416,"height":32} | {"x":192,"y":428,"width":416,"height":32} | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 150 | toBeLessThanOrEqual | ≤ 312.5 | 308.91779708862305 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| dialog-viewport.spec.ts | 185 | toBeLessThanOrEqual | ≤ 372.5 | 372 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 186 | toBeGreaterThanOrEqual | ≥ 0 | 24 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 187 | toBeLessThanOrEqual | ≤ 420.5 | 396 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 198 | toEqual | {"x":628,"y":348,"width":50,"height":32} | {"x":628,"y":348,"width":50,"height":32} | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| escape-wiring.spec.ts | 89 | toEqual | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | — | 开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 157 | toEqual | {"winAdds":0,"winRems":0} | {"winAdds":0,"winRems":0} | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 158 | toBe | 6 | 6 | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| fixture-mode-chip.spec.ts | 40 | toHaveCSS | pointer-events: none | none | — | the chip never swallows clicks — pointer-events-none (#1037) |
| footer-copy.spec.ts | 27 | toBeGreaterThan | > 20 | 54 | — | C1: robot row copy puts the row text on the clipboard |
| github-issue-writeback.spec.ts | 169 | toBe | 0 | 0 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| github-issue-writeback.spec.ts | 174 | toBe | 1 | 1 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| machines-chief-state.spec.ts | 73 | toBe | 60 | 60 | — | 行高契约保持：标注行不破行高（首行 60 / 分隔行 59+1px） |
| machines-chief-state.spec.ts | 80 | toBe | 59 | 59 | — | 行高契约保持：标注行不破行高（首行 60 / 分隔行 59+1px） |
| machines-chief-state.spec.ts | 81 | toBe | 1 | 1 | — | 行高契约保持：标注行不破行高（首行 60 / 分隔行 59+1px） |
| machines-local.spec.ts | 142 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 143 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 145 | toBe | 1 | 1 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 146 | toBe | 0.35 | 0.35 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 147 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 148 | toBe | 60 | 60 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-shell-switch.spec.ts | 126 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 127 | toEqual | {"shellEnabled":"true"} | {"shellEnabled":"true"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 142 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 143 | toEqual | {"shellEnabled":"false"} | {"shellEnabled":"false"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 179 | toBe | 1 | {"__fn":"() => patches"} | — | PATCH 失败：开关回滚 + 可见错误反馈 |
| mention-picker-center.spec.ts | 21 | toHaveCSS | transform: none | none | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 26 | toBe | 400 | 400 | — | mention picker stays centered in the production bundle (#448) |
| mention-picker-center.spec.ts | 28 | toBeLessThanOrEqual | ≤ 1 | 0 | — | mention picker stays centered in the production bundle (#448) |
| merge-reject.spec.ts | 251 | toBe | 1 | {"__fn":"() => merges"} | — | 看板入口：server 真拒（403）时弹层不关，server 文案原样显出 |
| merge-reject.spec.ts | 267 | toBe | 1 | {"__fn":"() => merges"} | — | 合并成功（202）时弹层照常关，不留错误行 |
| notify-banner.spec.ts | 42 | toBe | 1 | 1 | — | 开启 → requestPermission() fires; granted hides the bar |
| notify-banner.spec.ts | 56 | toBe | 1 | 1 | — | 开启 → denied resolution also hides the bar |
| notify-banner.spec.ts | 65 | toBe | 0 | 0 | — | scenarios without the flag never render the strip |
| notify-click.spec.ts | 197 | toBe | 1 | {"__fn":"() => context.serviceWorkers().length"} | — | T1: 已开窗口点击 → 客户端路由到 href 且不整页重载，pending 槽被清 |
| notify-click.spec.ts | 197 | toBe | 1 | {"__fn":"() => context.serviceWorkers().length"} | — | T2: 无已开窗口点击 → openWindow(href) + pending 槽交接，落地页消费路由 |
| notify-click.spec.ts | 296 | toBe | 1 | 1 | — | T1: 已开窗口点击 → 客户端路由到 href 且不整页重载，pending 槽被清 |
| notify-click.spec.ts | 327 | toEqual | ["/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=16"] | {"__fn":"() => worker.evaluate(() => self.__opened)"} | — | T2: 无已开窗口点击 → openWindow(href) + pending 槽交接，落地页消费路由 |
| notify-click.spec.ts | 376 | toBe | 3 | {"__fn":"() => page.evaluate(() => window.__swNotifs.length)"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 382 | toEqual | {"href":"/app/todo/todo-x"} | {"href":"/app/todo/todo-x"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 385 | toEqual | {"href":"/app/todo/todo-def"} | {"href":"/app/todo/todo-def"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 389 | toEqual | {"href":"/app?chief=chief-xyz"} | {"href":"/app?chief=chief-xyz"} | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 391 | toBe | 0 | 0 | — | T3b: SSE 通知 → 走 SW showNotification 且 href 逐类映射正确（页内构造器零调用） |
| notify-click.spec.ts | 410 | toBe | 1 | {"__fn":"() => page.evaluate(() => window.__pageNotifs.length)"} | — | T3a: SW 注册失败 → 回退页内 Notification，onclick 整页跳 href |
| notify-click.spec.ts | 473 | toBe | 1 | {"__fn":"() => page.evaluate(() => window.__swNotifs.length)"} | — | T5: 帐号开关关档（偏好覆盖）→ SSE 通知不弹；开回来即恢复（#1031） |
| notify-click.spec.ts | 474 | toEqual | {"href":"/app/todo/todo-y"} | {"href":"/app/todo/todo-y"} | — | T5: 帐号开关关档（偏好覆盖）→ SSE 通知不弹；开回来即恢复（#1031） |
| notify-click.spec.ts | 477 | toBe | 0 | 0 | — | T5: 帐号开关关档（偏好覆盖）→ SSE 通知不弹；开回来即恢复（#1031） |
| overlay-focus.spec.ts | 72 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 73 | not.toBe | rgb(0, 95, 204) | rgb(242, 148, 216) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 94 | not.toBe | auto | none | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 95 | not.toBe | rgb(0, 95, 204) | rgb(242, 148, 216) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 155 | toHaveCSS | animation-name: enter | enter | — | backdrop click closes; entry rides the registry fade-in |
| page-scroll.spec.ts | 57 | toBeGreaterThan | > 0 | {"x":457,"y":104,"width":766,"height":16} | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 57 | toBeGreaterThan | > 0 | {"x":281,"y":56,"width":856,"height":32} | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 57 | toBeGreaterThan | > 0 | {"x":456,"y":84,"width":768,"height":92} | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 57 | toBeGreaterThan | > 0 | {"x":808,"y":128,"width":64,"height":64} | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 57 | toBeGreaterThan | > 0 | {"x":456,"y":144,"width":768,"height":16} | — | 新建项目页能滚到底 (#1032) |
| page-scroll.spec.ts | 75 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 75 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 75 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 75 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 75 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 新建项目页能滚到底 (#1032) |
| page-scroll.spec.ts | 76 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 76 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 76 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 76 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 76 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 新建项目页能滚到底 (#1032) |
| project-github-issues.spec.ts | 200 | toEqual | [{"number":7}] | [{"number":7}] | — | 1. 已连接 github 项目：入口 → 弹层 → 点选导入 → 详情见 issue 标题与全部标签 |
| project-github-issues.spec.ts | 223 | toEqual | ["state=open&page=1"] | ["state=open&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 229 | toEqual | ["state=open&page=1","state=closed&page=1"] | ["state=open&page=1","state=closed&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 237 | toEqual | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-new-fs-pick.spec.ts | 138 | toBe | 1 | 1 | — | 在飞期按钮 disabled，双击单发 |
| project-new-repo.spec.ts | 254 | toBe | none | none | — | the name input focus ring is the registry ring, not the UA default |
| project-new-repo.spec.ts | 255 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | the name input focus ring is the registry ring, not the UA default |
| project-new-repo.spec.ts | 256 | not.toContain | rgb(0, 95, 204) | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | the name input focus ring is the registry ring, not the UA default |
| project-new-repo.spec.ts | 270 | toEqual | [{"name":"Plain","teamId":"team-1"}] | [{"name":"Plain","teamId":"team-1"}] | — | untouched submit posts a repo-less body and navigates on 201 |
| project-new-repo.spec.ts | 286 | toEqual | [{"name":"my-repo","teamId":"team-1","kind":"local","localPath":"/tmp/my-repo"},{"name":"pacman","teamId":"tea… | [{"name":"my-repo","kind":"local","localPath":"/tmp/my-repo","teamId":"team-1"},{"name":"pacman","kind":"githu… | — | local and github submits carry kind + their wire field |
| project-new-repo.spec.ts | 330 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 路径不存在 |
| project-new-repo.spec.ts | 330 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 不是 git 仓库 |
| project-new-repo.spec.ts | 330 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 需要绝对路径 |
| project-new-repo.spec.ts | 330 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: invalid body at localPath: case none |
| project-tasks-toolbar.spec.ts | 49 | toBe | grid | grid | — | view toggle swaps rows for grid cards and persists |
| providers-tabs.spec.ts | 226 | toBe | 456 | 456 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 228 | toBe | 456 | 456 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 230 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 231 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 236 | toBeLessThanOrEqual | ≤ 507.1875 | 507.1875 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| review-reject.spec.ts | 167 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 168 | toBe | 0 | 0 | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 205 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM3: 更多菜单出现「请求修改」入口，弹层收反馈后走同一动作面 |
| review-reject.spec.ts | 260 | toBe | 1 | {"__fn":"() => steerPosts"} | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 261 | toBe | 0 | 0 | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 281 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM2: 打回被拒（409 竞态）draft 逐字保留 + 提示行显性，不静默吞 |
| schedules-live.spec.ts | 119 | toBeLessThanOrEqual | ≤ 488.5 | 486.16162109375 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 137 | toBe | 1 | {"__fn":"() => posts.length"} | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 147 | toBe | 10 | 10 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 148 | toBe | 0 | 0 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 三连击：关→开落在开态且输入聚焦 |
| search-close-flash.spec.ts | 82 | toBeLessThanOrEqual | ≤ 0.434841 | 0.314841 | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
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
| segmented-controls.spec.ts | 94 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 95 | toBe | rgb(179, 174, 170) | rgb(179, 174, 170) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 97 | toBe | rgb(238, 232, 228) | {"__fn":"() => ink(files)"} | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 101 | toBe | rgba(18, 15, 11, 0.6) | rgba(18, 15, 11, 0.6) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 103 | toBe | rgb(18, 15, 11) | {"__fn":"() => ink(lightFiles)"} | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 113 | toBe | rgba(64, 60, 57, 0.3) | rgba(64, 60, 57, 0.3) | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 116 | toBe | rgba(64, 60, 57, 0.3) | rgba(64, 60, 57, 0.3) | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 130 | toBe | 8px | 8px | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 140 | toEqual | {"x":840,"y":9,"width":54,"height":25} | {"x":840,"y":9,"width":54,"height":25} | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 161 | toBe | 0px | 0px | — | page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset) |
| segmented-controls.spec.ts | 162 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset) |
| segmented-controls.spec.ts | 163 | toBe | 32 | 32 | — | page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset) |
| segmented-controls.spec.ts | 165 | toBe | 4 | 4 | — | page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset) |
| segmented-controls.spec.ts | 166 | toBe | 3 | 3 | — | page-tab group rides the registry TabsList form (bg-muted, 32px, 3px inset) |
| segmented-controls.spec.ts | 190 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 191 | toBe | rgba(64, 60, 57, 0.3) | rgba(64, 60, 57, 0.3) | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 193 | toBe | rgb(179, 174, 170) | rgb(179, 174, 170) | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 195 | toBe | rgb(238, 232, 228) | {"__fn":"() => ink(weekly)"} | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 198 | toBe | rgb(246, 241, 236) | rgb(246, 241, 236) | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 202 | toBe | rgba(18, 15, 11, 0.6) | rgba(18, 15, 11, 0.6) | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 204 | toBe | rgb(18, 15, 11) | {"__fn":"() => ink(lightWeekly)"} | — | sched freq: dark active chip reads against the container, hover steps the rest ink |
| segmented-controls.spec.ts | 210 | toBe | rgb(179, 174, 170) | rgb(179, 174, 170) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 212 | toBe | rgb(238, 232, 228) | {"__fn":"() => ink(history)"} | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 217 | toBe | rgb(238, 232, 228) | {"__fn":"() => ink(grid)"} | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 226 | toBe | rgba(28, 25, 21, 0.05) | {"__fn":"() => bg(dark)"} | — | user-menu 外观 seg: hover tints, click switches the theme |
| segmented-controls.spec.ts | 250 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => bg(git)"} | — | branch-dialog seg: hover tints Git, click swaps the tab body |
| segmented-controls.spec.ts | 272 | toBe | 0px | 0px | — | team layout toggle: registry default Tabs form (muted group, background chip, no ring) |
| segmented-controls.spec.ts | 273 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | team layout toggle: registry default Tabs form (muted group, background chip, no ring) |
| segmented-controls.spec.ts | 274 | toBe | rgb(246, 241, 236) | rgb(246, 241, 236) | — | team layout toggle: registry default Tabs form (muted group, background chip, no ring) |
| segmented-controls.spec.ts | 280 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | team layout toggle: registry default Tabs form (muted group, background chip, no ring) |
| segmented-controls.spec.ts | 282 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => bg(chart)"} | — | team layout toggle: registry default Tabs form (muted group, background chip, no ring) |
| segmented-controls.spec.ts | 293 | toBe | rgba(28, 25, 21, 0.05) | {"__fn":"() => bg(charter)"} | — | chief tabs: hover tints, click swaps the view |
| segmented-controls.spec.ts | 320 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 321 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 322 | toBeLessThanOrEqual | ≤ 1 | 0.015625 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 323 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 327 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 333 | toEqual | {"pillZ":"0","pillPe":"none","tabZ":"1"} | {"pillZ":"0","pillPe":"none","tabZ":"1"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 371 | toEqual | ["left","width"] | {"__fn":"() => page.evaluate(() => [...new Set(window.__pillRuns)].sort())"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 384 | toBeLessThanOrEqual | ≤ 1 | {"__fn":"async () => {\n    const [p, c] = await Promise.all([box(pill), box(charter)]);\n    return Math.max(… | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| shadcn-primitives.spec.ts | 71 | not.toBe | contents | flex | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 74 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 75 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 76 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 77 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 78 | toBe | 44 | 44 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 107 | toBe | 20 | 20 | — | tag-chip 落点：落在 registry Badge 上，别名类保留、几何单档 20px 正本 |
| shadcn-primitives.spec.ts | 118 | toBe | 20 | 20 | — | tag-chip 落点：落在 registry Badge 上，别名类保留、几何单档 20px 正本 |
| shell-consistency.spec.ts | 47 | toEqual | {"x":0,"y":0,"width":240,"height":732} | {"x":0,"y":0,"width":240,"height":732} | — | expanded sidebar keeps identical geometry across /app ↔ /app/team ↔ resources hops |
| shell-consistency.spec.ts | 47 | toEqual | {"x":0,"y":0,"width":40,"height":732} | {"x":0,"y":0,"width":40,"height":732} | — | collapsed rail survives route hops (storage-backed on every shell) |
| shell-consistency.spec.ts | 167 | toEqual | {"iconX":19,"nameX":46,"toggleX":197} | {"__fn":"() => headContentX(page)"} | — | the brand head holds its inner geometry across the /app → /app/team hop |
| shell-consistency.spec.ts | 196 | toBe | 1 | {"__fn":"() => page.evaluate(k => localStorage.getItem(k), SIDEBAR_KEY)"} | — | the collapse toggle works off-board and the state rides back |
| shell-consistency.spec.ts | 219 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | no storage + system light boots light |
| shell-consistency.spec.ts | 225 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | no storage + system dark boots dark |
| shell-consistency.spec.ts | 232 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | a stored theme beats the system scheme |
| sidebar-nav.spec.ts | 107 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 111 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 118 | toBe | rgba(28, 25, 21, 0.05) | {"__fn":"() => pillBg(lightRow)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 126 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 128 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 141 | toBe | rgba(255, 252, 248, 0.1) | rgba(255, 252, 248, 0.1) | — | selected row keeps its own pill under hover |
| sidebar-seam.spec.ts | 50 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 50 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 51 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 51 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 52 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 52 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 53 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 53 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 54 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 54 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 57 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 57 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 58 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 58 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 59 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 59 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 60 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 60 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 61 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 61 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 77 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (light) |
| sidebar-seam.spec.ts | 77 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (dark) |
| sidebar-seam.spec.ts | 103 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 103 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 104 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 104 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 105 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 105 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 106 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 106 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 108 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 108 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 109 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 109 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 128 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 128 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 129 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 129 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 130 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 130 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 152 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 152 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 153 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 153 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 154 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 154 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-visual.spec.ts | 71 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 71 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 74 | toBe | 0px | 0px | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 74 | toBe | 0px | 0px | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 76 | toBeGreaterThanOrEqual | ≥ 72 | 194.640625 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 76 | toBeGreaterThanOrEqual | ≥ 72 | 194.640625 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 77 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 77 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 78 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 78 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 80 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 80 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 81 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 81 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 116 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 116 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 119 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 119 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 120 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 120 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 121 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 121 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 125 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 125 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 126 | toBe | 239 | 239 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 126 | toBe | 239 | 239 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 127 | toBe | 240 | 240 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 127 | toBe | 240 | 240 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 154 | toBeGreaterThan | > 6 | 32.45000000000002 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 154 | toBeGreaterThan | > 6 | 33.65 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 156 | toBeGreaterThan | > 38.45000000000002 | 64.89999999999998 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 156 | toBeGreaterThan | > 39.65 | 67.30000000000001 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 166 | toBe | rgba(28, 25, 21, 0.1) | rgba(28, 25, 21, 0.1) | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 166 | toBe | rgba(255, 252, 248, 0.1) | rgba(255, 252, 248, 0.1) | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 189 | toBe | absolute | absolute | — | machine-online dot keeps its absolute anchor |
| sidebar-visual.spec.ts | 190 | toBeLessThan | < 2 | 0 | — | machine-online dot keeps its absolute anchor |
| skills-page.spec.ts | 86 | toBeGreaterThan | > 0 | 1 | — | live 列表消费 GET /api/skills（server 换源后 wire 形状不变） |
| skills-page.spec.ts | 144 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 151 | toBeCloseTo | 1440 ±0.5 | 1440 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 152 | toBeGreaterThan | > 768 | 1200 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 161 | toBeGreaterThanOrEqual | ≥ 0 | 668 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 162 | toBeLessThanOrEqual | ≤ 733 | 732 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 165 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 167 | toBe | 0 | 0 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 168 | toBe | 44 | 44 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 169 | toBe | 0 | 0 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-write.spec.ts | 231 | toBeGreaterThanOrEqual | ≥ 2 | 2 | — | live 编辑预填读 404：表单让位错误块，列表失效重取 |
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
| spec-flow.spec.ts | 127 | toBeLessThan | < 44 | -797 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 131 | toBeGreaterThanOrEqual | ≥ 43 | 79 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 132 | toBeGreaterThan | > 200 | 876 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 142 | toBe | 712 | 712 | — | 3. 超长无断点行包进中栏：chat 横向 scrollWidth 等于 clientWidth |
| spinner-live.spec.ts | 76 | toEqual | ["0deg","60deg","120deg"] | ["0deg","60deg","120deg"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 88 | toBe | 900 | 900 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 96 | toBe | 1800 | 1800 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 101 | toEqual | ["-0.9s","-0.6s","-0.3s"] | ["-0.9s","-0.6s","-0.3s"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 900ms spin |
| spinner-live.spec.ts | 109 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 110 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 111 | toBe | relative | relative | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 126 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 127 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 128 | toBe | 9999px | 9999px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 131 | toBe | 1px | 1px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 133 | toBe | 20px | 20px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 149 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 151 | toBe | rgb(242, 148, 216) | rgb(242, 148, 216) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 174 | toBe | 0 | 0 | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 176 | toBe | none | none | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 177 | not.toBe | none | matrix(0.5, 0.866025, -0.866025, 0.5, 0, 0) | — | prefers-reduced-motion freezes the spins with the static settle transform |
| team-org-chart.spec.ts | 77 | toEqual | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 83 | toEqual | ["r3-builder","r5-scribe","r9-scout"] | ["r3-builder","r5-scribe","r9-scout"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 99 | toBe | dashed | dashed | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 100 | toBe | 8px | 8px | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 101 | toBe | 56 | 56 | — | chart 组织图：创建 Agent 是子列末位的虚线节点卡 |
| team-org-chart.spec.ts | 113 | toBe | 44 | 44 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 114 | toBe | 1 | 1 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 127 | toBe | 28 | 28 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 128 | toBe | 127 | 127 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 129 | toBe | 255 | 255 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| theme-toggle.spec.ts | 30 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 36 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 45 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 49 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 55 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | selection survives reload |
| theme-toggle.spec.ts | 64 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | injected storage pins the initial segment (storage injection path) |
| theme-toggle.spec.ts | 72 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | clicking the active segment is a stable no-op |
| theme-toggle.spec.ts | 99 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | theme flip rides the transition suppression and drops it after the paint |
| theme-toggle.spec.ts | 125 | toEqual | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | — | icon + apple-touch-icon carry prefers-color-scheme variants that resolve |
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
| title-band-clicks.spec.ts | 50 | toBeGreaterThan | > 0 | 1 | — | team right-slot action owns its hit area (设置 slot under the same band) |
| token-gate.spec.ts | 215 | toBe | 200 | 200 | — | 鉴权关：零门页零 token 附带，行为与现状一致 |
| transcript-user-words.spec.ts | 235 | toBe | 24 | 24 | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| transcript-user-words.spec.ts | 236 | toBe | 15px | 15px | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| user-menu-trigger.spec.ts | 93 | toBe | 8 | 8 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 93 | toBe | 8 | 8 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 93 | toBe | 8 | 8 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 94 | toBe | 224 | 224 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 94 | toBe | 224 | 224 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 94 | toBe | 224 | 224 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 96 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 96 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 96 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 97 | toBeLessThanOrEqual | ≤ 5 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 97 | toBeLessThanOrEqual | ≤ 5 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 97 | toBeLessThanOrEqual | ≤ 5 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 99 | toBeGreaterThan | > 0 | 14.5 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 99 | toBeGreaterThan | > 0 | 11 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 99 | toBeGreaterThan | > 0 | 14.5 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 177 | toBeLessThanOrEqual | ≤ 1 | 0 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| visual-polish.spec.ts | 85 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 85 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 86 | toBe | 14px | 14px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 86 | toBe | 14px | 14px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 87 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 87 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 88 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 88 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 102 | toBe | 1px | 1px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 102 | toBe | 1px | 1px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 103 | toBe | 14px | 14px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 103 | toBe | 14px | 14px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 104 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 104 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 105 | not.toContain | inset | none | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 105 | not.toContain | inset | none | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 120 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 120 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 121 | toBe | 14px | 14px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 121 | toBe | 14px | 14px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 124 | toContain | rgba(28, 25, 23, 0.08) 0px 2px 8px 0px | rgb(234, 228, 224) 0px 0px 0px 1px inset, rgba(28, 25, 23, 0.08) 0px 2px 8px 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 124 | toContain | rgba(0, 0, 0, 0.24) 0px 2px 6px 0px | rgb(45, 41, 38) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.24) 0px 2px 6px 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 138 | toBe | 1px | 1px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 138 | toBe | 1px | 1px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 139 | toBe | 10px | 10px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 139 | toBe | 10px | 10px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 140 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 140 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 147 | toBe | none | none | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 149 | toContain | rgba(0, 0, 0, 0.12) 0px 6px 16px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 176 | toBe | rgb(246, 241, 236) | rgb(246, 241, 236) | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 176 | toBe | rgb(31, 27, 24) | rgb(31, 27, 24) | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 177 | toBe | 1px | 1px | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 177 | toBe | 1px | 1px | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 178 | toBe | rgb(234, 228, 224) | rgb(234, 228, 224) | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 178 | toBe | rgb(45, 41, 38) | rgb(45, 41, 38) | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 179 | toBe | none | none | — | sidebar shares the main-area surface, seam drawn in the divider token (light) |
| visual-polish.spec.ts | 179 | toBe | none | none | — | sidebar shares the main-area surface, seam drawn in the divider token (dark) |
| visual-polish.spec.ts | 203 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 203 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 204 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 204 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 208 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 208 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 216 | toBeGreaterThan | > 0 | 281 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 216 | toBeGreaterThan | > 0 | 281 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 217 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 217 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 232 | toBe | 1px | 1px | — | collapsed rail keeps the same drawn-seam treatment (#135 裁决 v2) |
| visual-polish.spec.ts | 233 | toBe | none | none | — | collapsed rail keeps the same drawn-seam treatment (#135 裁决 v2) |
| z-ladder.spec.ts | 64 | toEqual | ["true","true","true","true","true"] | ["true","true","true","true","true"] | — | every probe point of the new-task panel hit-tests inside the panel |

```
