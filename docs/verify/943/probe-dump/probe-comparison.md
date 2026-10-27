```
# Probe dump — old baseline → new measured (#921)

Run 2026-10-05T19:48:23.130Z · commit `ec0d1fb8` · port 8397 · playwright 1.63.0 · workers 4

Specs: board-dnd board-dnd-live board-docked-reflow board-filter board-overflow card-press sidebar-nav sidebar-seam sidebar-search-offboard sidebar-visual shell-consistency user-menu-nav user-menu-trigger hotkeys notify-banner chief-fab theme-toggle footer-copy (18 files) · tests 163 passed / 0 failed

## Coverage

Enumerated = static scan of spec source. Collected = distinct runtime call sites that returned a value (polls/themed loops record repeatedly; distinct de-dupes by file:line).

| probe surface | enumerated | collected |
| --- | --- | --- |
| getComputedStyle occurrences (headline count) | 34 | — (captured per evaluate call below) |
| probe-carrying evaluate/waitForFunction call sites | 34 | 34 |
| .boundingBox() call sites | 42 | 42 |
| .toHaveCSS() call sites | 5 | 5 |
| visual-matcher assertion sites | 195 | 269 joined |

Comparison rows: 224 — KEPT 224, DRIFT 0, NOT-RUN 0, VIOLATION 0, other 0.

Review procedure (#910 裁定 5): every DRIFT row is either expected drift (the new canon — re-pin the spec inline value to “new measured”) or a suspected regression (fix the code, keep the baseline). KEPT rows need no action. NOT-RUN rows are assertion sites whose test failed earlier, was skipped, or was filtered out. The `note` column flags values whose source notation is not rgb/hex: `color(srgb …)` is folded to rgba for comparison (re-pin should write the rgb/hex form); oklch/lab/lch and non-sRGB `color()` cannot fold under the #411 contract and are flagged VIOLATION, never converted.

## KEPT — baseline holds on this build (224)

| spec | line | matcher | old baseline | new measured | note | test |
| --- | --- | --- | --- | --- | --- | --- |
| board-dnd-live.spec.ts | 139 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 153 | toBeGreaterThanOrEqual | ≥ 0 | 1 | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 155 | toEqual | [] | [] | — | live: done(有变更)→待处理 fires PATCH phase=review, optimistic landing never flashes back |
| board-dnd-live.spec.ts | 189 | toBeGreaterThanOrEqual | ≥ 1 | 1 | — | live: PATCH 409 = 乐观值作废，卡片弹回源列 + toast 点名失败（#638） |
| board-dnd.spec.ts | 355 | toEqual | ["r3-legacy-1","r3-legacy-2"] | ["r3-legacy-1","r3-legacy-2"] | — | 已完成(有变更) → 待处理: reopen commits review, lands after the pinned group |
| board-dnd.spec.ts | 496 | toEqual | [] | [] | — | 重置闸·取消：零提交（卡片不动、计数不动、无请求发出）(#755) |
| board-dnd.spec.ts | 539 | toBe | 0.4 | 0.4 | — | cards from every column arm the drag gesture (#753) |
| board-dnd.spec.ts | 591 | toEqual | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | [{"id":"7ve0iOkQ-JBpSL98zSiGc","x":265,"y":95},{"id":"r3-legacy-1","x":855,"y":95},{"id":"r3-legacy-2","x":115… | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 596 | toBe | 0 | 0 | — | same-column gesture: siblings never shift, drop is a no-op |
| board-dnd.spec.ts | 647 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 647 | toBe | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | rgba(0, 0, 0, 0.18) 0px 8px 24px 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 648 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 648 | toBe | 2deg | 2deg | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 649 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 649 | toBe | 0.92 | 0.92 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 650 | toBe | 0px | 0px | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 650 | toBe | 0px | 0px | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 664 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 664 | toBeLessThanOrEqual | ≤ 1 | 0 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 670 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (light) |
| board-dnd.spec.ts | 670 | toBe | 0.4 | 0.4 | — | lifted card rides the compact drag-tier recipe (dark) |
| board-dnd.spec.ts | 714 | toBe | rgba(127, 45, 167, 0.1) | rgba(127, 45, 167, 0.1) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 714 | toBe | rgba(216, 156, 252, 0.1) | rgba(216, 156, 252, 0.1) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 715 | toBe | rgb(127, 45, 167) | rgb(127, 45, 167) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 715 | toBe | rgb(216, 156, 252) | rgb(216, 156, 252) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 716 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 716 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 720 | toBe | rgba(127, 45, 167, 0.05) | rgba(127, 45, 167, 0.05) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 720 | toBe | rgba(216, 156, 252, 0.05) | rgba(216, 156, 252, 0.05) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 721 | toBe | rgb(127, 45, 167) | rgb(127, 45, 167) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 721 | toBe | rgb(216, 156, 252) | rgb(216, 156, 252) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 727 | not.toBe | rgba(127, 45, 167, 0.05) | rgb(244, 239, 231) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 727 | not.toBe | rgba(216, 156, 252, 0.05) | rgb(30, 27, 22) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 728 | not.toBe | rgba(127, 45, 167, 0.05) | rgb(244, 239, 231) | — | valid targets tint base tier, hovered column tints hot (light) |
| board-dnd.spec.ts | 728 | not.toBe | rgba(216, 156, 252, 0.05) | rgb(30, 27, 22) | — | valid targets tint base tier, hovered column tints hot (dark) |
| board-dnd.spec.ts | 770 | toEqual | [] | [] | — | committed drop never flashes the card back to the source column |
| board-docked-reflow.spec.ts | 75 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 78 | toBeGreaterThanOrEqual | ≥ 239 | 257 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 79 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 81 | toBeGreaterThan | > 782 | 1196 | — | docked columns hold the 280px floor and the first column is whole |
| board-docked-reflow.spec.ts | 96 | toBeGreaterThanOrEqual | ≥ 16 | 177 | — | the clipped next column peeks >=16px at the scroll edge |
| board-docked-reflow.spec.ts | 112 | toBeGreaterThan | > 0 | {"x":240,"y":44,"width":782,"height":688} | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 118 | toBeLessThanOrEqual | ≤ 1023 | 1005 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 119 | toBeGreaterThanOrEqual | ≥ 239 | 725 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 120 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | overflow is reachable: wheel scrolls and the last column lands whole |
| board-docked-reflow.spec.ts | 131 | toHaveCSS | scrollbar-width: auto | auto | — | overflow discloses itself: the scroller no longer hides its scrollbar |
| board-docked-reflow.spec.ts | 150 | toBeLessThanOrEqual | ≤ 2 | 1 | — | cards keep their resting width while docked |
| board-docked-reflow.spec.ts | 169 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 170 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 176 | toBeLessThanOrEqual | ≤ 1 | 0 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 182 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | worst-case data holds: long title wraps in-column, 120-count header fits, empty column survives |
| board-docked-reflow.spec.ts | 199 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 201 | toBeGreaterThanOrEqual | ≥ 239 | 257 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 205 | toBeLessThanOrEqual | ≤ 0 | 0 | — | narrowest usable viewport (1024) docked: floor holds and the page itself never scrolls |
| board-docked-reflow.spec.ts | 220 | toBeLessThanOrEqual | ≤ 1201 | 1183 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 221 | toBeGreaterThanOrEqual | ≥ 279 | 280 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 222 | toBeGreaterThan | > 609 | 903 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 223 | toBeGreaterThan | > 315 | 609 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 224 | toBeGreaterThan | > 21 | 315 | — | RTL mirror: the first column stays whole at the scroll-start edge |
| board-docked-reflow.spec.ts | 233 | toBeLessThanOrEqual | ≤ 1200 | 1200 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 236 | toBeGreaterThan | > 280 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 237 | toBeLessThan | < 282 | 281 | — | resting geometry at 1440 is untouched by the floor token |
| board-docked-reflow.spec.ts | 238 | toBeLessThanOrEqual | ≤ 1 | 0 | — | resting geometry at 1440 is untouched by the floor token |
| board-filter.spec.ts | 119 | toContain | rgba(0, 0, 0, 0) | ["rgba(0, 0, 0, 0)","transparent"] | — | 旧场景（无 projectNames）不渲染仓库面；右动作区恰好一钮 = 无底色类型钮；+任务 不存在 |
| board-filter.spec.ts | 494 | toHaveCSS | background-color: rgb(239, 68, 68) | rgb(239, 68, 68) | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 524 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 525 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 526 | toBe | 16 | 16 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 527 | toBe | 94.5 | 94.5 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
| board-filter.spec.ts | 529 | toBe | 26.5 | 26.5 | — | 任务卡渲染标签 chip：词表配色、无标签零占位、既有几何不漂移 |
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
| card-press.spec.ts | 56 | not.toBe | rgb(224, 219, 210) | rgb(239, 233, 225) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 56 | not.toBe | rgb(63, 60, 54) | rgb(37, 34, 29) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 60 | toHaveCSS | background-color: rgb(224, 219, 210) | rgb(224, 219, 210) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 60 | toHaveCSS | background-color: rgb(63, 60, 54) | rgb(63, 60, 54) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 65 | toBe | 1 | 1 | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 65 | toBe | 1 | 1 | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 74 | toHaveCSS | background-color: rgb(239, 233, 225) | rgb(239, 233, 225) | — | press tints the whole card one surface step (light) |
| card-press.spec.ts | 74 | toHaveCSS | background-color: rgb(37, 34, 29) | rgb(37, 34, 29) | — | press tints the whole card one surface step (dark) |
| card-press.spec.ts | 81 | toHaveCSS | user-select: none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 85 | toBe | none | none | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| card-press.spec.ts | 114 | toBe | 0 | 0 | — | card face is selection- and native-drag-locked (「小链接」绝迹) |
| chief-fab.spec.ts | 47 | toEqual | {"width":"48px","height":"48px","right":"504px","bottom":"104px"} | {"width":"48px","height":"48px","right":"504px","bottom":"104px"} | — | the gated FAB keeps the family geometry (48×48, pane offset, composer 让位) |
| chief-fab.spec.ts | 92 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 93 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 94 | toBeCloseTo | 1376 ±0.5 | 1376 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 95 | toBeCloseTo | 668 ±0.5 | 668 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 96 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| chief-fab.spec.ts | 97 | toBeCloseTo | 48 ±0.5 | 48 | — | bound: the board FAB swaps the glyph for the seeded avatar, badge and geometry stay |
| footer-copy.spec.ts | 27 | toBeGreaterThan | > 20 | 54 | — | C1: robot row copy puts the row text on the clipboard |
| notify-banner.spec.ts | 77 | toBe | 1 | 1 | — | 开启 → requestPermission() fires; granted hides the bar |
| notify-banner.spec.ts | 91 | toBe | 1 | 1 | — | 开启 → denied resolution also hides the bar |
| notify-banner.spec.ts | 100 | toBe | 0 | 0 | — | scenarios without the flag never render the strip |
| shell-consistency.spec.ts | 45 | toEqual | {"x":0,"y":0,"width":240,"height":732} | {"x":0,"y":0,"width":240,"height":732} | — | expanded sidebar keeps identical geometry across /app ↔ /app/team ↔ resources hops |
| shell-consistency.spec.ts | 45 | toEqual | {"x":0,"y":0,"width":40,"height":732} | {"x":0,"y":0,"width":40,"height":732} | — | collapsed rail survives route hops (storage-backed on every shell) |
| shell-consistency.spec.ts | 164 | toEqual | {"iconX":19,"nameX":46,"toggleX":197} | {"__fn":"() => headContentX(page)"} | — | the brand head holds its inner geometry across the /app → /app/team hop |
| shell-consistency.spec.ts | 193 | toBe | 1 | {"__fn":"() => page.evaluate(k => localStorage.getItem(k), SIDEBAR_KEY)"} | — | the collapse toggle works off-board and the state rides back |
| shell-consistency.spec.ts | 216 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | no storage + system light boots light |
| shell-consistency.spec.ts | 222 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | no storage + system dark boots dark |
| shell-consistency.spec.ts | 229 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | a stored theme beats the system scheme |
| sidebar-nav.spec.ts | 107 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 111 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 118 | toBe | rgba(28, 25, 20, 0.05) | {"__fn":"() => pillBg(lightRow)"} | — | hover tints the row pill — dark default + light theme |
| sidebar-nav.spec.ts | 126 | toBe | rgba(0, 0, 0, 0) | rgba(0, 0, 0, 0) | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 128 | toBe | rgba(255, 252, 248, 0.05) | {"__fn":"() => pillBg(row)"} | — | rail hover tints the 24px pill |
| sidebar-nav.spec.ts | 141 | toBe | rgba(255, 252, 248, 0.1) | rgba(255, 252, 248, 0.1) | — | selected row keeps its own pill under hover |
| sidebar-seam.spec.ts | 50 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 50 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 51 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 51 | toBe | solid | solid | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 52 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 52 | toBe | none | none | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 53 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 53 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 54 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 54 | toBe | 240 | 240 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 57 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 57 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 58 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 58 | toBe | 43 | 43 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 59 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 59 | toBe | 1px | 1px | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 60 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 60 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 61 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (light) |
| sidebar-seam.spec.ts | 61 | toBe | 44 | 44 | — | board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (dark) |
| sidebar-seam.spec.ts | 77 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (light) |
| sidebar-seam.spec.ts | 77 | toBe | 43 | 43 | — | team page: the r7 12 active pill geometry survives the divider row (dark) |
| sidebar-seam.spec.ts | 103 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 103 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 104 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 104 | toBe | none | none | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 105 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 105 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 106 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 106 | toBe | 40 | 40 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 108 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 108 | toBe | 44 | 44 | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 109 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (light) |
| sidebar-seam.spec.ts | 109 | toBe | 1px | 1px | — | rail: seam inherits, toggle divider aligns with the topbar border row (dark) |
| sidebar-seam.spec.ts | 128 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 128 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 129 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 129 | toBe | 43 | 43 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 130 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (light) |
| sidebar-seam.spec.ts | 130 | toBe | 44 | 44 | — | pages shell: the divider runs full width on schedules too (dark) |
| sidebar-seam.spec.ts | 150 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 150 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 151 | toBe | rgb(232, 227, 218) | rgb(232, 227, 218) | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 151 | toBe | rgb(45, 42, 36) | rgb(45, 42, 36) | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-seam.spec.ts | 152 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (light) |
| sidebar-seam.spec.ts | 152 | toBe | 43 | 43 | — | resources: the full-width line reads one color across the seam (dark) |
| sidebar-visual.spec.ts | 71 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 71 | toBe | absolute | absolute | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 73 | toBe | 1px | 1px | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 73 | toBe | 1px | 1px | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 75 | toBeGreaterThanOrEqual | ≥ 72 | 196.421875 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 75 | toBeGreaterThanOrEqual | ≥ 72 | 196.421875 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 76 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 76 | toBeGreaterThanOrEqual | ≥ 12 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 77 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 77 | toBeLessThanOrEqual | ≤ 22 | 18 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 79 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 79 | toBeGreaterThanOrEqual | ≥ 18 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 80 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (light) |
| sidebar-visual.spec.ts | 80 | toBeLessThanOrEqual | ≤ 22 | 20 | — | ⌘K chip is a bordered pill clear of the label (dark) |
| sidebar-visual.spec.ts | 115 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 115 | toEqual | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | {"top":"2px","bottom":"2px","left":"8px","right":"8px","radius":"0px"} | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 118 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 118 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 119 | toBe | 2px | 2px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 119 | toBe | 2px | 2px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 120 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 120 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 124 | toBe | 0px | 0px | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 124 | toBe | 0px | 0px | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 125 | toBe | 239 | 239 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 125 | toBe | 239 | 239 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 126 | toBe | 240 | 240 | — | hover and selected pills share one geometry (light) |
| sidebar-visual.spec.ts | 126 | toBe | 240 | 240 | — | hover and selected pills share one geometry (dark) |
| sidebar-visual.spec.ts | 153 | toBeGreaterThan | > 6 | 32.05000000000004 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 153 | toBeGreaterThan | > 6 | 33.8 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 155 | toBeGreaterThan | > 38.05000000000004 | 64.1 | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 155 | toBeGreaterThan | > 39.8 | 67.6 | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 165 | toBe | rgba(28, 25, 20, 0.1) | rgba(28, 25, 20, 0.1) | — | selected pill deepens the hover step (light) |
| sidebar-visual.spec.ts | 165 | toBe | rgba(255, 252, 248, 0.1) | rgba(255, 252, 248, 0.1) | — | selected pill deepens the hover step (dark) |
| sidebar-visual.spec.ts | 188 | toBe | absolute | absolute | — | machine-online dot keeps its absolute anchor |
| sidebar-visual.spec.ts | 189 | toBeLessThan | < 2 | 0 | — | machine-online dot keeps its absolute anchor |
| theme-toggle.spec.ts | 30 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 36 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | default dark: 深色 active; 浅色 click repaints instantly + persists |
| theme-toggle.spec.ts | 45 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 49 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | selection survives reload |
| theme-toggle.spec.ts | 55 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | selection survives reload |
| theme-toggle.spec.ts | 64 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | injected storage pins the initial segment (storage injection path) |
| theme-toggle.spec.ts | 72 | toEqual | {"theme":"dark","light":"false"} | {"theme":"dark","light":"false"} | — | clicking the active segment is a stable no-op |
| theme-toggle.spec.ts | 99 | toEqual | {"theme":"light","light":"true"} | {"theme":"light","light":"true"} | — | theme flip rides the transition suppression and drops it after the paint |
| theme-toggle.spec.ts | 125 | toEqual | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | [{"rel":"icon","href":"/logo.svg","media":"null"},{"rel":"icon","href":"/icon-192-dark.png","media":"(prefers-… | — | icon + apple-touch-icon carry prefers-color-scheme variants that resolve |
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

```
