```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-21T02:39:21.642Z · commit `66c7985c` · port 8397 · playwright 1.63.0 · workers 4

Specs: all (161 files) · tests 1109 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 265 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 245 | 247 |
| .boundingBox() call sites | 163 | 160 |
| .toHaveCSS() call sites | 117 | 117 |
| visual-matcher assertion sites | 1443 | 1882 joined |

Comparison rows: 1595 — KEPT 1587, DRIFT 0, NOT-RUN 8, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## NOT-RUN — no runtime record for this assertion site (8)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| cds-settings.spec.ts | 41 | toBe | 8px | — | — |  |
| cds-settings.spec.ts | 42 | toBe | 32px | — | — |  |
| cds-transcript.spec.ts | 112 | toBe | 12px | — | — |  |
| cds-transcript.spec.ts | 113 | toBe | 16px | — | — |  |
| cds-transcript.spec.ts | 114 | toBeGreaterThanOrEqual | 500 | — | — |  |
| cds-transcript.spec.ts | 117 | toBe | 12px | — | — |  |
| cds-transcript.spec.ts | 118 | toBe | 11.5px | — | — |  |
| cds-transcript.spec.ts | 119 | toBe | 16px | — | — |  |

## KEPT — baseline holds on this build (1587)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| accent-typo.spec.ts | 44 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 44 | toBe | 400 | 400 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 45 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (light) |
| accent-typo.spec.ts | 45 | toBe | 500 | 500 | — | font baseline: body 400, card title 500, var font really loaded (dark) |
| accent-typo.spec.ts | 58 | toBe | 500 | 500 | — | empty-state headline rides the Paper EmptyState title tier (light) |
| accent-typo.spec.ts | 58 | toBe | 500 | 500 | — | empty-state headline rides the Paper EmptyState title tier (dark) |
| accent-typo.spec.ts | 89 | toEqual | ["100%","auto"] | ["100%","auto"] | — | sidebar header carries the Pacman pixel mark + name (light) |
| accent-typo.spec.ts | 89 | toEqual | ["100%","auto"] | ["100%","auto"] | — | sidebar header carries the Pacman pixel mark + name (dark) |
| accent-typo.spec.ts | 90 | toBe | rgb(43, 38, 32) | rgb(43, 38, 32) | — | sidebar header carries the Pacman pixel mark + name (light) |
| accent-typo.spec.ts | 90 | toBe | rgb(236, 231, 223) | rgb(236, 231, 223) | — | sidebar header carries the Pacman pixel mark + name (dark) |
| accent-typo.spec.ts | 91 | not.toBe | rgba(0, 0, 0, 0) | rgb(43, 38, 32) | — | sidebar header carries the Pacman pixel mark + name (light) |
| accent-typo.spec.ts | 91 | not.toBe | rgba(0, 0, 0, 0) | rgb(236, 231, 223) | — | sidebar header carries the Pacman pixel mark + name (dark) |
| accent-typo.spec.ts | 93 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman pixel mark + name (light) |
| accent-typo.spec.ts | 93 | toEqual | {"w":16,"h":16} | {"w":16,"h":16} | — | sidebar header carries the Pacman pixel mark + name (dark) |
| accent-typo.spec.ts | 112 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(116, 106, 95)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(116, 106, 95)"} | — | page shell back chevron hover shows no background change (light) |
| accent-typo.spec.ts | 112 | toEqual | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(172, 167, 160)"} | {"bg":"rgba(0, 0, 0, 0)","color":"rgb(172, 167, 160)"} | — | page shell back chevron hover shows no background change (dark) |
| accent-typo.spec.ts | 128 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle rests bare and shows the row hover on hover (light) |
| accent-typo.spec.ts | 128 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | the sidebar collapse toggle rests bare and shows the row hover on hover (dark) |
| accent-typo.spec.ts | 129 | toBe | none | none | — | the sidebar collapse toggle rests bare and shows the row hover on hover (light) |
| accent-typo.spec.ts | 129 | toBe | none | none | — | the sidebar collapse toggle rests bare and shows the row hover on hover (dark) |
| accent-typo.spec.ts | 143 | toBe | rgb(235, 228, 216) | rgb(235, 228, 216) | — | the sidebar collapse toggle rests bare and shows the row hover on hover (light) |
| accent-typo.spec.ts | 143 | toBe | rgba(255, 252, 248, 0.05) | rgba(255, 252, 248, 0.05) | — | the sidebar collapse toggle rests bare and shows the row hover on hover (dark) |
| accent-typo.spec.ts | 188 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 188 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 189 | toEqual | {"bg":"rgb(235, 228, 216)","shadow":"none","color":"rgb(43, 38, 32)","opacity":"1","iconX":215,"iconY":25,"ico… | {"bg":"rgb(235, 228, 216)","shadow":"none","color":"rgb(43, 38, 32)","opacity":"1","iconX":215,"iconY":25,"ico… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 189 | toEqual | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(236, 231, 223)","opacity":"1","iconX":215,"icon… | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(236, 231, 223)","opacity":"1","iconX":215,"icon… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 194 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 194 | toBe | 1 | 1 | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 195 | toEqual | {"bg":"rgb(235, 228, 216)","shadow":"none","color":"rgb(43, 38, 32)","opacity":"1","iconX":12,"iconY":16,"icon… | {"bg":"rgb(235, 228, 216)","shadow":"none","color":"rgb(43, 38, 32)","opacity":"1","iconX":12,"iconY":16,"icon… | — | the sidebar toggles hold face and geometry while pressed (light) |
| accent-typo.spec.ts | 195 | toEqual | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(236, 231, 223)","opacity":"1","iconX":12,"iconY… | {"bg":"rgba(255, 252, 248, 0.05)","shadow":"none","color":"rgb(236, 231, 223)","opacity":"1","iconX":12,"iconY… | — | the sidebar toggles hold face and geometry while pressed (dark) |
| accent-typo.spec.ts | 218 | toBe | solid | solid | — | page shell back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 218 | toBe | solid | solid | — | page shell back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 219 | toBe | 2px | 2px | — | page shell back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 219 | toBe | 2px | 2px | — | page shell back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 221 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | page shell back chevron keeps a keyboard focus ring (light) |
| accent-typo.spec.ts | 221 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | page shell back chevron keeps a keyboard focus ring (dark) |
| accent-typo.spec.ts | 282 | toBe | rgb(158, 44, 73) | rgb(158, 44, 73) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 282 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 283 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 283 | toBe | rgb(47, 42, 38) | rgb(47, 42, 38) | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 284 | toBeGreaterThanOrEqual | ≥ 4.5 | 7.215748895068962 | — | P5 danger: destructive resolves and reads on card, passes 4.5 (light) |
| accent-typo.spec.ts | 284 | toBeGreaterThanOrEqual | ≥ 4.5 | 7.946361148665461 | — | P5 danger: destructive resolves and reads on card, passes 4.5 (dark) |
| accent-typo.spec.ts | 292 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 292 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 293 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 293 | toBe | rgb(26, 22, 18) | rgb(26, 22, 18) | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 294 | toBeGreaterThanOrEqual | ≥ 4.5 | 4.986470352113856 | — | P5 main-button pair passes 4.5 in both themes (light) |
| accent-typo.spec.ts | 294 | toBeGreaterThanOrEqual | ≥ 4.5 | 7.741367179546055 | — | P5 main-button pair passes 4.5 in both themes (dark) |
| accent-typo.spec.ts | 311 | toHaveCSS | background-color: rgb(246, 242, 236) | rgb(246, 242, 236) | — | Paper menu row hover rides menu-hover, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 311 | toHaveCSS | background-color: rgb(64, 59, 54) | rgb(64, 59, 54) | — | Paper menu row hover rides menu-hover, delete row rides danger-soft (dark) |
| accent-typo.spec.ts | 316 | toHaveCSS | background-color: rgba(158, 44, 73, 0.14) | rgba(158, 44, 73, 0.14) | color(srgb …) folded to rgba(158, 44, 73, 0.14); re-pin the spec to the rgb/hex form (#411) | Paper menu row hover rides menu-hover, delete row rides danger-soft (light) |
| accent-typo.spec.ts | 316 | toHaveCSS | background-color: rgba(255, 171, 183, 0.14) | rgba(255, 171, 183, 0.14) | color(srgb …) folded to rgba(255, 171, 183, 0.14); re-pin the spec to the rgb/hex form (#411) | Paper menu row hover rides menu-hover, delete row rides danger-soft (dark) |
| account-controls.spec.ts | 133 | toBe | 1 | {"__fn":"() => patchBodies.length"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 134 | toEqual | {"displayName":"落库名字"} | {"displayName":"落库名字"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 145 | toBe | 2 | {"__fn":"() => patchBodies.length"} | — | 改名 live：提交发 PATCH /api/user/me、刷新后仍是新名、失败有 toast 点名（R7–R9） |
| account-controls.spec.ts | 171 | toBe | 0 | 0 | — | 开关：granted 态能关掉、关档随刷新持久、能再开回来（S1/S2） |
| account-controls.spec.ts | 189 | toBe | 1 | 1 | — | 开关：denied 态开出偏好档 + 拦截解释、关得掉，两档都随刷新持久（S3/S4） |
| account-controls.spec.ts | 214 | toBe | 1 | 1 | — | 开关：default 态开出驱动 requestPermission，granted 落定后开档持久（S5） |
| account-controls.spec.ts | 274 | toEqual | ["编辑名称","语言","紧凑","推送通知"] | ["编辑名称","语言","紧凑","推送通知"] | — | 探针：帐号页每个控件点击都有可观察效果（P1，不只验改名与开关两个） |
| account-team-cleanse.spec.ts | 52 | toBe | 1 | 1 | — | account switch: default permission renders off; click requests and grants |
| account-team-cleanse.spec.ts | 62 | toBe | 0 | 0 | — | account switch: granted permission renders checked without a click |
| account-team-cleanse.spec.ts | 76 | toBe | 1 | 1 | — | account switch: denied 态点击落偏好开档 + 拦截解释（#1031 语义改写） |
| agent-create-model.spec.ts | 242 | toBeGreaterThanOrEqual | ≥ -0.5 | 344.1875 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 243 | toBeGreaterThanOrEqual | ≥ -0.5 | 505 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 244 | toBeLessThanOrEqual | ≤ 732.5 | 440.1875 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 245 | toBeLessThanOrEqual | ≤ 1440.5 | 945 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 257 | toBeGreaterThanOrEqual | ≥ -0.5 | 496.1875 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 258 | toBeGreaterThanOrEqual | ≥ -0.5 | 505 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 259 | toBeLessThanOrEqual | ≤ 732.5 | 656.1875 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 260 | toBeLessThanOrEqual | ≤ 1440.5 | 945 | — | 创建弹窗：两级菜单整块落在视口内（几何） |
| agent-create-model.spec.ts | 295 | toBeGreaterThanOrEqual | ≥ -0.5 | 496.203125 | — | 模型很多：选过运行时后菜单不越出视口，首行可点，40 行一个不少 |
| agent-create-model.spec.ts | 296 | toBeLessThanOrEqual | ≤ 732.5 | 722 | — | 模型很多：选过运行时后菜单不越出视口，首行可点，40 行一个不少 |
| agent-delete.spec.ts | 45 | toHaveCSS | font-size: 13.5px | 13.5px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-delete.spec.ts | 46 | toHaveCSS | line-height: 20px | 20px | — | 概览页脚有删除入口，点开二次确认（canon 原文逐字） |
| agent-desc-overflow.spec.ts | 28 | toBeLessThanOrEqual | ≤ 64 | 64 | — | 团队卡：卡 scrollHeight = clientHeight（无溢出） |
| agent-desc-overflow.spec.ts | 29 | toBeLessThanOrEqual | ≤ 378 | 378 | — | 团队卡：卡 scrollHeight = clientHeight（无溢出） |
| agent-desc-overflow.spec.ts | 40 | toBeLessThan | < 100 | 35 | — | 团队卡：长职责不上卡，卡内只有名字与一行元信息 |
| agent-desc-overflow.spec.ts | 42 | toBeLessThanOrEqual | ≤ 64 | 64 | — | 团队卡：长职责不上卡，卡内只有名字与一行元信息 |
| agent-desc-overflow.spec.ts | 59 | toBeLessThanOrEqual | ≤ 476 | 475 | — | 详情页：长职责不撑破行宽，label 列不竖排 |
| agent-desc-overflow.spec.ts | 67 | toBeGreaterThanOrEqual | ≥ 28 | 205.078125 | — | 详情页：长职责不撑破行宽，label 列不竖排 |
| agent-desc-overflow.spec.ts | 94 | toBeGreaterThan | > 200 | 292 | — | 详情页：显示态保留作者换行（段落间单换行仍在） |
| agent-desc-overflow.spec.ts | 121 | toBeLessThanOrEqual | ≤ 52 | 52 | — | account 页：推送通知行（auto 档）值槽改可收缩后无回归 |
| agent-desc-overflow.spec.ts | 122 | toBeLessThanOrEqual | ≤ 768 | 768 | — | account 页：推送通知行（auto 档）值槽改可收缩后无回归 |
| agent-detail.spec.ts | 185 | toBeLessThan | < 1207 | 1126.03125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 186 | toBeGreaterThan | > 1126.03125 | 1270.03125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 189 | toBeLessThanOrEqual | ≤ 376.5 | 336.5 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 190 | toBeGreaterThanOrEqual | ≥ 328.5 | 432.5 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 192 | toBeGreaterThanOrEqual | ≥ -0.5 | 1126.03125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 193 | toBeGreaterThanOrEqual | ≥ -0.5 | 336.5 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 194 | toBeLessThanOrEqual | ≤ 1440.5 | 1270.03125 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 195 | toBeLessThanOrEqual | ≤ 732.5 | 432.5 | — | 概览：两级菜单锚在触发钮上且整块在视口内（几何） |
| agent-detail.spec.ts | 257 | toBeGreaterThan | > -1 | 2 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 258 | toBeLessThan | < 3 | 2 | — | 概览：运行时档在模型之上，值由 provider 派生 |
| agent-detail.spec.ts | 444 | toEqual | {"thinkingLevel":"high"} | {"thinkingLevel":"high"} | — | 思考强度：空值是下拉的「未设置」，选档 PATCH thinkingLevel，刷新后仍是该档 |
| agent-detail.spec.ts | 450 | toEqual | {"thinkingLevel":"null"} | {"thinkingLevel":"null"} | — | 思考强度：空值是下拉的「未设置」，选档 PATCH thinkingLevel，刷新后仍是该档 |
| agent-detail.spec.ts | 476 | toEqual | {"provider":"claude-code","modelId":"null","thinkingLevel":"null"} | {"provider":"claude-code","modelId":"null","thinkingLevel":"null"} | — | 思考强度：切到 claude-code 时非法档随模型清空，合法档保留 |
| agent-detail.spec.ts | 490 | toEqual | {"provider":"claude-code","modelId":"null"} | {"provider":"claude-code","modelId":"null"} | — | 思考强度：切到 claude-code 时非法档随模型清空，合法档保留 |
| agent-detail.spec.ts | 511 | toBe | 1 | {"__fn":"() => patches"} | — | 权限 tab：保存失败出可见错误反馈，开关不回弹 |
| agent-detail.spec.ts | 570 | toEqual | {"skillsAllowlist":[]} | {"skillsAllowlist":[]} | — | 授权技能：不限制 ↔ 勾空互转发显式 null/[]；勾选只进数组槽 |
| agent-detail.spec.ts | 575 | toEqual | {"skillsAllowlist":["skill-a"]} | {"skillsAllowlist":["skill-a"]} | — | 授权技能：不限制 ↔ 勾空互转发显式 null/[]；勾选只进数组槽 |
| agent-detail.spec.ts | 578 | toEqual | {"skillsAllowlist":"null"} | {"skillsAllowlist":"null"} | — | 授权技能：不限制 ↔ 勾空互转发显式 null/[]；勾选只进数组槽 |
| agent-detail.spec.ts | 612 | toEqual | {"defaultSkill":"skill-a"} | {"defaultSkill":"skill-a"} | — | 默认 skill：单值 Select 只写 defaultSkill 槽，不带授权面键（两控件互不影响） |
| agent-detail.spec.ts | 617 | toEqual | {"defaultSkill":"null"} | {"defaultSkill":"null"} | — | 默认 skill：单值 Select 只写 defaultSkill 槽，不带授权面键（两控件互不影响） |
| agent-detail.spec.ts | 653 | toEqual | ["验收只看真机跑通","PROBE 探针的历史轮次"] | ["验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：搜索扫 content 且 ASCII 大小写不敏感 |
| agent-detail.spec.ts | 673 | toEqual | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | ["构建分支的命名规律","验收只看真机跑通","PROBE 探针的历史轮次"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 685 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | ["PROBE 探针的历史轮次","验收只看真机跑通","构建分支的命名规律"] | — | 记忆 tab：`添加时间` 档按新 → 旧重排 |
| agent-detail.spec.ts | 704 | toEqual | ["PROBE 探针的历史轮次","验收只看真机跑通"] | ["PROBE 探针的历史轮次","验收只看真机跑通"] | — | 记忆 tab：搜索与排序叠加——排序只在命中集内生效 |
| agent-detail.spec.ts | 808 | toBe | 56 | 56 | — | 概览：五个字段行长在同一张模板卡里，头像与名称在卡上方 |
| agent-detail.spec.ts | 809 | toBe | 56 | 56 | — | 概览：五个字段行长在同一张模板卡里，头像与名称在卡上方 |
| agent-detail.spec.ts | 813 | toEqual | ["职责","默认 skill","运行时","模型","思考强度"] | ["职责","默认 skill","运行时","模型","思考强度"] | — | 概览：五个字段行长在同一张模板卡里，头像与名称在卡上方 |
| agent-detail.spec.ts | 861 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | 记忆/权限卡：首行无底色、无上边线（无方角外溢、无 2px 顶边） |
| agent-detail.spec.ts | 862 | toBe | 0px | 0px | — | 记忆/权限卡：首行无底色、无上边线（无方角外溢、无 2px 顶边） |
| agent-identity-chip.spec.ts | 61 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 62 | toBe | 24 | 24 | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 66 | toBe | 12px | 12px | — | F-E1/E2/E10: 头像+名字并排成链，href 指 Agent 设置页，几何 canon 不漂移 |
| agent-identity-chip.spec.ts | 74 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| agent-identity-chip.spec.ts | 75 | toBe | pointer | pointer | — | F-E9: hover 只变 cursor，不发明背景态（参考站正典） |
| agent-model-width.spec.ts | 34 | toBeLessThanOrEqual | ≤ 423 | 423 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| agent-model-width.spec.ts | 48 | toBeLessThanOrEqual | ≤ 1435.484375 | 1402.984375 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| agent-model-width.spec.ts | 49 | toBeLessThanOrEqual | ≤ 385 | 385 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| agent-model-width.spec.ts | 56 | toBeGreaterThanOrEqual | ≥ -0.5 | 1012.1875 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| agent-model-width.spec.ts | 57 | toBeLessThanOrEqual | ≤ 1440.5 | 1434.984375 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| agent-model-width.spec.ts | 58 | toBeGreaterThanOrEqual | ≥ 196.46875 | 422.796875 | — | 长模型 id：概览 tab 模型弹层不横向裁切，最长 id 全名可见（#1301） |
| attachment-strip.spec.ts | 295 | toBe | 120 | {"x":264,"y":600,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 301 | toBe | 1 | {"x":264,"y":600,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 303 | toBe | 1 | {"x":264,"y":600,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 314 | toBe | 120 | {"x":264,"y":600,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 316 | toEqual | {"x":264,"y":600,"width":160,"height":16} | {"x":264,"y":600,"width":160,"height":16} | — | detail face: paste paints a placeholder, landing swaps it for a chip with zero geometry move |
| attachment-strip.spec.ts | 329 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 331 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 344 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the settled chip opens the image preview; Esc closes it |
| attachment-strip.spec.ts | 373 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 384 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | detail face: clicking the in-flight placeholder previews the local bytes |
| attachment-strip.spec.ts | 414 | toBe | 1 | {"__fn":"() => held.length"} | — | detail face: a failed upload clears the placeholder, toasts, keeps the draft |
| attachment-strip.spec.ts | 456 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 458 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 468 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | new-task face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 532 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 534 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | chief face: placeholder → settled chip → preview |
| attachment-strip.spec.ts | 544 | toBe | 120 | {"__fn":"() => view.evaluate(el => el.naturalWidth)"} | — | chief face: placeholder → settled chip → preview |
| board-dnd-live.spec.ts | 140 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 154 | toBeGreaterThanOrEqual | ≥ 0 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 156 | toEqual | [] | [] | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 189 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: PATCH 409 = 乐观值作废，卡片弹回源列 + toast 点名失败（#638） |
| board-dnd-live.spec.ts | 211 | toEqual | [] | [] | — | live: review(有变更)→已完成 开 done 闸，取消 = 零 PATCH、卡停源列 (#901) |
| board-dnd-live.spec.ts | 223 | toEqual | [] | [] | — | live: review(有变更)→已完成 开 done 闸，取消 = 零 PATCH、卡停源列 (#901) |
| board-dnd-live.spec.ts | 240 | toEqual | [] | [] | — | live: review(有变更)→已完成 确认后发 PATCH phase=done，乐观落位 (#901) |
| board-dnd-live.spec.ts | 248 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: review(有变更)→已完成 确认后发 PATCH phase=done，乐观落位 (#901) |
| board-dnd.spec.ts | 370 | toEqual | ["r3-legacy-1","r3-legacy-2"] | ["r3-legacy-1","r3-legacy-2"] | — | 已完成(有变更) → 待处理: reopen commits review, lands after the pinned group |
| board-dnd.spec.ts | 513 | toEqual | [] | [] | — | 重置闸·取消：零提交（卡片不动、计数不动、无请求发出）(#755) |
| board-dnd.spec.ts | 575 | toEqual | [] | [] | — | done 闸·取消：review(有变更) 拖已完成开弹层，取消零提交（卡不动、计数不动、无写请求）(#901) |
| board-dnd.spec.ts | 656 | toEqual | ["dm-done-plain","dm-done-changes"] | ["dm-done-plain","dm-done-changes"] | — | 已完成列首卡完成时间不早于末卡 (#1247) |
| board-dnd.spec.ts | 699 | toBe | 0.4 | 0.4 | — | cards from every column arm the drag gesture (#753) |
| board-dnd.spec.ts | 757 | toEqual | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":269,"y":122},{"id":"r3-legacy-1","x":850,"y":122},{"id":"r3-legacy-2","x":1… | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":269,"y":122},{"id":"r3-legacy-1","x":850,"y":122},{"id":"r3-legacy-2","x":1… | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 762 | toBe | 0 | 0 | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 814 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 814 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 815 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 815 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 816 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 816 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 817 | toBe | 10px | 10px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 817 | toBe | 10px | 10px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 831 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 831 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 837 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 837 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 879 | toBe | rgba(180, 83, 42, 0.1) | rgba(180, 83, 42, 0.1) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 879 | toBe | rgba(240, 146, 109, 0.1) | rgba(240, 146, 109, 0.1) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 880 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 880 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 884 | toBe | rgba(180, 83, 42, 0.05) | rgba(180, 83, 42, 0.05) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 884 | toBe | rgba(240, 146, 109, 0.05) | rgba(240, 146, 109, 0.05) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 890 | not.toBe | rgba(180, 83, 42, 0.05) | rgb(251, 249, 245) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 890 | not.toBe | rgba(240, 146, 109, 0.05) | rgb(36, 32, 27) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 891 | not.toBe | rgba(180, 83, 42, 0.05) | rgb(251, 249, 245) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 891 | not.toBe | rgba(240, 146, 109, 0.05) | rgb(36, 32, 27) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 957 | toBeGreaterThanOrEqual | ≥ 0 | 2 | — | committed drop never flashes the card back to the source column |
| board-dnd.spec.ts | 959 | toEqual | [] | [] | — | committed drop never flashes the card back to the source column |
| board-docked-reflow.spec.ts | 73 | toBeLessThanOrEqual | ≤ 1182 | 1182 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 78 | toEqual | [{"id":"todo","left":265,"width":277},{"id":"building","left":556,"width":277},{"id":"pending","left":846,"wid… | [{"id":"todo","left":265,"width":277},{"id":"building","left":556,"width":277},{"id":"pending","left":846,"wid… | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 79 | toBeLessThanOrEqual | ≤ 1182 | 1182 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 80 | toBeGreaterThanOrEqual | ≥ 199 | 276.5 | — | window open leaves the 1440 columns at their closed geometry |
| board-docked-reflow.spec.ts | 91 | toBeGreaterThan | > 766 | 876 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 92 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 97 | toEqual | [{"id":"todo","left":265,"width":200},{"id":"building","left":479,"width":200},{"id":"pending","left":693,"wid… | [{"id":"todo","left":265,"width":200},{"id":"building","left":479,"width":200},{"id":"pending","left":693,"wid… | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 98 | toBeGreaterThan | > 766 | 876 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 102 | toBeLessThanOrEqual | ≤ 0 | 0 | — | narrowest usable viewport (1024): honest scroll identical open and closed |
| board-docked-reflow.spec.ts | 119 | toBeGreaterThan | > 0 | {"x":248,"y":66,"width":766,"height":656} | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 125 | toBeLessThanOrEqual | ≤ 1015 | 997 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 126 | toBeGreaterThanOrEqual | ≥ 247 | 797 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 127 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | overflow stays reachable while the window is open |
| board-docked-reflow.spec.ts | 139 | toHaveCSS | scrollbar-width: auto | auto | — | overflow discloses itself while the window is open: scrollbar stays native |
| board-docked-reflow.spec.ts | 157 | toBeLessThanOrEqual | ≤ 1 | 0 | — | cards keep their exact width across window open/close |
| board-docked-reflow.spec.ts | 174 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 175 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 181 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 187 | toBeGreaterThanOrEqual | ≥ 199 | 276.5 | — | worst-case data holds while the window is open |
| board-docked-reflow.spec.ts | 207 | toBeLessThanOrEqual | ≤ 1183 | 1165 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 208 | toBeGreaterThanOrEqual | ≥ 199 | 276.5 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 209 | toBeGreaterThan | > 598 | 888.5 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 210 | toBeGreaterThan | > 307.5 | 598 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 211 | toBeGreaterThan | > 17 | 307.5 | — | RTL mirror: the first column stays whole at the scroll-start edge while open |
| board-docked-reflow.spec.ts | 220 | toBeLessThanOrEqual | ≤ 1182 | 1182 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 223 | toBeGreaterThan | > 200 | 276.5 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 224 | toBeLessThan | < 282 | 276.5 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 225 | toBeLessThanOrEqual | ≤ 1 | 0 | — | resting geometry at 1440 is untouched by the floor token |
| board-filter.spec.ts | 124 | toContain | rgba(0, 0, 0, 0) | ["rgba(0, 0, 0, 0)","transparent"] | — | 旧场景（无 projectNames）不渲染仓库面；顶栏两钮 = 无底色筛选钮 + 新任务胶囊 |
| board-filter.spec.ts | 502 | toHaveCSS | color: rgb(239, 68, 68) | rgb(239, 68, 68) | — | 任务卡标签 = 着词表色的标签图标 + 名字：无实心 chip、无标签零占位、不改卡高 |
| board-filter.spec.ts | 515 | toBeCloseTo | 20 ±0.5 | 20 | — | 任务卡标签 = 着词表色的标签图标 + 名字：无实心 chip、无标签零占位、不改卡高 |
| board-filter.spec.ts | 516 | toBeCloseTo | 20 ±0.5 | 20 | — | 任务卡标签 = 着词表色的标签图标 + 名字：无实心 chip、无标签零占位、不改卡高 |
| board-overflow.spec.ts | 37 | toBeLessThanOrEqual | ≤ 723 | 709 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 39 | toBeGreaterThanOrEqual | ≥ 65 | 78 | — | 溢出列底边不冲出视口：列贴 scroller 可视高度（行高钉死） |
| board-overflow.spec.ts | 51 | toBe | auto | auto | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 52 | toBeGreaterThan | > 591 | 948 | — | 卡片列表有滚动出口：scrollHeight > clientHeight 且容器可滚 |
| board-overflow.spec.ts | 60 | toBeGreaterThan | > 0 | 357 | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 74 | toBeGreaterThan | > 0 | {"x":265,"y":118,"width":276.5,"height":591} | — | 列表可滚：scrollTo 移动 scrollTop，滚轮同样生效 |
| board-overflow.spec.ts | 83 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 列头固定：列表滚动时 header 的视口位置不动 |
| board-overflow.spec.ts | 106 | toBeGreaterThanOrEqual | ≥ 1 | 4 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 122 | toBeGreaterThan | > 0 | 357 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 123 | toBeGreaterThanOrEqual | ≥ 1 | 4 | — | 卡片上下缘由块向内边距保位：首卡上缘、滚到底的末卡下缘都不贴裁切线 |
| board-overflow.spec.ts | 141 | toBeLessThanOrEqual | ≤ 723 | 709 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| board-overflow.spec.ts | 145 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 存量场景零漂移：01 列完整贴视口、列底不超 scroller 底缘 |
| board-scroll-restore.spec.ts | 28 | toBeGreaterThan | > 200 | 357 | — | detail round trip keeps the column scroll position |
| board-scroll-restore.spec.ts | 41 | toBeGreaterThan | > 200 | 357 | — | detail round trip keeps the column scroll position |
| board-scroll-restore.spec.ts | 71 | toEqual | [357,357] | [357,357] | — | detail round trip keeps the column scroll position |
| board-scroll-restore.spec.ts | 72 | toBeGreaterThan | > 200 | 357 | — | detail round trip keeps the column scroll position |
| board-scroll-restore.spec.ts | 75 | toBeGreaterThan | > 200 | {"__fn":"async () => {\n    const reading = await column.evaluate((el, want) => {\n      const max = Math.max(… | — | detail round trip keeps the column scroll position |
| board-zoom-fit.spec.ts | 74 | toBeLessThanOrEqual | ≤ 1051 | 1051 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 74 | toBeLessThanOrEqual | ≤ 942 | 942 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 76 | toBeLessThanOrEqual | ≤ 1300 | 1282 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 76 | toBeLessThanOrEqual | ≤ 1191 | 1173 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 199 | 243.75 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 199 | 216.5 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 80 | toBeLessThanOrEqual | ≤ 0 | 0 | — | no horizontal scroll at 110% zoom (1309px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 80 | toBeLessThanOrEqual | ≤ 0 | 0 | — | no horizontal scroll at 120% zoom (1200px CSS viewport), all 4 columns whole |
| board-zoom-fit.spec.ts | 91 | toBeGreaterThanOrEqual | ≥ 199 | 204.5 | — | 125% zoom (1152): 248 sidebar keeps the flow above the floor — four columns fit |
| board-zoom-fit.spec.ts | 92 | toBeLessThanOrEqual | ≤ 894 | 894 | — | 125% zoom (1152): 248 sidebar keeps the flow above the floor — four columns fit |
| board-zoom-fit.spec.ts | 93 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 125% zoom (1152): 248 sidebar keeps the flow above the floor — four columns fit |
| board-zoom-fit.spec.ts | 107 | toBeGreaterThanOrEqual | ≥ 199 | 200 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 108 | toBeGreaterThan | > 766 | 876 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 109 | toBeLessThanOrEqual | ≤ 0 | 0 | — | natural floor still holds at 1024: honest scroll instead of collapsed columns |
| board-zoom-fit.spec.ts | 119 | toBeLessThanOrEqual | ≤ 1051 | 1051 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 127 | toBeLessThanOrEqual | ≤ 1051 | 1051 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 128 | toBeGreaterThanOrEqual | ≥ 199 | 243.75 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 129 | toEqual | [244,244,244,244] | [244,244,244,244] | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 137 | toBeLessThanOrEqual | ≤ 1051 | 1051 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 138 | toBeGreaterThanOrEqual | ≥ 199 | 243.75 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 139 | toBeLessThanOrEqual | ≤ 0 | 0 | — | the floating window never re-arms a docked floor (yield retired, ADR 0013 D1) |
| board-zoom-fit.spec.ts | 156 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case card data stays in-column at the 125% boundary width |
| board-zoom-fit.spec.ts | 157 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case card data stays in-column at the 125% boundary width |
| card-press.spec.ts | 59 | not.toBe | rgb(226, 220, 215) | rgb(255, 255, 255) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 59 | not.toBe | rgb(70, 65, 60) | rgb(47, 42, 38) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 65 | not.toBe | rgb(242, 242, 242) | rgb(255, 255, 255) | color(srgb …) folded to rgb(242, 242, 242); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (light) |
| card-press.spec.ts | 65 | not.toBe | rgb(62, 57, 53) | rgb(47, 42, 38) | color(srgb …) folded to rgb(62, 57, 53); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 66 | not.toBe | rgb(226, 220, 215) | rgb(242, 242, 242) | color(srgb …) folded to rgb(242, 242, 242); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (light) |
| card-press.spec.ts | 66 | not.toBe | rgb(70, 65, 60) | rgb(62, 57, 53) | color(srgb …) folded to rgb(62, 57, 53); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 67 | toHaveCSS | background-color: rgb(242, 242, 242) | rgb(242, 242, 242) | color(srgb …) folded to rgb(242, 242, 242); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (light) |
| card-press.spec.ts | 67 | toHaveCSS | background-color: rgb(62, 57, 53) | rgb(62, 57, 53) | color(srgb …) folded to rgb(62, 57, 53); re-pin the spec to the rgb/hex form (#411) | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 69 | toHaveCSS | background-color: rgb(226, 220, 215) | rgb(226, 220, 215) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 69 | toHaveCSS | background-color: rgb(70, 65, 60) | rgb(70, 65, 60) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 74 | toBe | 1 | 1 | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 74 | toBe | 1 | 1 | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 83 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 83 | toHaveCSS | background-color: rgb(47, 42, 38) | rgb(47, 42, 38) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 90 | toHaveCSS | user-select: none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 94 | toBe | none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 123 | toBe | 0 | 0 | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| cds-board.spec.ts | 33 | toBe | 0px | 0px | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 34 | toBe | 0px | 0px | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 35 | toBe | none | none | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 36 | toBe | 10px | 10px | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 37 | toBe | 10px | 10px | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 38 | toContain | rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(62, 58, 52) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-board.spec.ts | 40 | toBe | 36 | 36 | — | CDS board: bare columns, cards at --radius-card 10px + panel-shadow |
| cds-composer.spec.ts | 32 | toBe | 20px | 20px | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 33 | toBe | 20px | 20px | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 34 | toBe | 0px | 0px | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 35 | toBe | 384px | 384px | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 36 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 37 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 38 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0.4) 0px 4px 20px 0px, rgb(62, 58, 52) 0px 0px 0px 1px inset | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 39 | toBe | 8px | 8px | — | CDS composer: 20px radius, shadow-composer ladder, 8px send, 384 max-h |
| cds-composer.spec.ts | 148 | toBe | 84 | 84 | — | CDS composer: multi-line draft grows the card and text clears the toolbar |
| cds-composer.spec.ts | 166 | toBeGreaterThan | > 84 | 120 | — | CDS composer: multi-line draft grows the card and text clears the toolbar |
| cds-composer.spec.ts | 167 | toBeLessThanOrEqual | ≤ 664 | 658 | — | CDS composer: multi-line draft grows the card and text clears the toolbar |
| cds-composer.spec.ts | 192 | toBeGreaterThan | > 84 | 160 | — | CDS composer: a wrapped single paragraph also clears the toolbar |
| cds-composer.spec.ts | 193 | toBeLessThanOrEqual | ≤ 664 | 658 | — | CDS composer: a wrapped single paragraph also clears the toolbar |
| cds-composer.spec.ts | 209 | toBe | 84 | 84 | — | CDS composer: a width change that wraps the draft re-reserves toolbar clearance |
| cds-composer.spec.ts | 223 | toBe | true | 96 | — | CDS composer: a width change that wraps the draft re-reserves toolbar clearance |
| cds-composer.spec.ts | 225 | toBeGreaterThan | > 84 | 96 | — | CDS composer: a width change that wraps the draft re-reserves toolbar clearance |
| cds-density.spec.ts | 21 | toBe | 16px | 16px | — | CDS density: comfortable default; compact rem-scale 0.9375 + data-density |
| cds-density.spec.ts | 37 | toContain | .9375 | ["0.9375",".9375"] | — | CDS density: comfortable default; compact rem-scale 0.9375 + data-density |
| cds-density.spec.ts | 38 | toBe | 8px | 8px | — | CDS density: comfortable default; compact rem-scale 0.9375 + data-density |
| cds-density.spec.ts | 50 | toBe | 16px | 16px | — | CDS density: comfortable default; compact rem-scale 0.9375 + data-density |
| cds-dialogs.spec.ts | 38 | toBe | 16px | 16px | — | CDS search panel: 16px edge-radius + de-boxed input |
| cds-dialogs.spec.ts | 39 | toBe | 16px | 16px | — | CDS search panel: 16px edge-radius + de-boxed input |
| cds-dialogs.spec.ts | 40 | toBe | 0px | 0px | — | CDS search panel: 16px edge-radius + de-boxed input |
| cds-dialogs.spec.ts | 41 | toBe | 0px | 0px | — | CDS search panel: 16px edge-radius + de-boxed input |
| cds-dialogs.spec.ts | 67 | toBe | 10px | 10px | — | Paper user-menu: 10px + shadow-popover, no solid border |
| cds-dialogs.spec.ts | 68 | toBe | 10px | 10px | — | Paper user-menu: 10px + shadow-popover, no solid border |
| cds-dialogs.spec.ts | 69 | toBe | 0px | 0px | — | Paper user-menu: 10px + shadow-popover, no solid border |
| cds-dialogs.spec.ts | 70 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | Paper user-menu: 10px + shadow-popover, no solid border |
| cds-dialogs.spec.ts | 71 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | Paper user-menu: 10px + shadow-popover, no solid border |
| cds-motion.spec.ts | 45 | toBe | 380 | 380 | — | motion tokens and scroll-fade utility land |
| cds-motion.spec.ts | 46 | toBe | 150 | 150 | — | motion tokens and scroll-fade utility land |
| cds-motion.spec.ts | 47 | toBe | 200 | 200 | — | motion tokens and scroll-fade utility land |
| cds-motion.spec.ts | 49 | toEqual | [] | [] | — | motion tokens and scroll-fade utility land |
| cds-motion.spec.ts | 50 | toBe | 28px | 28px | — | motion tokens and scroll-fade utility land |
| cds-motion.spec.ts | 72 | toMatch | {"__regex":"/^-?(0\\.125em\|1\\.75px)$/"} | -1.75px | — | motion tokens and scroll-fade utility land |
| cds-settings.spec.ts | 29 | toBe | 16px | 16px | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 30 | toBe | 8px | 8px | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 31 | toBe | 40px | 40px | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 33 | toBeGreaterThanOrEqual | ≥ 640 | 768 | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 34 | toBeLessThanOrEqual | ≤ 800 | 768 | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 36 | toBe | 10px | 10px | — | CDS settings: reading col 768, cards at --radius-card 10px no shadow, input 8px/32px |
| cds-settings.spec.ts | 63 | toBe | 14px | 14px | — | resources empty: Paper EmptyState card-title tier, medium, balanced |
| cds-settings.spec.ts | 64 | toBe | 500 | 500 | — | resources empty: Paper EmptyState card-title tier, medium, balanced |
| cds-sidebar.spec.ts | 27 | toBe | 248 | 248 | — | CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade |
| cds-sidebar.spec.ts | 28 | toBe | 0px | 0px | — | CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade |
| cds-sidebar.spec.ts | 31 | toBe | none | none | — | CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade |
| cds-sidebar.spec.ts | 33 | toBe | 8px | 8px | — | CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade |
| cds-sidebar.spec.ts | 34 | toBe | 8px | 8px | — | CDS sidebar: 248px tier-1 surface, no seam, rounded rows, scroll-fade |
| cds-transcript.spec.ts | 29 | toBe | 768px | 768px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 30 | toBe | 35vh | 35vh | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 31 | toBe | 28px | 28px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 32 | toBe | 18px | 18px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 33 | toBe | 12px | 12px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 35 | toBe | 56px | 56px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 36 | toBe | 768px | 768px | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 38 | toBeGreaterThanOrEqual | ≥ 16 | 256.2 | — | CDS transcript: tokens, fade, follow 40 / jump 120, header 56 (Paper top bar) |
| cds-transcript.spec.ts | 86 | toBeLessThanOrEqual | ≤ 40 | {"__fn":"async () => page.evaluate(() => {\n    const col = document.querySelector('[data-testid=\"transcript-… | — | CDS transcript: jump-to-latest appears past 120px and restores end |
| chat-md-toolout.spec.ts | 87 | toBe | rgb(236, 231, 223) | rgb(236, 231, 223) | — | A3: the output block is left aligned, mono, normal contrast — not a chat-note |
| chat-md-toolout.spec.ts | 131 | toBeGreaterThan | > 300 | 318 | — | B3: nested list items indent past their parent |
| chat-tools-identity.spec.ts | 104 | toBe | 32px | 32px | — | I4: expand/collapse interaction and the #470 row geometry are untouched |
| chat-tools-identity.spec.ts | 105 | toBeLessThanOrEqual | ≤ 16 | 16 | — | I4: expand/collapse interaction and the #470 row geometry are untouched |
| chat-tools-identity.spec.ts | 128 | toEqual | [] | [] | — | I5: the identity row draws no rule — the transcript boundary stays air |
| chat-type-measure.spec.ts | 42 | toBe | 14px | 14px | — | chat body reads at 14px (text-card-title) on a unitless 1.6 |
| chat-type-measure.spec.ts | 43 | toBe | 22.4px | 22.4px | — | chat body reads at 14px (text-card-title) on a unitless 1.6 |
| chat-type-measure.spec.ts | 75 | toBe | 1.6 | 1.6 | — | chat body reads at 14px (text-card-title) on a unitless 1.6 |
| chat-type-measure.spec.ts | 109 | toBeGreaterThan | > 67.5 | 67.90987985865723 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 110 | toBeLessThanOrEqual | ≤ 68.5 | 67.90987985865723 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 117 | toBe | center | center | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 118 | toBeGreaterThan | > 0 | 126.609 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 119 | toBe | 126.609px | 126.609px | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 125 | toBeLessThanOrEqual | ≤ 1175 | 1174 | — | 68ch measure cap binds the body text and the centered note |
| chat-type-measure.spec.ts | 138 | toBe | 13.5px | 13.5px | — | composer placeholder sits at 13.5px (text-ui) — one notch under the 14px body |
| chat-type-measure.spec.ts | 139 | toBe | 14px | 14px | — | composer placeholder sits at 13.5px (text-ui) — one notch under the 14px body |
| chat-type-measure.spec.ts | 157 | toBe | 24 | 24 | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 158 | toBe | 14px | 14px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 159 | toEqual | {"w":20,"h":20} | {"w":20,"h":20} | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 160 | toBe | 32px | 32px | — | bubble / avatar / footer keep their own geometry (#470 scope fence) |
| chat-type-measure.spec.ts | 209 | toEqual | [] | [] | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 213 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 214 | toBe | 0px | 0px | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 217 | toBeGreaterThanOrEqual | ≥ 16 | 20 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| chat-type-measure.spec.ts | 218 | toBeLessThanOrEqual | ≤ 32 | 20 | — | turn boundary is air, not a rule: no divider between a user turn and the agent row |
| checkbox-unified.spec.ts | 72 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 73 | toBeLessThanOrEqual | ≤ 1 | 1 | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 74 | toHaveCSS | clip-path: inset(50%) | inset(50%) | — | accept: 原生 input 走官方遮蔽（不画 Mac 复选框） |
| checkbox-unified.spec.ts | 108 | toBeGreaterThan | > 15.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 109 | toBeLessThan | < 16.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 110 | toBeGreaterThan | > 15.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 111 | toBeLessThan | < 16.5 | 16 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 112 | toHaveCSS | border-radius: 4px | 4px | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 114 | toHaveCSS | font-size: 13.5px | 13.5px | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 119 | toBeGreaterThan | > 7.5 | 8 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| checkbox-unified.spec.ts | 120 | toBeLessThan | < 8.5 | 8 | — | accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px |
| chief-composer-tools.spec.ts | 333 | toBeLessThanOrEqual | ≤ 602 | 594 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 335 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 336 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox anchors above the composer wrap inside the drawer (FM2) |
| chief-composer-tools.spec.ts | 408 | toBe | 1 | {"__fn":"() => uploads.grants.length"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 414 | toBe | 1 | {"__fn":"() => uploads.uploads"} | — | a mid-line image paste lands the token whole-line at the caret (FM6) |
| chief-composer-tools.spec.ts | 439 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 441 | toBe | 1 | {"__fn":"() => deferred.held.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-composer-tools.spec.ts | 446 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter during the upload does not send; after it lands Enter sends the token inside (FM6/FM10) |
| chief-draft-persist.spec.ts | 69 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: the draft survives a full-page reload |
| chief-draft-persist.spec.ts | 78 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: the draft survives a full-page reload |
| chief-draft-persist.spec.ts | 101 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: an accepted send clears the persisted draft (no resurrection) |
| chief-draft-persist.spec.ts | 104 | toBe | 1 | {"__fn":"() => posts"} | — | live face: an accepted send clears the persisted draft (no resurrection) |
| chief-draft-persist.spec.ts | 125 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: a rejected send keeps the draft in the box and in storage (#631) |
| chief-draft-persist.spec.ts | 130 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: a rejected send keeps the draft in the box and in storage (#631) |
| chief-draft-persist.spec.ts | 145 | toBe | 帮我看看这个项目的进展 — reload 后逐字还在 (#1056) | {"__fn":"() => storedDraft(page)"} | — | live face: minimize and SPA route switches keep the draft (D6 zero regression) |
| chief-drawer-model.spec.ts | 74 | toBeGreaterThanOrEqual | ≥ 4.5 | 5.938503404704226 | — | the row is readable in both themes (#751 A 同律) |
| chief-drawer-slash.spec.ts | 163 | toBe | 0 | 0 | — | `/clear` runs without sending and toasts confirmation (F1) |
| chief-drawer-slash.spec.ts | 174 | toBe | 0 | 0 | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 179 | toBe | 1 | {"__fn":"() => posts"} | — | Tab completes without running; Enter without highlight sends (F4) |
| chief-drawer-slash.spec.ts | 191 | toBe | 0 | 0 | — | mid-prompt accept inserts literal text, never runs (F3) |
| chief-drawer-slash.spec.ts | 211 | toBeGreaterThanOrEqual | ≥ 0 | 245.0120849609375 | — | /help opens the command panel with the drawer builtins |
| chief-fab.spec.ts | 50 | toEqual | {"width":"40px","height":"40px","right":"8px","bottom":"8px","position":"fixed"} | {"width":"40px","height":"40px","right":"8px","bottom":"8px","position":"fixed"} | — | the FAB keeps the A0 corner geometry (40x40 @ 8px inset, fixed) |
| chief-fab.spec.ts | 103 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 104 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 105 | toBeCloseTo | 1392 ±0.5 | 1392 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 106 | toBeCloseTo | 684 ±0.5 | 684 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 107 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 108 | toBeCloseTo | 40 ±0.5 | 40 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-minimize-scroll.spec.ts | 62 | toBeGreaterThan | > 200 | 3616 | — | scroll to the middle → minimize → reopen lands at the same spot |
| chief-minimize-scroll.spec.ts | 83 | toBeGreaterThan | > 50 | 1808 | — | scroll to the middle → minimize → reopen lands at the same spot |
| chief-minimize-scroll.spec.ts | 84 | toBeLessThan | < 3566 | 1808 | — | scroll to the middle → minimize → reopen lands at the same spot |
| chief-minimize-scroll.spec.ts | 100 | toBeLessThanOrEqual | ≤ 2 | 0 | — | scroll to the middle → minimize → reopen lands at the same spot |
| chief-minimize-scroll.spec.ts | 101 | toBeLessThanOrEqual | ≤ 2 | 0 | — | scroll to the middle → minimize → reopen lands at the same spot |
| chief-panel.spec.ts | 122 | toBeCloseTo | 1052 ±0.5 | 1052 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 123 | toBeCloseTo | 124 ±0.5 | 124 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 124 | toBeCloseTo | 380 ±0.5 | 380 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 125 | toBeCloseTo | 600 ±0.5 | 600 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 141 | toBe | fixed | fixed | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 143 | toBe | 12px | 12px | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 145 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 146 | toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 148 | toBe | 15 | 15 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 150 | toMatch | {"__regex":"/^rgb\\(/"} | rgb(47, 42, 38) | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 153 | toBeGreaterThanOrEqual | ≥ 248 | 1052 | — | the panel floats as a 380x600 window anchored 8px off the corner (board) |
| chief-panel.spec.ts | 166 | toBeCloseTo | 1182 ±0.5 | 1182 | — | board content never yields to the window (D1 overlay, no yield) |
| chief-panel.spec.ts | 176 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board content never yields to the window (D1 overlay, no yield) |
| chief-panel.spec.ts | 190 | toBeCloseTo | 1182 ±0.5 | 1182 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 197 | toBeGreaterThan | > 0 | 276.5 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 198 | toBeLessThanOrEqual | ≤ 1 | 0 | — | minimizing leaves the board grid at the same geometry (nothing to restore) |
| chief-panel.spec.ts | 212 | toBeCloseTo | 1182 ±0.5 | 1182 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 212 | toBeCloseTo | 1182 ±0.5 | 1182 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 212 | toBeCloseTo | 1182 ±0.5 | 1182 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 1052 ±0.5 | 1052 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 1052 ±0.5 | 1052 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 217 | toBeCloseTo | 1052 ±0.5 | 1052 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 124 ±0.5 | 124 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 124 ±0.5 | 124 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 218 | toBeCloseTo | 124 ±0.5 | 124 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 219 | toBeCloseTo | 380 ±0.5 | 380 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 219 | toBeCloseTo | 380 ±0.5 | 380 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 219 | toBeCloseTo | 380 ±0.5 | 380 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 600 ±0.5 | 600 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 600 ±0.5 | 600 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 220 | toBeCloseTo | 600 ±0.5 | 600 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 222 | toBeCloseTo | 1182 ±0.5 | 1182 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 222 | toBeCloseTo | 1182 ±0.5 | 1182 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 222 | toBeCloseTo | 1182 ±0.5 | 1182 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 227 | toBeCloseTo | 1182 ±0.5 | 1182 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 227 | toBeCloseTo | 1182 ±0.5 | 1182 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 227 | toBeCloseTo | 1182 ±0.5 | 1182 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 228 | toBeCloseTo | 248 ±0.5 | 248 | — | pages: the main column never narrows while the window is open |
| chief-panel.spec.ts | 228 | toBeCloseTo | 248 ±0.5 | 248 | — | resources: the main column never narrows while the window is open |
| chief-panel.spec.ts | 228 | toBeCloseTo | 248 ±0.5 | 248 | — | secondary: the main column never narrows while the window is open |
| chief-panel.spec.ts | 244 | toBeCloseTo | 1052 ±0.5 | 1052 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 245 | toBeCloseTo | 124 ±0.5 | 124 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 246 | toBeCloseTo | 380 ±0.5 | 380 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 247 | toBeCloseTo | 600 ±0.5 | 600 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 251 | toBeCloseTo | 694 ±0.5 | 694 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 252 | toBeCloseTo | 694 ±0.5 | 694 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 258 | toBe | 694 | 694 | — | detail: the right pane coexists with the floating window (D7 reversed) |
| chief-panel.spec.ts | 317 | toBe | 120 | 120 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 318 | toBe | 60 | 60 | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 319 | toBe | 120px | 120px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 320 | toBe | 60px | 60px | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 322 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-panel.spec.ts | 323 | toBe | auto | auto | — | composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102) |
| chief-settings.spec.ts | 70 | toBeCloseTo | 20 ±0.05 | 20 | — | agent dialog search sits on the dialog body inset (#872 blast radius) |
| chief-stream-markdown.spec.ts | 297 | toBe | 2 | 2 | — | F-R13: todo 提及渲成 chip，锚点指任务详情并可点击导航；字面 #seq/伪 scheme 不出 chip（#675） |
| chief-stream-markdown.spec.ts | 336 | toBe | auto | auto | — | F-R6/R8: 用户行头像 = 真人身份 img（XMON-105 单源），抽屉体可滚动 |
| chief-stream-markdown.spec.ts | 599 | toBe | 24 | 24 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 605 | toBe | 1.5 | 1.5 | — | F-R18: 在飞存在行可展开（#822）——点箭头看实时步骤，typing 接管不泄漏 |
| chief-stream-markdown.spec.ts | 763 | toBe | 44 | 44 | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 764 | toBe | 14px | 14px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 774 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 775 | toBe | 0px | 0px | — | F-R16: 单行纯文本气泡几何不漂移（44px 药丸）；多块气泡首/尾块 margin 修剪生效 |
| chief-stream-markdown.spec.ts | 864 | toEqual | {"display":"flex","grow":"1","minW":"0px","imgW":24,"imgH":24,"colRightOfImg":"true","colBesideImg":"true"} | {"__fn":"() => thinking.evaluate(row => {\n      var _row$querySelector;\n      const img = (_row$querySelecto… | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 881 | toHaveCSS | display: flex | flex | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 882 | toHaveCSS | flex-grow: 1 | 1 | — | F-R19: 段行投影（#955）——思考行单列、在飞工具行平铺并挂真实秒数 |
| chief-stream-markdown.spec.ts | 1090 | toBe | ellipsis | ellipsis | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1091 | toBe | hidden | hidden | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1092 | toBeGreaterThan | > 296 | 774 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1094 | toBeLessThanOrEqual | ≤ 307 | 307 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-stream-markdown.spec.ts | 1100 | toBeLessThanOrEqual | ≤ 0 | 0 | — | F-R22: 长预览由 CSS 截断——钮宽 ≤ 列宽、省略号生效、页面零横溢（#1034） |
| chief-thread-switcher-scroll.spec.ts | 40 | toBeLessThanOrEqual | ≤ 724 | 386.2867126464844 | — | the 22-thread list caps inside the window and the tail row is clickable |
| chief-thread-switcher-scroll.spec.ts | 47 | toBeGreaterThan | > 220 | 712 | — | the 22-thread list caps inside the window and the tail row is clickable |
| chief-thread-switcher-scroll.spec.ts | 96 | toBe | 72 | 72 | — | the short canon list (r5 116, 2 threads) keeps its natural height |
| chief-thread-switcher-scroll.spec.ts | 97 | toBeLessThanOrEqual | ≤ 72 | 72 | — | the short canon list (r5 116, 2 threads) keeps its natural height |
| chief-thread-switcher-scroll.spec.ts | 99 | toBe | 264 | 264 | — | the short canon list (r5 116, 2 threads) keeps its natural height |
| chief-toggle-flash.spec.ts | 116 | toBe | 0 | 0 | — | second ⌘J minimizes without an opacity repaint or remount |
| chief-toggle-flash.spec.ts | 141 | toBe | 0 | 0 | — | summon-then-minimize cycle twice: node identity holds, zero opacity transitions |
| chief-toggle-flash.spec.ts | 142 | toBe | 2 | 2 | — | summon-then-minimize cycle twice: node identity holds, zero opacity transitions |
| chief-toggle-flash.spec.ts | 143 | toBe | 2 | 2 | — | summon-then-minimize cycle twice: node identity holds, zero opacity transitions |
| chief-toggle-flash.spec.ts | 144 | toBe | 2 | 2 | — | summon-then-minimize cycle twice: node identity holds, zero opacity transitions |
| chief-toggle-flash.spec.ts | 145 | toBe | 2 | 2 | — | summon-then-minimize cycle twice: node identity holds, zero opacity transitions |
| collapse-family.spec.ts | 37 | toBe | -90deg | -15.7684deg | — | sidebar group collapse hides sub-rows, flips aria, survives reload |
| collapse-family.spec.ts | 83 | toBe | 0 | 0 | — | both sidebar groups persist side by side |
| collapse-family.spec.ts | 86 | toBe | 1 | 1 | — | both sidebar groups persist side by side |
| color-freeze.spec.ts | 127 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | frozen color slots stay put (light) |
| color-freeze.spec.ts | 127 | toBe | rgb(26, 22, 18) | rgb(26, 22, 18) | — | frozen color slots stay put (dark) |
| color-freeze.spec.ts | 133 | toBe | rgb(235, 228, 216) | rgb(235, 228, 216) | — | frozen color slots stay put (light) |
| color-freeze.spec.ts | 133 | toBe | rgba(255, 252, 248, 0.05) | rgba(255, 252, 248, 0.05) | — | frozen color slots stay put (dark) |
| color-freeze.spec.ts | 159 | toBe | rgb(251, 249, 245) | rgb(251, 249, 245) | — | derived mix tokens resolve from existing slots (light) |
| color-freeze.spec.ts | 159 | toBe | rgb(36, 32, 27) | rgb(36, 32, 27) | — | derived mix tokens resolve from existing slots (dark) |
| color-freeze.spec.ts | 183 | toBe | 20px | 20px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 184 | toBe | 18px | 18px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 185 | toBe | 248px | 248px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 186 | toBe | 768px | 768px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 187 | toBe | 16px | 16px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 188 | toBe | 10px | 10px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 189 | toBe | 6px | 6px | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 190 | not.toBe | 6px | calc(.625rem * .8) | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 191 | toBeGreaterThan | > 0 | 18 | — | CDS structural tokens land at locked mon values |
| color-freeze.spec.ts | 193 | toBeGreaterThan | > 0 | 3 | — | CDS structural tokens land at locked mon values |
| composer-inline-mention.spec.ts | 285 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter with a highlight inserts WITHOUT sending; the second Enter sends (r9 §5 fix) |
| composer-inline-mention.spec.ts | 298 | toBe | 1 | {"__fn":"() => sent.length"} | — | Enter without a highlight sends as typed (F1: composer-wire-reject law survives) |
| composer-inline-mention.spec.ts | 360 | toBe | 29 | 29 | — | insert lands a trailing space and the caret after it — typing continues outside the token (F6) |
| composer-inline-mention.spec.ts | 535 | toBeLessThanOrEqual | ≤ 622 | 614 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 537 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 538 | toBeLessThanOrEqual | ≤ 8 | 0 | — | geometry: the listbox stays anchored above the composer (#688 ladder untouched) |
| composer-inline-mention.spec.ts | 618 | toBe | 1 | {"__fn":"() => sent.length"} | — | files: Enter inserts the bare path with a trailing space and sends on second Enter |
| composer-inline-mention.spec.ts | 656 | not.toBe | none | enter | — | chips: Enter-select renders the file chip with a fresh pop |
| composer-inline-mention.spec.ts | 778 | toBe | 1 | {"__fn":"() => sent.length"} | — | five-kind: todo Enter-inserts the plain #seq token without sending |
| composer-inline-mention.spec.ts | 805 | toBe | 1 | {"__fn":"() => sent.length"} | — | five-kind: machine Enter-inserts without sending; second Enter sends |
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
| composer-slash.spec.ts | 332 | toBeGreaterThanOrEqual | ≥ 0 | 246.39620971679688 | — | /help opens the command panel |
| composer-slash.spec.ts | 333 | toBeLessThanOrEqual | ≤ 732 | 485.6037902832031 | — | /help opens the command panel |
| composer-wire-reject.spec.ts | 159 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: a rejected steer (409) keeps the draft word for word |
| composer-wire-reject.spec.ts | 182 | toBe | 1 | {"__fn":"() => posts"} | — | detail face: an accepted steer clears the draft |
| composer-wire-reject.spec.ts | 217 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: a rejected send (500) keeps the draft and toasts |
| composer-wire-reject.spec.ts | 243 | toBe | 1 | {"__fn":"() => posts"} | — | chief face: an accepted send clears the draft |
| dead-buttons.spec.ts | 565 | toBeLessThan | < 1.5 | 0 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 566 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| dead-buttons.spec.ts | 567 | toBeCloseTo | 28 ±0.5 | 28 | — | new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt) |
| detail-3pane.spec.ts | 47 | toBe | 248 | 248 | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 48 | toBe | 488 | 488 | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 50 | toBe | 248 | 248 | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 51 | toBe | 942 | 942 | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 54 | toBe | 694 | 694 | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 60 | toBe | 1px | 1px | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 61 | toBe | none | none | — | three abutting panes: 248 sidebar \| fluid center \| 488 right |
| detail-3pane.spec.ts | 116 | toBe | 20px | 20px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 118 | toBe | 0px | 0px | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 122 | toBe | relative | relative | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 124 | toBeCloseTo | 264 ±0.5 | 264 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 125 | toBeCloseTo | 926 ±0.5 | 926 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 127 | toBeCloseTo | 16 ±0.5 | 16 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 130 | toBeCloseTo | 622 ±0.5 | 622 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 132 | toBeGreaterThanOrEqual | ≥ 16 | 256.2 | — | composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it |
| detail-3pane.spec.ts | 170 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 171 | toBe | 32 | 32 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 175 | toBeCloseTo | 678 ±0.5 | 678 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 176 | toBeLessThanOrEqual | ≤ 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 178 | toBeCloseTo | 8 ±0.5 | 8 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 180 | toBe | rgb(70, 65, 60) | rgb(70, 65, 60) | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 181 | toBe | 1 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 183 | toBeLessThanOrEqual | ≤ 2 | 1 | — | composer controls share one bottom row: stop is the send button's sibling |
| detail-3pane.spec.ts | 200 | toBe | 694 | 694 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 201 | toBeCloseTo | 662 ±0.5 | 662 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 209 | toBeCloseTo | 694 ±0.5 | 694 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 210 | toBeCloseTo | 662 ±0.5 | 662 | — | composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1) |
| detail-3pane.spec.ts | 292 | toBe | 1182 | 1182 | — | fresh phase: the brief owns the whole center column, right pane collapses |
| detail-narrow.spec.ts | 57 | toBeLessThanOrEqual | ≤ 320 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 60 | toBeLessThanOrEqual | ≤ 321 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 61 | toBe | 320 | 320 | — | N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll |
| detail-narrow.spec.ts | 73 | toBeLessThanOrEqual | ≤ 360 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 74 | toBeLessThanOrEqual | ≤ 361 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 75 | toBe | 360 | 360 | — | N2: 360 and 390 keep the same law |
| detail-narrow.spec.ts | 102 | toBe | 248 | 248 | — | N3: the degradation stops at 816px — the 3-pane shell survives above it |
| detail-narrow.spec.ts | 103 | toBe | 488 | 488 | — | N3: the degradation stops at 816px — the 3-pane shell survives above it |
| detail-narrow.spec.ts | 122 | toBeLessThanOrEqual | ≤ 320 | 320 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 123 | toBeLessThanOrEqual | ≤ 320 | 304 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 124 | toBeLessThanOrEqual | ≤ 320 | 312 | — | N4: the docked chief panel cannot re-overflow the 320px shell |
| detail-narrow.spec.ts | 145 | toBeGreaterThanOrEqual | ≥ 0 | 16 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 146 | toBeLessThanOrEqual | ≤ 320 | 296 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 147 | toBeGreaterThanOrEqual | ≥ 0 | 16 | — | N5: head actions and the composer stay inside the 320px viewport |
| detail-narrow.spec.ts | 148 | toBeLessThanOrEqual | ≤ 320 | 304 | — | N5: head actions and the composer stay inside the 320px viewport |
| dialog-ring-room.spec.ts | 37 | toBeGreaterThanOrEqual | ≥ 489.3533935546875 | 504.5739440917969 | — | 聚焦的 w-full 输入框 focus 环不被弹窗裁切（环房不变量） |
| dialog-ring-room.spec.ts | 38 | toBeLessThanOrEqual | ≤ 950.6466064453125 | 935.4260864257812 | — | 聚焦的 w-full 输入框 focus 环不被弹窗裁切（环房不变量） |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 434.3689498901367 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 391.92406463623047 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 436 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 294.02954864501953 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 247.04601287841797 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 153.0836181640625 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 43 | toBeLessThanOrEqual | ≤ 452.5 | 151.8209686279297 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 32.815528869628906 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 54.03797149658203 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 32 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 102.98522186279297 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 126.47699737548828 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 173.45819091796875 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 44 | toBeGreaterThanOrEqual | ≥ 0 | 174.0895233154297 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 467.1844787597656 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 445.9620361328125 | — | secret: 静态表单面 submit 在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 468 | — | machine: disclosure 展开(最高内容态)底部链接在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 397.0147705078125 | — | create-agent: submit 在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 373.52301025390625 | — | charter: 取消/保存章程在视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 326.54180908203125 | — | chief-agent 列表态(无按钮读面)面板整体不越视口 |
| dialog-viewport.spec.ts | 45 | toBeLessThanOrEqual | ≤ 500.5 | 325.9104919433594 | — | accept(34): 取消/完成在视口 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 392 | 1826 | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 182 | 311 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| dialog-viewport.spec.ts | 53 | toBeGreaterThan | > 252 | 328 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 81 | toEqual | {"x":597,"y":420,"width":103,"height":32} | {"x":597,"y":420,"width":103,"height":32} | — | provider: 3 模型行把 body 撑溢,submit 钉底且滚动不位移 |
| dialog-viewport.spec.ts | 150 | toBeLessThanOrEqual | ≤ 312.5 | 295.75403213500977 | — | branch sync tab: 视口压过内容高,同步钮钉底,body 溢出;git tab 正常 |
| dialog-viewport.spec.ts | 185 | toBeLessThanOrEqual | ≤ 372.5 | 356 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 186 | toBeGreaterThanOrEqual | ≥ 0 | 32 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 187 | toBeLessThanOrEqual | ≤ 420.5 | 388 | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| dialog-viewport.spec.ts | 198 | toEqual | {"x":621,"y":340,"width":49,"height":32} | {"x":621,"y":340,"width":49,"height":32} | — | schedules 新建定时(900×420): 封顶、body 内滚、取消/保存/X 恒在视口 (#1037) |
| diff-word-highlight.spec.ts | 34 | toBeGreaterThan | > 537 | 16868 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 34 | toBeGreaterThan | > 537 | 16868 | — | 「显示完整文件」面的行同样撑满滚动宽 |
| diff-word-highlight.spec.ts | 44 | toBeGreaterThan | > 0 | 17 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 46 | toBeGreaterThanOrEqual | ≥ 16867 | 16868.390625 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 47 | toBeLessThanOrEqual | ≤ 16869 | 16868.390625 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 51 | toBeGreaterThanOrEqual | ≥ 16867 | 16868.390625 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 53 | toBeGreaterThanOrEqual | ≥ 16867 | 16868.390625 | — | 长行产生横向滚动,且每个行盒/hunk 头/文件行都撑满滚动宽(hunk 面) |
| diff-word-highlight.spec.ts | 64 | toBeGreaterThan | > 0 | 4 | — | 「显示完整文件」面的行同样撑满滚动宽 |
| diff-word-highlight.spec.ts | 66 | toBeGreaterThanOrEqual | ≥ 16867 | 16868.390625 | — | 「显示完整文件」面的行同样撑满滚动宽 |
| diff-word-highlight.spec.ts | 106 | toBeGreaterThan | > 0 | 11 | — | 超限对退回整行高亮且不静默:data-word=capped + 非空 title,零词级 span |
| diff-word-highlight.spec.ts | 142 | not.toBe | rgba(0, 0, 0, 0) | rgb(125, 220, 150) | — | 词级底色骑比整行底色更深的 token,非透明且可区分(light) |
| diff-word-highlight.spec.ts | 142 | not.toBe | rgba(0, 0, 0, 0) | rgb(31, 92, 51) | — | 词级底色骑比整行底色更深的 token,非透明且可区分(dark) |
| diff-word-highlight.spec.ts | 143 | not.toBe | rgb(195, 245, 204) | rgb(125, 220, 150) | — | 词级底色骑比整行底色更深的 token,非透明且可区分(light) |
| diff-word-highlight.spec.ts | 143 | not.toBe | rgb(26, 56, 33) | rgb(31, 92, 51) | — | 词级底色骑比整行底色更深的 token,非透明且可区分(dark) |
| elevation-ladder.spec.ts | 94 | not.toBe | none | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px | — | each rung is its pool plus one ring, ring last |
| elevation-ladder.spec.ts | 96 | toBe | 1 | 1 | — | each rung is its pool plus one ring, ring last |
| elevation-ladder.spec.ts | 115 | toBe | rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0… | rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0… | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 117 | toBe | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 120 | not.toContain | inset | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 122 | toBe | rgba(255, 255, 255, 0) 0px 1px 0px 0px inset | rgba(255, 255, 255, 0) 0px 1px 0px 0px inset | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 123 | not.toContain | inset | rgba(31, 27, 24, 0.1) 0px 8px 24px 0px, rgba(31, 27, 24, 0.05) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0px… | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 124 | not.toContain | inset | rgba(31, 27, 24, 0.16) 0px 16px 40px 0px, rgba(31, 27, 24, 0.06) 0px 2px 6px 0px, rgb(236, 229, 218) 0px 0px 0… | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 126 | toBe | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 127 | toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0.65) 0px 8px 28px 0px, rgba(0, 0, 0, 0.45) 0px 2px 8px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0… | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 128 | toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0.5) 0px 16px 40px 0px, rgba(0, 0, 0, 0.3) 0px 2px 6px 0px, rgba(255, 255, 255, 0.08) 0px 1px 0p… | — | pools hold the pre-ladder darkness; --top only in dark e2/e3 |
| elevation-ladder.spec.ts | 159 | toContain | 0px 0px 0px 1px inset | rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset | — | old slot names alias the ladder |
| elevation-ladder.spec.ts | 160 | not.toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0.035) 0px 4px 20px 0px, rgb(236, 229, 218) 0px 0px 0px 1px inset | — | old slot names alias the ladder |
| elevation-ladder.spec.ts | 173 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 174 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 179 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 184 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 185 | toContain | rgb(236, 229, 218) 0px 0px 0px 1px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 189 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 190 | toContain | rgb(236, 229, 218) 0px 0px 0px 1px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 195 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 200 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 201 | toContain | 0px 0px 0px 1px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 209 | toBe | 1 | 1 | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 211 | toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 212 | toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | one ring per edge on the rendered surfaces |
| elevation-ladder.spec.ts | 213 | toContain | rgba(255, 255, 255, 0.08) 0px 1px 0px 0px inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | one ring per edge on the rendered surfaces |
| empty-review-closeout.spec.ts | 185 | toBe | 0 | 0 | — | 看板：已上报空 diff 的 review 卡完成不合并、不拦授权 |
| escape-wiring.spec.ts | 89 | toEqual | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | {"winAdds":0,"winRems":0,"docAdds":0,"docRems":0} | — | 开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层 |
| escape-wiring.spec.ts | 163 | toEqual | {"win":{"winAdds":0,"winRems":0},"balanced":"true"} | {"__fn":"async () => {\n    const t = await readEscapeTap(page);\n    return {\n      win: {\n        winAdds:… | — | 确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层 |
| fixture-mode-chip.spec.ts | 40 | toHaveCSS | pointer-events: none | none | — | the chip never swallows clicks — pointer-events-none (#1037) |
| footer-copy.spec.ts | 27 | toBeGreaterThan | > 20 | 54 | — | C1: robot row copy puts the row text on the clipboard |
| github-issue-writeback.spec.ts | 169 | toBe | 0 | 0 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| github-issue-writeback.spec.ts | 174 | toBe | 1 | 1 | — | 4. 未建成：状态行 + 重试入口；重试成功 → 行升级为回显态（AC3） |
| live-agent-model-line.spec.ts | 167 | toBeGreaterThan | > 0 | {"__fn":"() => held.length"} | — | members pending: the name alone, then the model fills in |
| live-agent-model-line.spec.ts | 186 | toBeGreaterThanOrEqual | ≥ 2 | {"__fn":"() => answered"} | — | members read failed: the name alone |
| machine-detail.spec.ts | 68 | toBe | 0 | 0 | — | 危险区删除先弹确认层，取消不删 |
| machines-chief-state.spec.ts | 75 | toEqual | [52,52,52] | [52,52,52] | — | 行高契约保持：标注行不破 Paper 设置行高（每行 52，含分隔线） |
| machines-concurrency-blur.spec.ts | 118 | toEqual | [{"maxConcurrent":"null"}] | [{"maxConcurrent":"null"}] | — | 编辑后点 恢复推荐：只发一次 PATCH（null），不先存手动值 |
| machines-concurrency-blur.spec.ts | 129 | toEqual | [{"maxConcurrent":8}] | [{"maxConcurrent":8}] | — | 编辑后点 +：只发一次 PATCH（草稿 + 1） |
| machines-concurrency-blur.spec.ts | 150 | toEqual | [] | [] | — | 未编辑的超区间值：聚焦再失焦不发 PATCH、不夹值 |
| machines-concurrency-blur.spec.ts | 161 | toBe | 1 | {"__fn":"() => bodies.length"} | — | 连续两次写：后一次等前一次回执再发（按序，最终 = 最后意图） |
| machines-concurrency-blur.spec.ts | 163 | toBe | 1 | 1 | — | 连续两次写：后一次等前一次回执再发（按序，最终 = 最后意图） |
| machines-concurrency-blur.spec.ts | 165 | toBe | 2 | {"__fn":"() => bodies.length"} | — | 连续两次写：后一次等前一次回执再发（按序，最终 = 最后意图） |
| machines-concurrency-blur.spec.ts | 167 | toEqual | [{"maxConcurrent":6},{"maxConcurrent":"null"}] | [{"maxConcurrent":6},{"maxConcurrent":"null"}] | — | 连续两次写：后一次等前一次回执再发（按序，最终 = 最后意图） |
| machines-concurrency-blur.spec.ts | 185 | toBe | 1 | {"__fn":"() => bodies.length"} | — | PATCH 在途时连点 + 三下：3 → 6，草稿不回弹，最终落库 6 |
| machines-concurrency-blur.spec.ts | 193 | toBe | 2 | {"__fn":"() => bodies.length"} | — | PATCH 在途时连点 + 三下：3 → 6，草稿不回弹，最终落库 6 |
| machines-concurrency-blur.spec.ts | 196 | toEqual | [{"maxConcurrent":4},{"maxConcurrent":5},{"maxConcurrent":6}] | [{"maxConcurrent":4},{"maxConcurrent":5},{"maxConcurrent":6}] | — | PATCH 在途时连点 + 三下：3 → 6，草稿不回弹，最终落库 6 |
| machines-concurrency-blur.spec.ts | 197 | toBe | 6 | {"__fn":"() => {\n    var _state$rows$2;\n    return (_state$rows$2 = state.rows[0]) === null \|\| _state$rows$2… | — | PATCH 在途时连点 + 三下：3 → 6，草稿不回弹，最终落库 6 |
| machines-concurrency-source.spec.ts | 117 | toBe | 1 | {"__fn":"() => pending.length"} | — | 选数即标手动：PATCH 在途时来源已是手动，回执后仍是手动 |
| machines-concurrency-source.spec.ts | 137 | toBe | 1 | {"__fn":"() => pending.length"} | — | 恢复推荐（有指纹）：PATCH 在途时来源先复判为推荐 |
| machines-concurrency-source.spec.ts | 158 | toBe | 1 | {"__fn":"() => pending.length"} | — | 恢复推荐（无指纹）：PATCH 在途时来源先复判为估算，不说成推荐 |
| machines-local.spec.ts | 163 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 164 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 166 | toBe | 1 | 1 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 167 | toBe | 0.35 | 0.35 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 168 | toBe | 16 | 16 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-local.spec.ts | 169 | toBe | 52 | 52 | — | mark 几何：16×16 mark，on/off 透明度分离，行高契约不破 |
| machines-shell-switch.spec.ts | 138 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 139 | toEqual | {"shellEnabled":"true"} | {"shellEnabled":"true"} | — | 拨 on：PATCH 单字段 {shellEnabled:true}，刷新后仍 on（读侧真值一致） |
| machines-shell-switch.spec.ts | 154 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 155 | toEqual | {"shellEnabled":"false"} | {"shellEnabled":"false"} | — | 拨 off：同律回写 false 并持久 |
| machines-shell-switch.spec.ts | 191 | toBe | 1 | {"__fn":"() => patches"} | — | PATCH 失败：开关回滚 + 可见错误反馈 |
| machines-shell-switch.spec.ts | 230 | toBe | 1 | {"__fn":"() => state.patches.length"} | — | C1+C2+C4：并发选择器——读标注真值、PATCH 单字段、刷新持久 |
| machines-shell-switch.spec.ts | 231 | toEqual | {"maxConcurrent":4} | {"maxConcurrent":4} | — | C1+C2+C4：并发选择器——读标注真值、PATCH 单字段、刷新持久 |
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
| overlay-focus.spec.ts | 68 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 69 | not.toBe | rgb(0, 95, 204) | rgb(240, 146, 109) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 90 | not.toBe | auto | solid | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 91 | not.toBe | rgb(0, 95, 204) | rgb(240, 146, 109) | — | click + key on 新建任务/topbar buttons: never the UA blue box |
| overlay-focus.spec.ts | 151 | toHaveCSS | animation-name: enter | enter | — | backdrop click closes; entry rides the registry fade-in |
| page-scroll.spec.ts | 59 | toBeGreaterThan | > 0 | {"x":455,"y":130,"width":768,"height":16} | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 59 | toBeGreaterThan | > 0 | {"x":480,"y":82,"width":468,"height":32} | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 59 | toBeGreaterThan | > 0 | {"x":455,"y":98,"width":768,"height":52} | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 59 | toBeGreaterThan | > 0 | {"x":459,"y":82,"width":56,"height":56} | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 59 | toBeGreaterThan | > 0 | {"x":527,"y":102,"width":168,"height":16} | — | 新建项目页能滚到底 (#1032) |
| page-scroll.spec.ts | 77 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 77 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 77 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 77 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 77 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 新建项目页能滚到底 (#1032) |
| page-scroll.spec.ts | 78 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 总管设置三个长内容 tab 都能滚到底 (#1032) |
| page-scroll.spec.ts | 78 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目任务列表页能滚到底 (#1032) |
| page-scroll.spec.ts | 78 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 排期页能滚到底 (#1032) |
| page-scroll.spec.ts | 78 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 项目设置页能滚到底 (#1032) |
| page-scroll.spec.ts | 78 | toBeLessThanOrEqual | ≤ 0 | 0 | — | 新建项目页能滚到底 (#1032) |
| paper-board-sheet.spec.ts | 62 | toEqual | {"x":248,"y":10,"w":1182,"h":880} | {"x":248,"y":10,"w":1182,"h":880} | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 62 | toEqual | {"x":40,"y":10,"w":1390,"h":880} | {"x":40,"y":10,"w":1390,"h":880} | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 62 | toEqual | {"x":248,"y":10,"w":1182,"h":880} | {"x":248,"y":10,"w":1182,"h":880} | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 62 | toEqual | {"x":40,"y":10,"w":1390,"h":880} | {"x":40,"y":10,"w":1390,"h":880} | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 63 | toEqual | {"box":{"x":248,"y":10,"w":1182,"h":880},"radius":"16px","bg":"rgb(251, 249, 245)","shadow":"rgb(236, 229, 218… | {"box":{"x":248,"y":10,"w":1182,"h":880},"radius":"16px","bg":"rgb(251, 249, 245)","shadow":"rgb(236, 229, 218… | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 63 | toEqual | {"box":{"x":40,"y":10,"w":1390,"h":880},"radius":"16px","bg":"rgb(251, 249, 245)","shadow":"rgb(236, 229, 218)… | {"box":{"x":40,"y":10,"w":1390,"h":880},"radius":"16px","bg":"rgb(251, 249, 245)","shadow":"rgb(236, 229, 218)… | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 63 | toEqual | {"box":{"x":248,"y":10,"w":1182,"h":880},"radius":"16px","bg":"rgb(36, 32, 27)","shadow":"rgb(62, 58, 52) 0px … | {"box":{"x":248,"y":10,"w":1182,"h":880},"radius":"16px","bg":"rgb(36, 32, 27)","shadow":"rgb(62, 58, 52) 0px … | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 63 | toEqual | {"box":{"x":40,"y":10,"w":1390,"h":880},"radius":"16px","bg":"rgb(36, 32, 27)","shadow":"rgb(62, 58, 52) 0px 0… | {"box":{"x":40,"y":10,"w":1390,"h":880},"radius":"16px","bg":"rgb(36, 32, 27)","shadow":"rgb(62, 58, 52) 0px 0… | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 64 | toBe | 16px | 16px | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 64 | toBe | 16px | 16px | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 64 | toBe | 16px | 16px | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 64 | toBe | 16px | 16px | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 65 | toContain | inset | rgb(236, 229, 218) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 65 | toContain | inset | rgb(236, 229, 218) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 65 | toContain | inset | rgb(62, 58, 52) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 65 | toContain | inset | rgb(62, 58, 52) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 66 | toBe | rgb(236, 229, 218) 0px 0px 0px 1px inset | rgb(236, 229, 218) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 66 | toBe | rgb(236, 229, 218) 0px 0px 0px 1px inset | rgb(236, 229, 218) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 66 | toBe | rgb(62, 58, 52) 0px 0px 0px 1px inset | rgb(62, 58, 52) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 66 | toBe | rgb(62, 58, 52) 0px 0px 0px 1px inset | rgb(62, 58, 52) 0px 0px 0px 1px inset | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 67 | toBe | none | none | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 67 | toBe | none | none | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 67 | toBe | none | none | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 67 | toBe | none | none | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 68 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 68 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 68 | toBe | rgb(26, 22, 18) | rgb(26, 22, 18) | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 68 | toBe | rgb(26, 22, 18) | rgb(26, 22, 18) | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 69 | not.toBe | rgb(251, 249, 245) | rgb(243, 238, 229) | — | board sheet matches the page shell sheet (light) |
| paper-board-sheet.spec.ts | 69 | not.toBe | rgb(251, 249, 245) | rgb(243, 238, 229) | — | board sheet matches the page shell sheet (light, rail) |
| paper-board-sheet.spec.ts | 69 | not.toBe | rgb(36, 32, 27) | rgb(26, 22, 18) | — | board sheet matches the page shell sheet (dark) |
| paper-board-sheet.spec.ts | 69 | not.toBe | rgb(36, 32, 27) | rgb(26, 22, 18) | — | board sheet matches the page shell sheet (dark, rail) |
| paper-board-sheet.spec.ts | 80 | toEqual | {"x":248,"y":10,"width":1182,"height":56} | {"x":248,"y":10,"width":1182,"height":56} | — | board header stays the banner, at the top of the sheet |
| paper-board-sheet.spec.ts | 89 | toEqual | {"x":248,"y":10,"w":1182,"h":880} | {"x":248,"y":10,"w":1182,"h":880} | — | 总管设置 swaps in inside the same sheet |
| paper-board-sheet.spec.ts | 105 | toContain | 0px 0px 0px 1px inset | rgb(236, 229, 218) 0px 0px 0px 1px inset | — | sheet and card outlines stay one CSS pixel |
| paper-board-sheet.spec.ts | 106 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | sheet and card outlines stay one CSS pixel |
| paper-board-sheet.spec.ts | 107 | not.toContain | 0.5px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | sheet and card outlines stay one CSS pixel |
| paper-board-sheet.spec.ts | 123 | toEqual | {"isolated":"isolate","position":"absolute","zIndex":"10","pointerEvents":"none","inset":["0px","0px","0px","0… | {"isolated":"isolate","position":"absolute","zIndex":"10","pointerEvents":"none","inset":["0px","0px","0px","0… | — | the sheet ring sits above every child of the sheet |
| paper-card.spec.ts | 34 | toHaveCSS | border-top-style: dashed | dashed | — | needs-you footers: state flag + action link per state, no solid buttons |
| paper-card.spec.ts | 49 | toHaveCSS | opacity: 0 | 0 | — | queued start link: hidden at rest, shown on hover and keyboard focus, takes no height |
| paper-card.spec.ts | 55 | toBeCloseTo | 12 ±0.5 | 12 | — | queued start link: hidden at rest, shown on hover and keyboard focus, takes no height |
| paper-card.spec.ts | 58 | toHaveCSS | opacity: 1 | 1 | — | queued start link: hidden at rest, shown on hover and keyboard focus, takes no height |
| paper-card.spec.ts | 60 | toHaveCSS | opacity: 0 | 0 | — | queued start link: hidden at rest, shown on hover and keyboard focus, takes no height |
| paper-card.spec.ts | 65 | toHaveCSS | opacity: 1 | 1 | — | queued start link: hidden at rest, shown on hover and keyboard focus, takes no height |
| paper-card.spec.ts | 72 | toHaveCSS | font-weight: 400 | 400 | — | done card: title drops to 400 + ink-3, no footer |
| paper-card.spec.ts | 81 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | done card: title drops to 400 + ink-3, no footer |
| paper-card.spec.ts | 83 | toHaveCSS | font-weight: 500 | 500 | — | done card: title drops to 400 + ink-3, no footer |
| paper-card.spec.ts | 95 | toBeGreaterThan | > 0 | 122 | — | meta row never wraps at the 200px column floor |
| paper-card.spec.ts | 96 | toBe | 20 | 20 | — | meta row never wraps at the 200px column floor |
| paper-card.spec.ts | 105 | toHaveCSS | animation-name: card-breath | card-breath | — | running footer breathes, and stops under reduced motion |
| paper-card.spec.ts | 107 | toHaveCSS | animation-name: none | none | — | running footer breathes, and stops under reduced motion |
| paper-card.spec.ts | 129 | toHaveCSS | color: rgb(240, 146, 109) | rgb(240, 146, 109) | — | column header: serif name, fixed status icon, plus only on 待开始 and it opens new task |
| paper-card.spec.ts | 133 | toHaveCSS | opacity: 0 | 0 | — | column header: serif name, fixed status icon, plus only on 待开始 and it opens new task |
| paper-card.spec.ts | 135 | toHaveCSS | opacity: 1 | 1 | — | column header: serif name, fixed status icon, plus only on 待开始 and it opens new task |
| paper-chief.spec.ts | 90 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 90 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 91 | toHaveCSS | font-size: 16px | 16px | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 91 | toHaveCSS | font-size: 16px | 16px | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 92 | toHaveCSS | font-weight: 500 | 500 | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 92 | toHaveCSS | font-weight: 500 | 500 | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 95 | toBeCloseTo | 16 ±0.5 | 16 | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 95 | toBeCloseTo | 16 ±0.5 | 16 | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 98 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 98 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 99 | not.toBe | rgb(235, 228, 216) | rgb(255, 255, 255) | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 99 | not.toBe | rgb(60, 55, 50) | rgb(47, 42, 38) | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 100 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 100 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(62, … | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 102 | toBe | 32 | 32 | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 102 | toBe | 32 | 32 | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 103 | toHaveCSS | border-top-left-radius: 8px | 8px | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 103 | toHaveCSS | border-top-left-radius: 8px | 8px | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 106 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 106 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 107 | toHaveCSS | font-size: 16px | 16px | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 107 | toHaveCSS | font-size: 16px | 16px | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 109 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 109 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 110 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 110 | toHaveCSS | background-color: rgb(47, 42, 38) | rgb(47, 42, 38) | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 112 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | window: heading face, Paper gate banner and hero cards (light) |
| paper-chief.spec.ts | 112 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | window: heading face, Paper gate banner and hero cards (dark) |
| paper-chief.spec.ts | 119 | toHaveCSS | font-size: 13.5px | 13.5px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 119 | toHaveCSS | font-size: 13.5px | 13.5px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 123 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 123 | toHaveCSS | border-top-left-radius: 10px | 10px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 128 | toBe | 32 | 32 | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 128 | toBe | 32 | 32 | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 129 | toHaveCSS | font-size: 13.5px | 13.5px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 129 | toHaveCSS | font-size: 13.5px | 13.5px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 133 | toHaveCSS | font-size: 12px | 12px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 133 | toHaveCSS | font-size: 12px | 12px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 135 | toHaveCSS | font-size: 12px | 12px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 135 | toHaveCSS | font-size: 12px | 12px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 138 | toHaveCSS | font-size: 11.5px | 11.5px | — | window: bound hero, switcher menu and stream type keys (light) |
| paper-chief.spec.ts | 138 | toHaveCSS | font-size: 11.5px | 11.5px | — | window: bound hero, switcher menu and stream type keys (dark) |
| paper-chief.spec.ts | 149 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 149 | toHaveCSS | font-family: sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | sourceSerif4, Georgia, "Songti SC", "Noto Serif CJK SC", serif | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 150 | toHaveCSS | font-size: 18px | 18px | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 150 | toHaveCSS | font-size: 18px | 18px | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 152 | toBe | 56 | 56 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 152 | toBe | 56 | 56 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 153 | toHaveCSS | border-bottom-width: 1px | 1px | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 153 | toHaveCSS | border-bottom-width: 1px | 1px | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 158 | toBeGreaterThan | > 264 | 300 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 158 | toBeGreaterThan | > 264 | 300 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 164 | toBeLessThan | < 80 | 52 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 164 | toBeLessThan | < 80 | 52 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 165 | toBe | 768 | 768 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 165 | toBe | 768 | 768 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 169 | toHaveCSS | border-top-left-radius: 10px | 10px | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 169 | toHaveCSS | border-top-left-radius: 10px | 10px | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 175 | toBe | 2 | 2 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 175 | toBe | 2 | 2 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 176 | toBeGreaterThanOrEqual | ≥ 52 | 52 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 176 | toBeGreaterThanOrEqual | ≥ 52 | 52 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 180 | toHaveCSS | border-bottom-width: 1px | 1px | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 180 | toHaveCSS | border-bottom-width: 1px | 1px | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 181 | toHaveCSS | border-bottom-color: rgb(236, 229, 218) | rgb(236, 229, 218) | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 181 | toHaveCSS | border-bottom-color: rgb(62, 58, 52) | rgb(62, 58, 52) | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 185 | toHaveCSS | border-top-width: 0px | 0px | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 185 | toHaveCSS | border-top-width: 0px | 0px | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 191 | toBe | 32 | 32 | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 191 | toBe | 32 | 32 | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 192 | toHaveCSS | background-color: rgb(43, 38, 32) | rgb(43, 38, 32) | — | settings: Paper top bar, one settings card, empty rows in the card (light) |
| paper-chief.spec.ts | 192 | toHaveCSS | background-color: rgb(236, 231, 223) | rgb(236, 231, 223) | — | settings: Paper top bar, one settings card, empty rows in the card (dark) |
| paper-chief.spec.ts | 215 | toHaveCSS | border-top-left-radius: 10px | 10px | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 215 | toHaveCSS | border-top-left-radius: 10px | 10px | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 216 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 216 | toHaveCSS | background-color: rgb(47, 42, 38) | rgb(47, 42, 38) | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 220 | toHaveCSS | color: rgb(180, 83, 42) | rgb(180, 83, 42) | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 220 | toHaveCSS | color: rgb(240, 146, 109) | rgb(240, 146, 109) | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 226 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 226 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 228 | toHaveCSS | font-size: 14px | 14px | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 228 | toHaveCSS | font-size: 14px | 14px | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 229 | toHaveCSS | font-weight: 500 | 500 | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 229 | toHaveCSS | font-weight: 500 | 500 | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 230 | toHaveCSS | font-size: 11.5px | 11.5px | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 230 | toHaveCSS | font-size: 11.5px | 11.5px | — | question card: card face, status triad, type keys (dark) |
| paper-chief.spec.ts | 234 | toHaveCSS | font-size: 13.5px | 13.5px | — | question card: card face, status triad, type keys (light) |
| paper-chief.spec.ts | 234 | toHaveCSS | font-size: 13.5px | 13.5px | — | question card: card face, status triad, type keys (dark) |
| paper-keys-schedules.spec.ts | 32 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | schedules empty state: bare ink-3 icon, no tile |
| paper-keys-schedules.spec.ts | 32 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | api-keys empty state: bare ink-3 icon, no tile |
| paper-keys-schedules.spec.ts | 33 | toBe | 24 | 24 | — | schedules empty state: bare ink-3 icon, no tile |
| paper-keys-schedules.spec.ts | 33 | toBe | 24 | 24 | — | api-keys empty state: bare ink-3 icon, no tile |
| paper-keys-schedules.spec.ts | 45 | toHaveCSS | border-top-left-radius: 10px | 10px | — | schedules list: one settings card of 52px rows, 10px corner |
| paper-keys-schedules.spec.ts | 45 | toHaveCSS | border-top-left-radius: 10px | 10px | — | api-keys list: one settings card of 52px rows, 10px corner |
| paper-keys-schedules.spec.ts | 49 | toEqual | [52] | [52] | — | schedules list: one settings card of 52px rows, 10px corner |
| paper-keys-schedules.spec.ts | 49 | toEqual | [52] | [52] | — | api-keys list: one settings card of 52px rows, 10px corner |
| paper-keys-schedules.spec.ts | 60 | toHaveCSS | height: 32px | 32px | — | 新建定时 footer: text 取消 left of a 32px primary 保存, no outline button |
| paper-keys-schedules.spec.ts | 63 | toBeLessThanOrEqual | ≤ 891 | 883 | — | 新建定时 footer: text 取消 left of a 32px primary 保存, no outline button |
| paper-overlays.spec.ts | 64 | toBe | rgba(43, 38, 32, 0.14) | rgba(43, 38, 32, 0.14) | — | backdrop is the light dim, no blur, on dialogs and confirms (light) |
| paper-overlays.spec.ts | 69 | toHaveCSS | background-color: rgba(43, 38, 32, 0.14) | rgba(43, 38, 32, 0.14) | — | backdrop is the light dim, no blur, on dialogs and confirms (light) |
| paper-overlays.spec.ts | 69 | toHaveCSS | background-color: rgba(0, 0, 0, 0.45) | rgba(0, 0, 0, 0.45) | — | backdrop is the light dim, no blur, on dialogs and confirms (dark) |
| paper-overlays.spec.ts | 70 | toHaveCSS | backdrop-filter: none | none | — | backdrop is the light dim, no blur, on dialogs and confirms (light) |
| paper-overlays.spec.ts | 70 | toHaveCSS | backdrop-filter: none | none | — | backdrop is the light dim, no blur, on dialogs and confirms (dark) |
| paper-overlays.spec.ts | 76 | toHaveCSS | background-color: rgba(43, 38, 32, 0.14) | rgba(43, 38, 32, 0.14) | — | backdrop is the light dim, no blur, on dialogs and confirms (light) |
| paper-overlays.spec.ts | 76 | toHaveCSS | background-color: rgba(0, 0, 0, 0.45) | rgba(0, 0, 0, 0.45) | — | backdrop is the light dim, no blur, on dialogs and confirms (dark) |
| paper-overlays.spec.ts | 77 | toHaveCSS | backdrop-filter: none | none | — | backdrop is the light dim, no blur, on dialogs and confirms (light) |
| paper-overlays.spec.ts | 77 | toHaveCSS | backdrop-filter: none | none | — | backdrop is the light dim, no blur, on dialogs and confirms (dark) |
| paper-overlays.spec.ts | 86 | toBe | 400 | 400 | — | dialog widths are S 400 / M 480 / L 640 |
| paper-overlays.spec.ts | 94 | toBe | 480 | 480 | — | dialog widths are S 400 / M 480 / L 640 |
| paper-overlays.spec.ts | 97 | toBe | 640 | 640 | — | dialog widths are S 400 / M 480 / L 640 |
| paper-overlays.spec.ts | 100 | toBe | 400 | 400 | — | dialog widths are S 400 / M 480 / L 640 |
| paper-overlays.spec.ts | 107 | toHaveCSS | background-color: rgb(251, 249, 245) | rgb(251, 249, 245) | — | dialog face: sheet surface, 16px corners, 16px serif title, 28px close |
| paper-overlays.spec.ts | 108 | toHaveCSS | border-top-left-radius: 16px | 16px | — | dialog face: sheet surface, 16px corners, 16px serif title, 28px close |
| paper-overlays.spec.ts | 110 | toHaveCSS | font-size: 16px | 16px | — | dialog face: sheet surface, 16px corners, 16px serif title, 28px close |
| paper-overlays.spec.ts | 113 | toBe | 28 | 28 | — | dialog face: sheet surface, 16px corners, 16px serif title, 28px close |
| paper-overlays.spec.ts | 114 | toBe | 28 | 28 | — | dialog face: sheet surface, 16px corners, 16px serif title, 28px close |
| paper-overlays.spec.ts | 124 | toBe | 640 | 640 | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 127 | toHaveCSS | background-color: rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 128 | toHaveCSS | border-top-width: 0px | 0px | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 131 | toHaveCSS | font-size: 12px | 12px | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 139 | toBe | 20 | 20 | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 140 | toBe | 20 | 20 | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 141 | toBe | 32 | 32 | — | split footer: hint left, actions right, no band fill |
| paper-overlays.spec.ts | 158 | toBeLessThanOrEqual | ≤ 468 | 468 | — | footer stays on screen on a short viewport; only the body scrolls |
| paper-overlays.spec.ts | 159 | toBeLessThanOrEqual | ≤ 468 | 452 | — | footer stays on screen on a short viewport; only the body scrolls |
| paper-overlays.spec.ts | 176 | toHaveCSS | border-top-left-radius: 10px | 10px | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 177 | toHaveCSS | padding-top: 4px | 4px | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 178 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 182 | toBeGreaterThan | > 0 | 4 | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 185 | toBe | 32 | 32 | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 186 | toHaveCSS | font-size: 13.5px | 13.5px | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 188 | toBe | 15 | 15 | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 192 | toHaveCSS | background-color: rgb(246, 242, 236) | rgb(246, 242, 236) | — | Paper menu: 32px rows, 13.5px text, 15px icons, 10px panel corners, 4px padding |
| paper-overlays.spec.ts | 204 | toHaveCSS | border-top-left-radius: 10px | 10px | — | user menu rides the same Paper menu face |
| paper-overlays.spec.ts | 205 | toHaveCSS | padding-top: 4px | 4px | — | user menu rides the same Paper menu face |
| paper-overlays.spec.ts | 208 | toBe | 32 | 32 | — | user menu rides the same Paper menu face |
| paper-overlays.spec.ts | 209 | toHaveCSS | font-size: 13.5px | 13.5px | — | user menu rides the same Paper menu face |
| paper-overlays.spec.ts | 222 | toBe | 40 | 40 | — | provider picker: grouped rows, search hides empty groups |
| paper-overlays.spec.ts | 226 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | provider picker: grouped rows, search hides empty groups |
| paper-page-patterns.spec.ts | 39 | toBe | 10px | 10px | — | board task card and account settings card share --radius-card (R1–R3) |
| paper-page-patterns.spec.ts | 40 | toHaveCSS | border-top-left-radius: 10px | 10px | — | board task card and account settings card share --radius-card (R1–R3) |
| paper-page-patterns.spec.ts | 45 | toHaveCSS | border-top-left-radius: 10px | 10px | — | board task card and account settings card share --radius-card (R1–R3) |
| paper-page-patterns.spec.ts | 69 | toEqual | [52,52,52] | [52,52,52] | — | account settings rows are equal 52px with no doubled edge divider (S1, S2) |
| paper-page-patterns.spec.ts | 73 | toEqual | ["0px","0px","0px"] | ["0px","0px","0px"] | — | account settings rows are equal 52px with no doubled edge divider (S1, S2) |
| paper-page-patterns.spec.ts | 77 | toEqual | ["1px","1px","0px"] | ["1px","1px","0px"] | — | account settings rows are equal 52px with no doubled edge divider (S1, S2) |
| paper-page-patterns.spec.ts | 121 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 121 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 122 | toBe | none | none | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 122 | toBe | none | none | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 123 | toBe | rgb(116, 106, 95) | rgb(116, 106, 95) | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 123 | toBe | rgb(172, 167, 160) | rgb(172, 167, 160) | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 124 | toBe | 24 | 24 | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 124 | toBe | 24 | 24 | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 125 | toBe | default | default | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 125 | toBe | default | default | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 126 | toBe | default | default | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 126 | toBe | default | default | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 127 | toBe | 32 | 32 | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 127 | toBe | 32 | 32 | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 128 | toBe | 8px | 8px | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 128 | toBe | 8px | 8px | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 129 | toBeLessThan | < 384 | 76 | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 129 | toBeLessThan | < 384 | 76 | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 130 | toEqual | ["14px","500"] | ["14px","500"] | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 130 | toEqual | ["14px","500"] | ["14px","500"] | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 131 | toEqual | ["12px","rgb(116, 106, 95)"] | ["12px","rgb(116, 106, 95)"] | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 131 | toEqual | ["12px","rgb(172, 167, 160)"] | ["12px","rgb(172, 167, 160)"] | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 132 | toBeLessThanOrEqual | ≤ 320 | 320 | — | API keys empty state: bare ink-3 icon, default primary, type keys (light) (E1–E4) |
| paper-page-patterns.spec.ts | 132 | toBeLessThanOrEqual | ≤ 320 | 320 | — | API keys empty state: bare ink-3 icon, default primary, type keys (dark) (E1–E4) |
| paper-page-patterns.spec.ts | 166 | toEqual | ["0px","0px","0px"] | ["0px","0px","0px"] | — | clickable resource rows keep the card divider between rows only (light) (S3) |
| paper-page-patterns.spec.ts | 166 | toEqual | ["0px","0px","0px"] | ["0px","0px","0px"] | — | clickable resource rows keep the card divider between rows only (dark) (S3) |
| paper-page-patterns.spec.ts | 170 | toEqual | ["1px","1px","0px"] | ["1px","1px","0px"] | — | clickable resource rows keep the card divider between rows only (light) (S3) |
| paper-page-patterns.spec.ts | 170 | toEqual | ["1px","1px","0px"] | ["1px","1px","0px"] | — | clickable resource rows keep the card divider between rows only (dark) (S3) |
| paper-page-patterns.spec.ts | 171 | toBe | rgb(236, 229, 218) | rgb(236, 229, 218) | — | clickable resource rows keep the card divider between rows only (light) (S3) |
| paper-page-patterns.spec.ts | 171 | toBe | rgb(62, 58, 52) | rgb(62, 58, 52) | — | clickable resource rows keep the card divider between rows only (dark) (S3) |
| paper-page-patterns.spec.ts | 172 | toBe | rgb(236, 229, 218) | rgb(236, 229, 218) | — | clickable resource rows keep the card divider between rows only (light) (S3) |
| paper-page-patterns.spec.ts | 172 | toBe | rgb(62, 58, 52) | rgb(62, 58, 52) | — | clickable resource rows keep the card divider between rows only (dark) (S3) |
| paper-project-page.spec.ts | 79 | toBe | 768 | 768 | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 79 | toBe | 768 | 768 | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 83 | toHaveCSS | border-top-left-radius: 10px | 10px | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 83 | toHaveCSS | border-top-left-radius: 10px | 10px | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 100 | toEqual | [52,52] | [52,52] | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 100 | toEqual | [52,52] | [52,52] | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 104 | toEqual | ["rgba(0, 0, 0, 0)","rgba(0, 0, 0, 0)"] | ["rgba(0, 0, 0, 0)","rgba(0, 0, 0, 0)"] | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 104 | toEqual | ["rgba(0, 0, 0, 0)","rgba(0, 0, 0, 0)"] | ["rgba(0, 0, 0, 0)","rgba(0, 0, 0, 0)"] | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 108 | toEqual | [["0px","1px"],["0px","0px"]] | [["0px","1px"],["0px","0px"]] | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 108 | toEqual | [["0px","1px"],["0px","0px"]] | [["0px","1px"],["0px","0px"]] | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 121 | toHaveCSS | color: rgb(180, 83, 42) | rgb(180, 83, 42) | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 121 | toHaveCSS | color: rgb(240, 146, 109) | rgb(240, 146, 109) | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 125 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 125 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 128 | toHaveCSS | font-size: 13.5px | 13.5px | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 128 | toHaveCSS | font-size: 13.5px | 13.5px | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 129 | toHaveCSS | color: rgb(43, 38, 32) | rgb(43, 38, 32) | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 129 | toHaveCSS | color: rgb(236, 231, 223) | rgb(236, 231, 223) | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 132 | toHaveCSS | font-size: 12px | 12px | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 132 | toHaveCSS | font-size: 12px | 12px | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 133 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 133 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 135 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 135 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 139 | toHaveCSS | border-top-left-radius: 10px | 10px | — | tasks: reading column, one card of 52px rows with status and meta (light) |
| paper-project-page.spec.ts | 139 | toHaveCSS | border-top-left-radius: 10px | 10px | — | tasks: reading column, one card of 52px rows with status and meta (dark) |
| paper-project-page.spec.ts | 151 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | tasks: empty state is the shared EmptyState (light) |
| paper-project-page.spec.ts | 151 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | tasks: empty state is the shared EmptyState (dark) |
| paper-project-page.spec.ts | 154 | toBe | 32 | 32 | — | tasks: empty state is the shared EmptyState (light) |
| paper-project-page.spec.ts | 154 | toBe | 32 | 32 | — | tasks: empty state is the shared EmptyState (dark) |
| paper-project-page.spec.ts | 155 | toHaveCSS | border-top-left-radius: 8px | 8px | — | tasks: empty state is the shared EmptyState (light) |
| paper-project-page.spec.ts | 155 | toHaveCSS | border-top-left-radius: 8px | 8px | — | tasks: empty state is the shared EmptyState (dark) |
| paper-project-page.spec.ts | 167 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 167 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 168 | toHaveCSS | color: rgb(116, 106, 95) | rgb(116, 106, 95) | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 168 | toHaveCSS | color: rgb(172, 167, 160) | rgb(172, 167, 160) | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 174 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 174 | toHaveCSS | background-color: rgb(47, 42, 38) | rgb(47, 42, 38) | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 175 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 175 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(62, … | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 179 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 179 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 180 | toHaveCSS | font-size: 12px | 12px | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 180 | toHaveCSS | font-size: 12px | 12px | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 182 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 182 | toHaveCSS | font-size: 13.5px | 13.5px | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-page.spec.ts | 186 | toHaveCSS | font-size: 12px | 12px | — | files: bleed body, picker face on the selected file, type scale (light) |
| paper-project-page.spec.ts | 186 | toHaveCSS | font-size: 12px | 12px | — | files: bleed body, picker face on the selected file, type scale (dark) |
| paper-project-pages.spec.ts | 38 | toBe | 56 | 56 | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 38 | toBe | 56 | 56 | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 39 | toBe | 56 | 56 | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 39 | toBe | 56 | 56 | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 46 | toHaveCSS | border-top-left-radius: 10px | 10px | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 46 | toHaveCSS | border-top-left-radius: 10px | 10px | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 60 | toEqual | [52,52,52,52] | [52,52,52,52] | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 60 | toEqual | [52,52,52,52] | [52,52,52,52] | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 64 | toEqual | ["0px","0px","0px","0px"] | ["0px","0px","0px","0px"] | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 64 | toEqual | ["0px","0px","0px","0px"] | ["0px","0px","0px","0px"] | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 68 | toEqual | ["1px","1px","1px","0px"] | ["1px","1px","1px","0px"] | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 68 | toEqual | ["1px","1px","1px","0px"] | ["1px","1px","1px","0px"] | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 76 | toHaveCSS | border-top-left-radius: 10px | 10px | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 76 | toHaveCSS | border-top-left-radius: 10px | 10px | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 78 | toBe | 32 | 32 | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 78 | toBe | 32 | 32 | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 79 | toHaveCSS | border-top-left-radius: 8px | 8px | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 79 | toHaveCSS | border-top-left-radius: 8px | 8px | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 83 | toBe | 32 | 32 | — | project settings: header, one card of equal rows, danger zone card (light) |
| paper-project-pages.spec.ts | 83 | toBe | 32 | 32 | — | project settings: header, one card of equal rows, danger zone card (dark) |
| paper-project-pages.spec.ts | 96 | toBe | 56 | 56 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 96 | toBe | 56 | 56 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 100 | toBeGreaterThanOrEqual | ≥ 28 | 33554400 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 100 | toBeGreaterThanOrEqual | ≥ 28 | 33554400 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 110 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 110 | toBe | rgb(47, 42, 38) | rgb(47, 42, 38) | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 116 | toBeLessThanOrEqual | ≤ 520 | 520 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 116 | toBeLessThanOrEqual | ≤ 520 | 520 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 117 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 117 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 118 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 118 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 119 | toHaveCSS | border-top-left-radius: 8px | 8px | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 119 | toHaveCSS | border-top-left-radius: 8px | 8px | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 124 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 124 | toBe | 32 | 32 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 125 | toBeLessThan | < 200 | 76 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 125 | toBeLessThan | < 200 | 76 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-project-pages.spec.ts | 127 | toBeLessThanOrEqual | ≤ 1 | 0 | — | new project: ring avatar, 520px form stack, right-aligned create (light) |
| paper-project-pages.spec.ts | 127 | toBeLessThanOrEqual | ≤ 1 | 0 | — | new project: ring avatar, 520px form stack, right-aligned create (dark) |
| paper-resource-pages.spec.ts | 37 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | skills empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 37 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | mcp empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 37 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | secrets empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 37 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | machines empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 38 | toBe | 24 | 24 | — | skills empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 38 | toBe | 24 | 24 | — | mcp empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 38 | toBe | 24 | 24 | — | secrets empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 38 | toBe | 24 | 24 | — | machines empty state: bare ink-3 icon, no tile |
| paper-resource-pages.spec.ts | 52 | toHaveCSS | border-top-left-radius: 10px | 10px | — | skills list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 52 | toHaveCSS | border-top-left-radius: 10px | 10px | — | mcp list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 52 | toHaveCSS | border-top-left-radius: 10px | 10px | — | secrets list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 52 | toHaveCSS | border-top-left-radius: 10px | 10px | — | machines list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 56 | toEqual | [52] | [52] | — | skills list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 56 | toEqual | [52] | [52] | — | mcp list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 56 | toEqual | [52,52] | [52,52] | — | secrets list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 56 | toEqual | [52,52] | [52,52] | — | machines list: one settings card of 52px rows, 10px corner |
| paper-resource-pages.spec.ts | 67 | toHaveCSS | background-color: rgb(95, 143, 90) | rgb(95, 143, 90) | — | machines: 添加机器 sits in the top bar, no dashed full-width bar |
| paper-resource-pages.spec.ts | 73 | toHaveCSS | background-color: rgb(243, 238, 229) | rgb(243, 238, 229) | — | providers runtime tabs: canvas track, chosen tab white with a 1px ring |
| paper-resource-pages.spec.ts | 75 | toHaveCSS | background-color: rgb(255, 255, 255) | rgb(255, 255, 255) | — | providers runtime tabs: canvas track, chosen tab white with a 1px ring |
| paper-resource-pages.spec.ts | 77 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | providers runtime tabs: canvas track, chosen tab white with a 1px ring |
| paper-resource-pages.spec.ts | 78 | toHaveCSS | height: 28px | 28px | — | providers runtime tabs: canvas track, chosen tab white with a 1px ring |
| paper-resource-pages.spec.ts | 93 | toHaveCSS | height: 32px | 32px | — | secret dialog: FormActions footer, primary is not a full-width bar |
| paper-resource-pages.spec.ts | 93 | toHaveCSS | height: 32px | 32px | — | skill dialog: FormActions footer, primary is not a full-width bar |
| paper-resource-pages.spec.ts | 93 | toHaveCSS | height: 32px | 32px | — | skill import dialog: FormActions footer, primary is not a full-width bar |
| paper-resource-pages.spec.ts | 96 | toBeLessThan | < 195.7708740234375 | 74.3929443359375 | — | secret dialog: FormActions footer, primary is not a full-width bar |
| paper-resource-pages.spec.ts | 96 | toBeLessThan | < 237.63694763183594 | 75.251708984375 | — | skill dialog: FormActions footer, primary is not a full-width bar |
| paper-resource-pages.spec.ts | 96 | toBeLessThan | < 239.09771728515625 | 48.8157958984375 | — | skill import dialog: FormActions footer, primary is not a full-width bar |
| paper-segmented.spec.ts | 113 | toBe | 32 | 32 | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 113 | toBe | 32 | 32 | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 114 | toBe | 2px | 2px | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 114 | toBe | 2px | 2px | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 115 | toBe | 8px | 8px | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 115 | toBe | 8px | 8px | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 116 | toBe | 28 | 28 | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 116 | toBe | 28 | 28 | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 117 | toBe | 6px | 6px | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 117 | toBe | 6px | 6px | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 119 | toBe | 500 | 500 | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 119 | toBe | 500 | 500 | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 120 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 120 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 121 | not.toBe | rgb(43, 38, 32) | rgb(94, 86, 77) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 121 | not.toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 122 | not.toBe | rgb(243, 238, 229) | rgb(255, 255, 255) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 122 | not.toBe | rgb(26, 22, 18) | rgb(47, 42, 38) | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 124 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 125 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 126 | toBe | rgb(43, 38, 32) | rgb(43, 38, 32) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 127 | toBe | rgb(94, 86, 77) | rgb(94, 86, 77) | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 130 | toEqual | {"name":"agent tabs","trackBg":"rgb(243, 238, 229)","trackHeight":32,"trackPadding":"2px","trackRadius":"8px",… | {"name":"agent tabs","trackBg":"rgb(243, 238, 229)","trackHeight":32,"trackPadding":"2px","trackRadius":"8px",… | — | light: every segmented control wears the same face |
| paper-segmented.spec.ts | 130 | toEqual | {"name":"agent tabs","trackBg":"rgb(26, 22, 18)","trackHeight":32,"trackPadding":"2px","trackRadius":"8px","se… | {"name":"agent tabs","trackBg":"rgb(26, 22, 18)","trackHeight":32,"trackPadding":"2px","trackRadius":"8px","se… | — | dark: every segmented control wears the same face |
| paper-segmented.spec.ts | 180 | toBe | solid | solid | — | agent tabs: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 180 | toBe | solid | solid | — | schedules frequency: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 181 | toBe | 2 | 2 | — | agent tabs: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 181 | toBe | 2 | 2 | — | schedules frequency: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 182 | toBe | -2 | -2 | — | agent tabs: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 182 | toBe | -2 | -2 | — | schedules frequency: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 183 | toBeLessThanOrEqual | ≤ 0 | 0 | — | agent tabs: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 183 | toBeLessThanOrEqual | ≤ 0 | 0 | — | schedules frequency: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 185 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | agent tabs: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 185 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | schedules frequency: keyboard focus draws the ring inside the option |
| paper-segmented.spec.ts | 196 | toBe | none | none | — | pointer click leaves no focus ring |
| paper-segmented.spec.ts | 202 | toBe | none | none | — | pointer click leaves no focus ring |
| paper-settings-list.spec.ts | 59 | toBe | 0 | 0 | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 59 | toBe | 0 | 0 | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 59 | toBe | 0 | 0 | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 60 | toBe | 0px | 0px | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 60 | toBe | 0px | 0px | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 60 | toBe | 0px | 0px | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 61 | toBe | 0px | 0px | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 61 | toBe | 0px | 0px | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 61 | toBe | 0px | 0px | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 65 | toBe | 1px rgb(236, 229, 218) | 1px rgb(236, 229, 218) | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 65 | toBe | 1px rgb(236, 229, 218) | 1px rgb(236, 229, 218) | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 65 | toBe | 1px rgb(236, 229, 218) | 1px rgb(236, 229, 218) | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 67 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 67 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 67 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 68 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 68 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 68 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 69 | toContain | rgb(236, 229, 218) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 69 | toContain | rgb(236, 229, 218) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | account: editing the name keeps the card untouched (no row appears) |
| paper-settings-list.spec.ts | 69 | toContain | rgb(236, 229, 218) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 87 | toEqual | ["语言","密度","推送通知"] | ["语言","密度","推送通知"] | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 91 | toEqual | [52,52,52] | [52,52,52] | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 100 | toBeLessThan | < 162 | 138 | — | account: three equal 52px rows, dividers between rows only, name above the card |
| paper-settings-list.spec.ts | 126 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | account: the selected density segment is a white tab with a 1px ring (F8) |
| paper-settings-list.spec.ts | 127 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | account: the selected density segment is a white tab with a 1px ring (F8) |
| paper-settings-list.spec.ts | 128 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | account: the selected density segment is a white tab with a 1px ring (F8) |
| paper-settings-list.spec.ts | 135 | toEqual | [32,32] | [32,32] | — | account: the selected density segment is a white tab with a 1px ring (F8) |
| paper-settings-list.spec.ts | 145 | toEqual | ["职责","默认 skill","运行时","模型","思考强度"] | ["职责","默认 skill","运行时","模型","思考强度"] | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 147 | toBeGreaterThanOrEqual | ≥ 52 | 65 | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-settings-list.spec.ts | 148 | toEqual | [52,52,52,52] | [52,52,52,52] | — | agent overview: same card shape; one-line rows are 52px, two-line rows grow |
| paper-sidebar.spec.ts | 21 | toBe | 248 | 248 | — | five parts stack top to bottom in a 248px sidebar |
| paper-sidebar.spec.ts | 52 | toEqual | [12,60,106,139,172,221,633,670] | [12,60,106,139,172,221,633,670] | — | five parts stack top to bottom in a 248px sidebar |
| paper-sidebar.spec.ts | 58 | toBeLessThanOrEqual | ≤ 16 | 10 | — | five parts stack top to bottom in a 248px sidebar |
| paper-sidebar.spec.ts | 117 | toBe | rgb(251, 249, 245) | rgb(251, 249, 245) | — | active row = sheet fill + hairline ring + accent icon |
| paper-sidebar.spec.ts | 118 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | active row = sheet fill + hairline ring + accent icon |
| paper-sidebar.spec.ts | 119 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | active row = sheet fill + hairline ring + accent icon |
| paper-sidebar.spec.ts | 120 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | active row = sheet fill + hairline ring + accent icon |
| paper-sidebar.spec.ts | 141 | toBeGreaterThan | > 8 | 23 | — | 资源 folds by default, opens to an indented sub-list, survives reload |
| paper-sidebar.spec.ts | 145 | toBe | 0 | 0 | — | 资源 folds by default, opens to an indented sub-list, survives reload |
| paper-sidebar.spec.ts | 185 | toBe | rgb(192, 106, 67) | rgb(192, 106, 67) | — | project rows: tile colors follow --project-tile-N in order, open-task counts |
| paper-sidebar.spec.ts | 186 | toEqual | ["R","R","R"] | ["R","R","R"] | — | project rows: tile colors follow --project-tile-N in order, open-task counts |
| paper-sidebar.spec.ts | 187 | toEqual | ["2","1","null"] | ["2","1","null"] | — | project rows: tile colors follow --project-tile-N in order, open-task counts |
| paper-sidebar.spec.ts | 212 | toBe | ellipsis | ellipsis | — | long project names truncate and keep the count visible |
| paper-sidebar.spec.ts | 214 | toBe | 32 | 32 | — | long project names truncate and keep the count visible |
| paper-sidebar.spec.ts | 231 | toBe | 40 | 40 | — | collapsed rail keeps 需要我处理 with its badge and the expand toggle |
| paper-sidebar.spec.ts | 238 | toBe | 248 | 248 | — | collapsed rail keeps 需要我处理 with its badge and the expand toggle |
| paper-team-pages.spec.ts | 27 | toBe | 10px | 10px | — | agent card is a Paper card: 10px corner, white, 1px ring plus a lift |
| paper-team-pages.spec.ts | 28 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | agent card is a Paper card: 10px corner, white, 1px ring plus a lift |
| paper-team-pages.spec.ts | 29 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | agent card is a Paper card: 10px corner, white, 1px ring plus a lift |
| paper-team-pages.spec.ts | 30 | toContain | 0px 1px 2px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | agent card is a Paper card: 10px corner, white, 1px ring plus a lift |
| paper-team-pages.spec.ts | 53 | toBe | 3 | 3 | — | card status is icon + colour + label for each home-machine state |
| paper-team-pages.spec.ts | 65 | toBeLessThanOrEqual | ≤ 17 | 16 | — | card holds a name and one meta line: model · home machine |
| paper-team-pages.spec.ts | 104 | toBe | 8px | 8px | — | create dialog: labels point at controls, 取消 closes, 创建 sits right of 取消 |
| paper-topbar.spec.ts | 20 | toBe | 56 | 56 | — | bar geometry: 56px, serif page title, summary N = the 待处理 column count |
| paper-topbar.spec.ts | 29 | toBe | 500 | 500 | — | bar geometry: 56px, serif page title, summary N = the 待处理 column count |
| paper-topbar.spec.ts | 32 | toBeGreaterThan | > 0 | 1 | — | bar geometry: 56px, serif page title, summary N = the 待处理 column count |
| paper-topbar.spec.ts | 37 | toBe | 600 | 600 | — | bar geometry: 56px, serif page title, summary N = the 待处理 column count |
| paper-topbar.spec.ts | 66 | toBeLessThanOrEqual | ≤ 1 | 0.5 | — | active filter: summary follows the narrowed column, badge + chip stay, popover anchors under 筛选 |
| paper-topbar.spec.ts | 67 | toBeGreaterThan | > 53.5 | 56.48921585083008 | — | active filter: summary follows the narrowed column, badge + chip stay, popover anchors under 筛选 |
| paper-topbar.spec.ts | 88 | toHaveCSS | height: 32px | 32px | — | 新任务 is the shadcn default Button (ink, 32px, 8px corners) and opens the same new-task dialog as C |
| paper-topbar.spec.ts | 89 | toHaveCSS | border-top-left-radius: 8px | 8px | — | 新任务 is the shadcn default Button (ink, 32px, 8px corners) and opens the same new-task dialog as C |
| paper-topbar.spec.ts | 111 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | keyboard: Tab reaches all three controls with a visible focus ring; Enter on 新任务 opens the dialog |
| paper-topbar.spec.ts | 126 | toBe | 56 | 56 | — | narrow window: the summary truncates, the controls stay on one row inside the bar |
| paper-topbar.spec.ts | 132 | toBe | 32 | 32 | — | narrow window: the summary truncates, the controls stay on one row inside the bar |
| paper-topbar.spec.ts | 133 | toBe | 21.5 | 21.5 | — | narrow window: the summary truncates, the controls stay on one row inside the bar |
| paper-topbar.spec.ts | 134 | toBeLessThanOrEqual | ≤ 670 | 482.5 | — | narrow window: the summary truncates, the controls stay on one row inside the bar |
| project-commit-detail.spec.ts | 188 | toEqual | {"__object":"Set"} | {"__object":"Set"} | — | C3 多提交来回切换不串数据（sha 进 queryKey） |
| project-files-tree.spec.ts | 155 | toEqual | [] | [] | — | W2 点文件夹 → 重发 tree?path= 并列出内容；不发文件读请求 |
| project-files-tree.spec.ts | 229 | toEqual | ["apps","docs","README.md","zebra.md"] | ["apps","docs","README.md","zebra.md"] | — | W9 展示序：文件夹组置顶，组内字母序 |
| project-github-issues.spec.ts | 200 | toEqual | [{"number":7}] | [{"number":7}] | — | 1. 已连接 github 项目：入口 → 弹层 → 点选导入 → 详情见 issue 标题与全部标签 |
| project-github-issues.spec.ts | 223 | toEqual | ["state=open&page=1"] | ["state=open&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 229 | toEqual | ["state=open&page=1","state=closed&page=1"] | ["state=open&page=1","state=closed&page=1"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-github-issues.spec.ts | 237 | toEqual | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | ["state=open&page=1","state=closed&page=1","state=open&page=2"] | — | 4. 状态过滤与分页参数直达请求面；hasMore=false 下一页禁用 |
| project-new-fs-pick.spec.ts | 139 | toBe | 1 | 1 | — | 在飞期按钮 disabled，双击单发 |
| project-new-repo.spec.ts | 255 | toBe | solid | solid | — | the name input focus ring is the global outline, not the UA default |
| project-new-repo.spec.ts | 256 | toBe | 2px | 2px | — | the name input focus ring is the global outline, not the UA default |
| project-new-repo.spec.ts | 257 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the name input focus ring is the global outline, not the UA default |
| project-new-repo.spec.ts | 258 | not.toContain | rgb(0, 95, 204) | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the name input focus ring is the global outline, not the UA default |
| project-new-repo.spec.ts | 272 | toEqual | [{"name":"Plain","teamId":"team-1"}] | [{"name":"Plain","teamId":"team-1"}] | — | untouched submit posts a repo-less body and navigates on 201 |
| project-new-repo.spec.ts | 288 | toEqual | [{"name":"my-repo","teamId":"team-1","kind":"local","localPath":"/tmp/my-repo"},{"name":"pacman","teamId":"tea… | [{"name":"my-repo","kind":"local","localPath":"/tmp/my-repo","teamId":"team-1"},{"name":"pacman","kind":"githu… | — | local and github submits carry kind + their wire field |
| project-new-repo.spec.ts | 332 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 路径不存在 |
| project-new-repo.spec.ts | 332 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 不是 git 仓库 |
| project-new-repo.spec.ts | 332 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: 需要绝对路径 |
| project-new-repo.spec.ts | 332 | toBe | rgb(255, 171, 183) | rgb(255, 171, 183) | — | a 400 localPath reason renders the error row: invalid body at localPath: case none |
| project-settings-identity.spec.ts | 117 | toEqual | {"name":"pacman-main"} | {"name":"pacman-main"} | — | settings: name and description edits reach PATCH; description clear writes explicit null |
| project-settings-identity.spec.ts | 133 | toBe | 2 | 2 | — | settings: name and description edits reach PATCH; description clear writes explicit null |
| project-settings-identity.spec.ts | 134 | toEqual | {"description":"迁移期的主项目"} | {"description":"迁移期的主项目"} | — | settings: name and description edits reach PATCH; description clear writes explicit null |
| project-settings-identity.spec.ts | 139 | toBe | 3 | 3 | — | settings: name and description edits reach PATCH; description clear writes explicit null |
| project-settings-identity.spec.ts | 183 | toEqual | {"repoKind":"github","githubRepo":"xiechimon/pacman","localPath":"/Users/who/code/pacman"} | {"repoKind":"github","githubRepo":"xiechimon/pacman","localPath":"/Users/who/code/pacman"} | — | settings: local project shows conversion card; submit carries repoKind/githubRepo/localPath |
| project-settings-local-path.spec.ts | 93 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | settings: github project shows local-path field; save writes path; clear writes explicit null |
| project-settings-local-path.spec.ts | 94 | toEqual | {"localPath":"/Users/who/code/pacman"} | {"localPath":"/Users/who/code/pacman"} | — | settings: github project shows local-path field; save writes path; clear writes explicit null |
| project-settings-local-path.spec.ts | 101 | toBeGreaterThanOrEqual | ≥ 2 | 2 | — | settings: github project shows local-path field; save writes path; clear writes explicit null |
| project-tasks-toolbar.spec.ts | 49 | toBe | grid | grid | — | view toggle swaps rows for grid cards and persists |
| providers-tabs.spec.ts | 230 | toBe | 455 | 455 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 232 | toBe | 455 | 455 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 234 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 235 | toBe | 768 | 768 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| providers-tabs.spec.ts | 240 | toBeLessThanOrEqual | ≤ 514.75 | 512.75 | — | 几何：tablist/header/模型行卡同贴内容列左缘，tab 序 pi 左 claude-code 右 |
| queued-action.spec.ts | 157 | toHaveCSS | opacity: 1 | 1 | — | board: the queued card renders no 开始, the todo card shows it on hover |
| registry-focus-ring.spec.ts | 89 | toBe | solid | solid | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 89 | toBe | solid | solid | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 89 | toBe | solid | solid | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 89 | toBe | solid | solid | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 89 | toBe | solid | solid | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 90 | toBe | 2px | 2px | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 90 | toBe | 2px | 2px | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 90 | toBe | 2px | 2px | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 90 | toBe | 2px | 2px | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 90 | toBe | 2px | 2px | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 91 | toBe | 2px | 2px | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 91 | toBe | 2px | 2px | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 91 | toBe | 2px | 2px | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 91 | toBe | 2px | 2px | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 91 | toBe | 2px | 2px | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 92 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 92 | toBe | rgb(180, 83, 42) | rgb(180, 83, 42) | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 92 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 92 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 92 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 93 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 93 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 93 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 93 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 93 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 94 | not.toBe | rgb(131, 127, 123) | rgb(62, 58, 52) | — | input, select, and button use the global outline |
| registry-focus-ring.spec.ts | 94 | not.toBe | rgb(143, 137, 133) | rgb(236, 229, 218) | — | the same three controls use the global outline in light |
| registry-focus-ring.spec.ts | 94 | not.toBe | rgb(131, 127, 123) | rgb(62, 58, 52) | — | a default textarea uses the global outline in both themes |
| registry-focus-ring.spec.ts | 94 | not.toBe | rgb(131, 127, 123) | rgb(62, 58, 52) | — | clicking the name input shows the global outline, not the gray ring |
| registry-focus-ring.spec.ts | 94 | not.toBe | rgb(131, 127, 123) | rgb(236, 231, 223) | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 166 | toBe | solid | solid | — | aria-invalid keeps a 3px destructive shadow and the global outline |
| registry-focus-ring.spec.ts | 167 | toBe | 2px | 2px | — | aria-invalid keeps a 3px destructive shadow and the global outline |
| registry-focus-ring.spec.ts | 168 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | aria-invalid keeps a 3px destructive shadow and the global outline |
| registry-focus-ring.spec.ts | 169 | toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | aria-invalid keeps a 3px destructive shadow and the global outline |
| registry-focus-ring.spec.ts | 179 | toBe | rgb(236, 231, 223) | rgb(236, 231, 223) | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 185 | toBe | rgb(81, 76, 71) | rgb(81, 76, 71) | — | checkbox, switch, and badge use the global outline |
| registry-focus-ring.spec.ts | 210 | toBe | none | none | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 211 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 214 | toBe | solid | solid | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 215 | toBe | 2px | 2px | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 216 | toBe | 2px | 2px | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 217 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 218 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | input-group draws the outline on the shell, not the control |
| registry-focus-ring.spec.ts | 230 | toBe | solid | solid | — | a segmented option draws the focus ring inset |
| registry-focus-ring.spec.ts | 231 | toBe | 2px | 2px | — | a segmented option draws the focus ring inset |
| registry-focus-ring.spec.ts | 232 | toBe | -2px | -2px | — | a segmented option draws the focus ring inset |
| registry-focus-ring.spec.ts | 233 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | a segmented option draws the focus ring inset |
| registry-focus-ring.spec.ts | 234 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | a segmented option draws the focus ring inset |
| registry-focus-ring.spec.ts | 244 | toBe | solid | solid | — | the sidebar user button uses the global outline |
| registry-focus-ring.spec.ts | 245 | toBe | 2px | 2px | — | the sidebar user button uses the global outline |
| registry-focus-ring.spec.ts | 246 | toBe | 2px | 2px | — | the sidebar user button uses the global outline |
| registry-focus-ring.spec.ts | 247 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | the sidebar user button uses the global outline |
| registry-focus-ring.spec.ts | 248 | not.toContain | 0px 0px 0px 3px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | the sidebar user button uses the global outline |
| resource-back-spa.spec.ts | 50 | toBe | 0 | 0 | — | agent detail back is an in-SPA navigation, not a document reload |
| resource-back-spa.spec.ts | 50 | toBe | 0 | 0 | — | machine detail back is an in-SPA navigation, not a document reload |
| review-reject.spec.ts | 166 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 167 | toBe | 0 | 0 | — | FM1/FM2: 静息 review 发送 = steps revision 动作面，draft 清空、chip 即时翻规划中 |
| review-reject.spec.ts | 204 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM3: 更多菜单出现「请求修改」入口，弹层收反馈后走同一动作面 |
| review-reject.spec.ts | 259 | toBe | 1 | {"__fn":"() => steerPosts"} | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 260 | toBe | 0 | 0 | — | FM4: 运行中 review（claimed 步在场）发送保持 steer 语义，不抢动作面 |
| review-reject.spec.ts | 280 | toBe | 1 | {"__fn":"() => stepPosts"} | — | FM2: 打回被拒（409 竞态）draft 逐字保留 + 提示行显性，不静默吞 |
| schedules-live.spec.ts | 119 | toBeLessThanOrEqual | ≤ 488.5 | 475.2662353515625 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 137 | toBe | 1 | {"__fn":"() => posts.length"} | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 146 | toBe | 10 | 10 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| schedules-live.spec.ts | 147 | toBe | 0 | 0 | — | live face: 保存 fires POST /api/schedules with the form state (#1037) |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-close-flash.spec.ts | 36 | toHaveCSS | transform: none | none | — | 三连击：关→开落在开态且输入聚焦 |
| search-close-flash.spec.ts | 82 | toBeLessThanOrEqual | ≤ 0.434784 | 0.314784 | — | 第二下 Ctrl+K 关闭不闪：退出透明度单调递减 |
| search-focus.spec.ts | 137 | not.toBe | rgba(0, 0, 0, 0) | rgb(36, 32, 27) | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 142 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 152 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(pill)"} | — | 常亮互斥: page-layer pill dims while the panel is open, restores on close |
| search-focus.spec.ts | 162 | not.toBe | rgba(0, 0, 0, 0) | rgb(36, 32, 27) | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 165 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 169 | not.toBe | rgba(0, 0, 0, 0) | {"__fn":"() => pillBg(rail)"} | — | 常亮互斥 holds on the collapsed rail form |
| search-focus.spec.ts | 196 | toHaveCSS | transform: none | none | — | the caret is not clipped where it meets the input edge |
| search-focus.spec.ts | 223 | toBeGreaterThanOrEqual | ≥ 14 | 16 | — | the caret is not clipped where it meets the input edge |
| search-result-rows.spec.ts | 100 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(first)"} | — | 静息无常亮;hover 哪行亮哪行,且只亮一行 |
| search-result-rows.spec.ts | 138 | toBe | rgba(0, 0, 0, 0) | {"__fn":"() => rowBg(second)"} | — | 鼠标一动让位:键盘光标交还 hover |
| segmented-controls.spec.ts | 33 | toBe | false | rgb(197, 192, 185) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 33 | toBe | false | rgb(197, 192, 185) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 33 | toBe | false | rgb(197, 192, 185) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 33 | toBe | false | rgb(94, 86, 77) | — | user-menu 外观 seg: hover steps the ink, click switches the theme |
| segmented-controls.spec.ts | 33 | toBe | false | rgb(197, 192, 185) | — | branch-dialog seg: hover steps the Git ink, click swaps the tab body |
| segmented-controls.spec.ts | 37 | not.toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 37 | not.toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 37 | not.toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 37 | not.toBe | rgb(43, 38, 32) | rgb(94, 86, 77) | — | user-menu 外观 seg: hover steps the ink, click switches the theme |
| segmented-controls.spec.ts | 37 | not.toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | branch-dialog seg: hover steps the Git ink, click swaps the tab body |
| segmented-controls.spec.ts | 38 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 38 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 38 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 38 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | user-menu 外观 seg: hover steps the ink, click switches the theme |
| segmented-controls.spec.ts | 38 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | branch-dialog seg: hover steps the Git ink, click swaps the tab body |
| segmented-controls.spec.ts | 40 | toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 40 | toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 40 | toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 40 | toBe | rgb(43, 38, 32) | rgb(94, 86, 77) | — | user-menu 外观 seg: hover steps the ink, click switches the theme |
| segmented-controls.spec.ts | 40 | toBe | rgb(236, 231, 223) | rgb(197, 192, 185) | — | branch-dialog seg: hover steps the Git ink, click swaps the tab body |
| segmented-controls.spec.ts | 41 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | page-tab: unselected hover steps the chip ink — dark + light |
| segmented-controls.spec.ts | 41 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 41 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | files seg + tasks view toggle: hover steps the unselected ink (dark) |
| segmented-controls.spec.ts | 41 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | user-menu 外观 seg: hover steps the ink, click switches the theme |
| segmented-controls.spec.ts | 41 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | branch-dialog seg: hover steps the Git ink, click swaps the tab body |
| segmented-controls.spec.ts | 69 | toBe | rgb(47, 42, 38) | rgb(47, 42, 38) | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 72 | toBe | rgb(47, 42, 38) | rgb(47, 42, 38) | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 86 | toBe | 6px | 6px | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 96 | toEqual | {"x":436,"y":24,"width":51,"height":28} | {"x":436,"y":24,"width":51,"height":28} | — | page-tab: selected chip keeps its fill under hover, same geometry as the rest state |
| segmented-controls.spec.ts | 115 | toBe | 0px | 0px | — | page-tab group rides the segmented track (canvas, 32px, 2px inset) |
| segmented-controls.spec.ts | 116 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | page-tab group rides the segmented track (canvas, 32px, 2px inset) |
| segmented-controls.spec.ts | 117 | toBe | 32 | 32 | — | page-tab group rides the segmented track (canvas, 32px, 2px inset) |
| segmented-controls.spec.ts | 118 | toBe | 2 | 2 | — | page-tab group rides the segmented track (canvas, 32px, 2px inset) |
| segmented-controls.spec.ts | 119 | toBe | 2 | 2 | — | page-tab group rides the segmented track (canvas, 32px, 2px inset) |
| segmented-controls.spec.ts | 143 | toBe | rgb(47, 42, 38) | rgb(47, 42, 38) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 144 | not.toBe | rgb(47, 42, 38) | rgb(26, 22, 18) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 149 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | sched freq: the chosen radio reads against the track, hover steps the rest ink |
| segmented-controls.spec.ts | 206 | toBe | 0px | 0px | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 207 | toBe | rgb(243, 238, 229) | rgb(243, 238, 229) | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 209 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 210 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 211 | toBe | 28 | 28 | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 214 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 216 | toBe | rgba(0, 0, 0, 0) | 28 | — | team layout toggle: segmented face (paper track, white ringed chip) |
| segmented-controls.spec.ts | 226 | not.toBe | rgb(94, 86, 77) | {"__fn":"() => ink(charter)"} | — | chief tabs: hover steps the ink, click swaps the view |
| segmented-controls.spec.ts | 227 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | chief tabs: hover steps the ink, click swaps the view |
| segmented-controls.spec.ts | 254 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 255 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 256 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 257 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 261 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 267 | toEqual | {"pillZ":"0","pillPe":"none","tabZ":"1"} | {"pillZ":"0","pillPe":"none","tabZ":"1"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 305 | toEqual | ["left","width"] | {"__fn":"() => page.evaluate(() => [...new Set(window.__pillRuns)].sort())"} | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| segmented-controls.spec.ts | 318 | toBeLessThanOrEqual | ≤ 1 | {"__fn":"async () => {\n    const [p, c] = await Promise.all([box(pill), box(charter)]);\n    return Math.max(… | — | chief tabs: indicator pill slides between chips — 150ms ease on left/top/width/height |
| shadcn-primitives.spec.ts | 69 | not.toBe | contents | flex | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 72 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 73 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 74 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 75 | toBe | 24 | 24 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 77 | toBe | 52 | 52 | — | avatar 落点定尺盒（#983/#1003）：Root 生成真盒承上游发丝环，img 几何不变 |
| shadcn-primitives.spec.ts | 110 | toBeCloseTo | 20 ±0.005 | 20 | — | tag-chip 落点：落在 registry Badge 上，几何单档 20px 正本 |
| shell-consistency.spec.ts | 47 | toEqual | {"x":0,"y":0,"width":248,"height":732} | {"x":0,"y":0,"width":248,"height":732} | — | expanded sidebar keeps identical geometry across /app ↔ /app/team ↔ resources hops |
| shell-consistency.spec.ts | 47 | toEqual | {"x":0,"y":0,"width":40,"height":732} | {"x":0,"y":0,"width":40,"height":732} | — | collapsed rail survives route hops (storage-backed on every shell) |
| shell-consistency.spec.ts | 169 | toEqual | {"iconX":20,"nameX":12,"toggleX":208} | {"__fn":"() => headContentX(page)"} | — | the brand head holds its inner geometry across the /app → /app/team hop |
| shell-consistency.spec.ts | 201 | toBe | 1 | {"__fn":"() => page.evaluate(k => localStorage.getItem(k), SIDEBAR_KEY)"} | — | the collapse toggle works off-board and the state rides back |
| shell-consistency.spec.ts | 224 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | no storage + system light boots light |
| shell-consistency.spec.ts | 230 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | no storage + system dark boots dark |
| shell-consistency.spec.ts | 237 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | a stored theme beats the system scheme |
| sidebar-nav.spec.ts | 122 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | hover tints the row — dark default + light theme |
| sidebar-nav.spec.ts | 126 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | hover tints the row — dark default + light theme |
| sidebar-nav.spec.ts | 133 | toBe | rgb(235, 228, 216) | {"__fn":"() => pillBg(lightRow)"} | — | hover tints the row — dark default + light theme |
| sidebar-nav.spec.ts | 141 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | rail hover tints the row |
| sidebar-nav.spec.ts | 143 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | rail hover tints the row |
| sidebar-nav.spec.ts | 157 | toBe | rgb(36, 32, 27) | rgb(36, 32, 27) | — | selected row keeps its sheet fill under hover |
| sidebar-seam.spec.ts | 54 | toBe | 0px | 0px | — | board expanded: no seam, no internal divider (light) |
| sidebar-seam.spec.ts | 54 | toBe | 0px | 0px | — | board expanded: no seam, no internal divider (dark) |
| sidebar-seam.spec.ts | 55 | toBe | none | none | — | board expanded: no seam, no internal divider (light) |
| sidebar-seam.spec.ts | 55 | toBe | none | none | — | board expanded: no seam, no internal divider (dark) |
| sidebar-seam.spec.ts | 56 | toBe | 248 | 248 | — | board expanded: no seam, no internal divider (light) |
| sidebar-seam.spec.ts | 56 | toBe | 248 | 248 | — | board expanded: no seam, no internal divider (dark) |
| sidebar-seam.spec.ts | 57 | toBe | 0px | 0px | — | board expanded: no seam, no internal divider (light) |
| sidebar-seam.spec.ts | 57 | toBe | 0px | 0px | — | board expanded: no seam, no internal divider (dark) |
| sidebar-seam.spec.ts | 59 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | board expanded: no seam, no internal divider (light) |
| sidebar-seam.spec.ts | 59 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | board expanded: no seam, no internal divider (dark) |
| sidebar-seam.spec.ts | 71 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | team page: the active workspace row keeps the board geometry (light) |
| sidebar-seam.spec.ts | 71 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | team page: the active workspace row keeps the board geometry (dark) |
| sidebar-seam.spec.ts | 91 | toBe | 0px | 0px | — | rail: no seam either (light) |
| sidebar-seam.spec.ts | 91 | toBe | 0px | 0px | — | rail: no seam either (dark) |
| sidebar-seam.spec.ts | 92 | toBe | none | none | — | rail: no seam either (light) |
| sidebar-seam.spec.ts | 92 | toBe | none | none | — | rail: no seam either (dark) |
| sidebar-seam.spec.ts | 93 | toBe | 40 | 40 | — | rail: no seam either (light) |
| sidebar-seam.spec.ts | 93 | toBe | 40 | 40 | — | rail: no seam either (dark) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | pages shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | resources shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | detail shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | pages shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | resources shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 110 | toBe | 0px | 0px | — | detail shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | pages shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | resources shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | detail shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | pages shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | resources shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 111 | toBe | none | none | — | detail shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | pages shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | resources shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | detail shell: no seam, same workspace row (light) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | pages shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | resources shell: no seam, same workspace row (dark) |
| sidebar-seam.spec.ts | 112 | toEqual | {"x":12,"y":12,"w":224,"h":40} | {"x":12,"y":12,"w":224,"h":40} | — | detail shell: no seam, same workspace row (dark) |
| sidebar-visual.spec.ts | 81 | toEqual | {"x":12,"w":224,"h":32,"radius":"8px"} | {"x":12,"w":224,"h":32,"radius":"8px"} | — | hover and selected rows share one geometry (light) |
| sidebar-visual.spec.ts | 81 | toEqual | {"x":12,"w":224,"h":32,"radius":"8px"} | {"x":12,"w":224,"h":32,"radius":"8px"} | — | hover and selected rows share one geometry (dark) |
| sidebar-visual.spec.ts | 83 | toEqual | {"x":12,"w":224,"h":32,"radius":"8px"} | {"x":12,"w":224,"h":32,"radius":"8px"} | — | hover and selected rows share one geometry (light) |
| sidebar-visual.spec.ts | 83 | toEqual | {"x":12,"w":224,"h":32,"radius":"8px"} | {"x":12,"w":224,"h":32,"radius":"8px"} | — | hover and selected rows share one geometry (dark) |
| sidebar-visual.spec.ts | 104 | toBe | rgb(235, 228, 216) | rgb(235, 228, 216) | — | selected row = sheet fill + hairline, distinct from hover (light) |
| sidebar-visual.spec.ts | 104 | toBe | rgba(255, 252, 248, 0.05) | rgba(255, 252, 248, 0.05) | — | selected row = sheet fill + hairline, distinct from hover (dark) |
| sidebar-visual.spec.ts | 106 | toBeGreaterThan | > 3 | 31 | — | selected row = sheet fill + hairline, distinct from hover (light) |
| sidebar-visual.spec.ts | 106 | toBeGreaterThan | > 3 | 34.45 | — | selected row = sheet fill + hairline, distinct from hover (dark) |
| sidebar-visual.spec.ts | 107 | toBe | rgb(251, 249, 245) | rgb(251, 249, 245) | — | selected row = sheet fill + hairline, distinct from hover (light) |
| sidebar-visual.spec.ts | 107 | toBe | rgb(36, 32, 27) | rgb(36, 32, 27) | — | selected row = sheet fill + hairline, distinct from hover (dark) |
| sidebar-visual.spec.ts | 108 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(236,… | — | selected row = sheet fill + hairline, distinct from hover (light) |
| sidebar-visual.spec.ts | 108 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(62, … | — | selected row = sheet fill + hairline, distinct from hover (dark) |
| sidebar-visual.spec.ts | 109 | not.toBe | rgb(235, 228, 216) | rgb(251, 249, 245) | — | selected row = sheet fill + hairline, distinct from hover (light) |
| sidebar-visual.spec.ts | 109 | not.toBe | rgba(255, 252, 248, 0.05) | rgb(36, 32, 27) | — | selected row = sheet fill + hairline, distinct from hover (dark) |
| sidebar-visual.spec.ts | 132 | toBeLessThan | < 2 | 0 | — | machine-online dot sits centered on the 机器 row |
| skill-import.spec.ts | 119 | toEqual | {"localPath":"/Users/you/skills/deploy-to-prod"} | {"localPath":"/Users/you/skills/deploy-to-prod"} | — | live 导入：201 后弹窗关、列表即现，请求体 = 所填单字段逐字 |
| skills-page.spec.ts | 86 | toBeGreaterThan | > 0 | 1 | — | live 列表消费 GET /api/skills（server 换源后 wire 形状不变） |
| skills-page.spec.ts | 144 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 151 | toBeCloseTo | 1430 ±0.5 | 1430 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 152 | toBeGreaterThan | > 768 | 1182 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 161 | toBeGreaterThanOrEqual | ≥ 0 | 670 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 162 | toBeLessThanOrEqual | ≤ 733 | 722 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 165 | toBe | 768 | 768 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 168 | toBe | 10 | 10 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 169 | toBe | 56 | 56 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-page.spec.ts | 170 | toBe | 0 | 0 | — | 回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘 |
| skills-write.spec.ts | 231 | toBeGreaterThanOrEqual | ≥ 2 | 2 | — | live 编辑预填读 404：表单让位错误块，列表失效重取 |
| spec-brief-card.spec.ts | 126 | toBe | 160px | 160px | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 128 | toBe | 100% | 100% | — | 3. 图片附件受缩略约束——不再以原尺寸裸图撑破页面 |
| spec-brief-card.spec.ts | 147 | toBe | 1px | 1px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 151 | toBe | 10px | 10px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 153 | toBe | rgb(60, 55, 50) | rgb(60, 55, 50) | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 154 | toBe | rgb(62, 58, 52) | rgb(62, 58, 52) | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 155 | toBe | 14px | 14px | — | 4. 简报卡配方 = 带框内容盒（1px 边线 / rounded-lg / surface-secondary 底） |
| spec-brief-card.spec.ts | 173 | toBeLessThanOrEqual | ≤ 2 | 0.04399999999998272 | — | 4b. 宽屏下行宽吃 68ch cap（#470 的 60–75 字符带同律） |
| spec-brief-card.spec.ts | 211 | toBe | baseline | baseline | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 212 | not.toBe | rgb(236, 231, 223) | rgb(172, 167, 160) | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 213 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-brief-card.spec.ts | 217 | toBeLessThanOrEqual | ≤ 1 | 0 | — | 6. 有序列表序号与正文区分、与首行基线对齐、双位数不 jog 内容列 (#814 rework) |
| spec-flow.spec.ts | 127 | toBeLessThan | < 66 | -922 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 131 | toBeGreaterThanOrEqual | ≥ 65 | 102 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 132 | toBeGreaterThan | > 200 | 1024 | — | 2. 简报卡随流滚走：滚到底出视口，滚到顶回列首 |
| spec-flow.spec.ts | 142 | toBe | 694 | 694 | — | 3. 超长无断点行包进中栏：chat 横向 scrollWidth 等于 clientWidth |
| spinner-live.spec.ts | 76 | toEqual | ["0deg","60deg","120deg"] | ["0deg","60deg","120deg"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 1800ms spin |
| spinner-live.spec.ts | 88 | toBe | 1800 | 1800 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 1800ms spin |
| spinner-live.spec.ts | 96 | toBe | 3600 | 3600 | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 1800ms spin |
| spinner-live.spec.ts | 101 | toEqual | ["-1.8s","-1.2s","-0.6s"] | ["-1.8s","-1.2s","-0.6s"] | — | Atom mounts: stylesheet injected, shell + 3 tilted orbits, staggered 1800ms spin |
| spinner-live.spec.ts | 109 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 110 | toBe | 16px | 16px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 111 | toBe | relative | relative | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 126 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 127 | toBe | 16 | 16 | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 128 | toBe | 9999px | 9999px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 131 | toBe | 1px | 1px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 133 | toBe | 20px | 20px | — | root is a 16px square, shell a 16px circle, row keeps 20px |
| spinner-live.spec.ts | 149 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 151 | toBe | rgb(240, 146, 109) | rgb(240, 146, 109) | — | root is aria-hidden and shell/ring strokes ride currentColor; label stays the cue |
| spinner-live.spec.ts | 174 | toBe | 0 | 0 | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 176 | toBe | none | none | — | prefers-reduced-motion freezes the spins with the static settle transform |
| spinner-live.spec.ts | 177 | not.toBe | none | matrix(0.5, 0.866025, -0.866025, 0.5, 0, 0) | — | prefers-reduced-motion freezes the spins with the static settle transform |
| storage-unavailable.spec.ts | 91 | toBeGreaterThan | > 0 | 3 | — | sandboxed iframe without allow-same-origin renders /app (no white screen) |
| storage-unavailable.spec.ts | 92 | toBeGreaterThan | > 0 | 122 | — | sandboxed iframe without allow-same-origin renders /app (no white screen) |
| storage-unavailable.spec.ts | 96 | toEqual | [] | [] | — | sandboxed iframe without allow-same-origin renders /app (no white screen) |
| storage-unavailable.spec.ts | 114 | toEqual | [] | [] | — | sandboxed boot survives a persistence interaction (writes silently dropped) |
| team-chart-single.spec.ts | 27 | toBe | 44 | 44 | — | chart 组织图：单个子节点直连，无括号，连接线对齐子卡中心 |
| team-chart-single.spec.ts | 28 | toBe | 1 | 1 | — | chart 组织图：单个子节点直连，无括号，连接线对齐子卡中心 |
| team-chart-single.spec.ts | 29 | toBe | 719 | 719 | — | chart 组织图：单个子节点直连，无括号，连接线对齐子卡中心 |
| team-chart-single.spec.ts | 30 | toBeLessThanOrEqual | ≤ 1 | 0 | — | chart 组织图：单个子节点直连，无括号，连接线对齐子卡中心 |
| team-org-chart.spec.ts | 63 | toEqual | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | ["claude-sonnet-5 · 默认","qwen3.8-max","glm-5.3-flash"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 69 | toEqual | ["r3-builder","r5-scribe","r9-scout"] | ["r3-builder","r5-scribe","r9-scout"] | — | chart 组织图：每个节点带服务商徽标与模型行 |
| team-org-chart.spec.ts | 88 | toBe | 10px | 10px | — | chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏 |
| team-org-chart.spec.ts | 89 | toBe | rgb(255, 255, 255) | rgb(255, 255, 255) | — | chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏 |
| team-org-chart.spec.ts | 90 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏 |
| team-org-chart.spec.ts | 91 | toBe | 56 | 56 | — | chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏 |
| team-org-chart.spec.ts | 92 | toBe | 220 | 220 | — | chart 组织图：节点是 Paper 卡，创建 Agent 只在顶栏 |
| team-org-chart.spec.ts | 104 | toBe | 44 | 44 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 105 | toBe | 1 | 1 | — | chart 组织图：根与子列之间有 44×1 横向连接线 |
| team-org-chart.spec.ts | 122 | toBe | 28 | 28 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 123 | toBe | 110 | 110 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
| team-org-chart.spec.ts | 124 | toBe | 174 | 174 | — | chart 组织图：子列左缘括号连接件跨首末子节点中心 |
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
| thinking-row-truncate.spec.ts | 182 | toBe | 12 | 12 | — | T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上） |
| thinking-row-truncate.spec.ts | 184 | toBe | 20 | 20 | — | T1: 行是 flex，头像与文字列水平不重叠（改前：头像压在文字上） |
| thinking-row-truncate.spec.ts | 196 | not.toBe | none | 600.578px | — | T2: chat-text 有宽度上限与 min-w-0——robot 行 :419 同款工具类 |
| thinking-row-truncate.spec.ts | 197 | toBe | 0px | 0px | — | T2: chat-text 有宽度上限与 min-w-0——robot 行 :419 同款工具类 |
| thinking-row-truncate.spec.ts | 220 | toBeLessThan | < 187 | 151 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 222 | toBe | ellipsis | ellipsis | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 223 | toBe | hidden | hidden | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 224 | toBeGreaterThan | > 583 | 1811 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 225 | toBeLessThanOrEqual | ≤ 601 | 601 | — | T3: 长预览真截断——字符切片之后 CSS 省略号接力，钮宽 ≤ 文字列宽 |
| thinking-row-truncate.spec.ts | 234 | toBeLessThanOrEqual | ≤ 0 | 0 | — | T4: 页面级零横向溢出；展开交互不被截断修法砸掉 |
| title-band-clicks.spec.ts | 49 | toBeGreaterThan | > 0 | 1 | — | team right-slot action owns its hit area (设置 in the top bar) |
| token-gate.spec.ts | 215 | toBe | 200 | 200 | — | 鉴权关：零门页零 token 附带，行为与现状一致 |
| transcript-user-words.spec.ts | 240 | toBe | 24 | 24 | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| transcript-user-words.spec.ts | 241 | toBe | 14px | 14px | — | 5. 单段短消息气泡保持 24px 药丸高度（几何不漂移） |
| user-menu-trigger.spec.ts | 94 | toBe | 12 | 12 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 94 | toBe | 4 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 94 | toBe | 12 | 12 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 94 | toBe | 12 | 12 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 95 | toBe | 224 | 224 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 95 | toBe | 224 | 224 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 95 | toBe | 224 | 224 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 95 | toBe | 224 | 224 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 97 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 97 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 97 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 97 | toBeGreaterThanOrEqual | ≥ 3 | 4 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 98 | toBeLessThanOrEqual | ≤ 5 | 4 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 98 | toBeLessThanOrEqual | ≤ 5 | 4 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 98 | toBeLessThanOrEqual | ≤ 5 | 4 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 98 | toBeLessThanOrEqual | ≤ 5 | 4 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 100 | toBeGreaterThan | > 0 | 18 | — | expanded chip: click opens anchored above the chip, re-click closes |
| user-menu-trigger.spec.ts | 100 | toBeGreaterThan | > 0 | 10 | — | rail chip opens the same popover, unclipped by the 40px rail |
| user-menu-trigger.spec.ts | 100 | toBeGreaterThan | > 0 | 18 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 100 | toBeGreaterThan | > 0 | 18 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 178 | toBeLessThanOrEqual | ≤ 1 | 0 | — | #163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes |
| user-menu-trigger.spec.ts | 256 | toBeLessThanOrEqual | ≤ 1 | 0 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 258 | not.toContain | 1px | 0 0 0 calc(0px + 0px) currentcolor | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 259 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 260 | not.toBe | rgba(0, 0, 0, 0) | rgb(55, 50, 45) | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 262 | toBe | none | none | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 263 | toBe | top | top | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 264 | toBeGreaterThanOrEqual | ≥ 0 | 449 | — | #1245 floating menu is a single skin and stays inside the viewport |
| user-menu-trigger.spec.ts | 265 | toBeLessThanOrEqual | ≤ 732 | 666 | — | #1245 floating menu is a single skin and stays inside the viewport |
| visual-polish.spec.ts | 96 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 96 | toBe | 0px | 0px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 97 | toBe | 10px | 10px | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 97 | toBe | 10px | 10px | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 98 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 98 | toContain | 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 99 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 99 | not.toContain | inset | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 100 | toContain | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px, rgb(236, 229, 218) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 100 | toContain | rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px, rgb(62, 58, 52) 0px 0px 0px 1px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, oklab(0.… | — | board card rides the single-source edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 112 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 112 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 113 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 113 | toBe | 0px | 0px | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 114 | toBe | none | none | — | board column container rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 114 | toBe | none | none | — | board column container rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 128 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 128 | toBe | 0px | 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 129 | toBe | 18px | 18px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 129 | toBe | 18px | 18px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 132 | toContain | rgba(80, 60, 30, 0.04) 0px 1px 2px 0px | rgb(236, 229, 218) 0px 0px 0px 1px inset, rgba(80, 60, 30, 0.04) 0px 1px 2px 0px | — | notify banner rides the same edge ring + card-tier shadow (light) |
| visual-polish.spec.ts | 132 | toContain | rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px | rgb(62, 58, 52) 0px 0px 0px 1px inset, rgba(0, 0, 0, 0.4) 0px 1px 2px 0px, rgba(0, 0, 0, 0.4) 0px 2px 8px 0px | — | notify banner rides the same edge ring + card-tier shadow (dark) |
| visual-polish.spec.ts | 145 | toBe | 0px | 0px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 145 | toBe | 0px | 0px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 146 | toBe | 10px | 10px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 146 | toBe | 10px | 10px | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 147 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 147 | not.toBe | none | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 148 | toContain | 0px 0px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (light) |
| visual-polish.spec.ts | 148 | toContain | 0px 0px 0px | rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgba(0, … | — | account popover rides the V2 shell border, keeps the overlay-plate hard shadow (dark) |
| visual-polish.spec.ts | 173 | not.toBe | rgb(251, 249, 245) | rgb(243, 238, 229) | — | sidebar sits on canvas beside the sheet, no seam of its own (light) |
| visual-polish.spec.ts | 173 | not.toBe | rgb(36, 32, 27) | rgb(26, 22, 18) | — | sidebar sits on canvas beside the sheet, no seam of its own (dark) |
| visual-polish.spec.ts | 174 | toBe | 0px | 0px | — | sidebar sits on canvas beside the sheet, no seam of its own (light) |
| visual-polish.spec.ts | 174 | toBe | 0px | 0px | — | sidebar sits on canvas beside the sheet, no seam of its own (dark) |
| visual-polish.spec.ts | 175 | toBe | none | none | — | sidebar sits on canvas beside the sheet, no seam of its own (light) |
| visual-polish.spec.ts | 175 | toBe | none | none | — | sidebar sits on canvas beside the sheet, no seam of its own (dark) |
| visual-polish.spec.ts | 199 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 199 | toBe | auto | auto | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 200 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 200 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 204 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 204 | toBe | 0 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 212 | toBeGreaterThan | > 0 | 276.5 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 212 | toBeGreaterThan | > 0 | 276.5 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 213 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (light) |
| visual-polish.spec.ts | 213 | toBeLessThanOrEqual | ≤ 1 | 0 | — | board grid lays out four even columns with no horizontal scroll (dark) |
| visual-polish.spec.ts | 228 | toBe | 0px | 0px | — | collapsed rail draws no seam either (Paper PR 7) |
| visual-polish.spec.ts | 229 | toBe | none | none | — | collapsed rail draws no seam either (Paper PR 7) |
| z-ladder.spec.ts | 64 | toEqual | ["true","true","true","true","true"] | ["true","true","true","true","true"] | — | every probe point of the new-task panel hit-tests inside the panel |

```
