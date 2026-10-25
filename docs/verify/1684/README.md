# #1684 verify evidence — 窄屏（360/390px）走查修复

走查与修复均在 fixture 构建面上完成（`vite build --mode fixture` +
`vite preview`），before 截自 HEAD 源码的独立构建（端口 8402），after 截自
工作树构建（端口 8401）。断点统一 ≤640px（`app-sidebar.tsx` 的
`NARROW_QUERY` 与 `styles/app.css` 的 `@media (max-width: 640px)` 块）——
不取 767 是因为 paper-topbar.spec 把 680px 当窄桌面宽度钉完整顶栏，第一轮
全量 e2e 实测撞红后收窄（docs/lessons.md 同轮台账行）。

## 问题清单（走查实测，before-*.png）

- **P1 侧栏吃掉大半视口**：390px 下展开态侧栏 248px，看板顶栏动作
  （筛选/定时/新任务，x=350~583）整段被 sheet 的 overflow-hidden 裁出视口，
  触达不到。纸页一族同病（帐号页内容列被挤到 x=894）。
- **P2 阅读列裁切**：PageShell 的 768px 阅读列（`w-192`）无窄屏夹取，
  在 ~300px 的可用宽里被横向裁掉大半。
- **P3 搜索面板左缘出屏**：520px 定宽 + `-ml-65` 居中，360 视口下
  x=-80（before-search-360.png），输入框够不到。
- **P4 触控区低于 44px**：总管 FAB 40px、详情头按钮 28px、composer
  工具/发送 30/32px、侧栏 rail 行 32px。
- **P5 底部安全区缺失**：`index.html` viewport meta 无
  `viewport-fit=cover`，FAB/悬浮窗贴 8px 底缘，`env(safe-area-inset-*)`
  永远为 0。

弹层面（AI 审核对话框、合并对话框、新建任务对话框、总管悬浮窗）实测已
有 `max-w-[calc(100dvw-1rem)]` 夹取，360 下不出屏可关——新 spec 的
M6/M7 是防回归钉。

## 修复（after-*.png，浅/深 × 360/390）

- 侧栏 ≤640px 强制 rail（`useSyncExternalStore` + matchMedia，不写回持久态）；
  rail 轨宽 48px、行 44px。
- 看板顶栏窄屏隐藏工作台标题与 定时 入口（rail 已覆盖导航），动作钮
  min-height 44px。
- PageShell 阅读列 `w-192 max-w-full`。
- 搜索面板 `-ml-65` 改 `-translate-x-1/2` + `max-w-[calc(100vw-2rem)]`
  （1440 下几何逐值不变）。
- 详情头 / 纸页顶栏 / composer 工具·发送·停止 / 线程复制钮窄屏 ≥44px。
- FAB 44px；FAB 与总管窗 right/bottom 走
  `max(0.5rem, env(safe-area-inset-*))`。

## 录屏（walkthrough-390.webm）

390px 触屏走查：看板列横滚 → 任务详情（相位 chip 弹层开/关）→ 合并
对话框开/关 → ⌘K 搜索开/关 → 总管 FAB 开窗/最小化 → 帐号页滚动。

## e2e

`apps/web/e2e/mobile-narrow.spec.ts`：M1 看板 rail + 顶栏动作留在视口内、
M2 纸页阅读列不裁切、M3 详情触控区 ≥44px、M4 总管 FAB/悬浮窗、M5 搜索
面板在视口内可关、M6 AI 审核对话框、M7 合并对话框——360 与 390 两档
参数化，修复前 M1–M5 共 10 条红、修复后 14 条全绿。已登记
`scripts/e2e-affected.mjs` 家族表（BOARD/SIDEBAR/DETAIL/CHIEF/OVERLAYS/
PAGES 六族）。
