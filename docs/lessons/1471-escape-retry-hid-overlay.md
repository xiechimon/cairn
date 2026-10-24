---
类别: 删掉 e2e 按键重试循环后，hotkeys 一条用例单按 Escape 只关掉悬停提示层、对话框仍开；重试曾把这个叠层问题盖住
首次来源: #1471 (2026-10-24)
级别: 2
防护: `pressAndExpect` 只按一次并断言目标，叠层问题当场红；该用例改为先 Escape 关提示层再 Escape 关对话框；`apps/web/e2e/hotkeys-ready.spec.ts` 钉按键在 load 事件时即生效
拦截: 1
复发: 0
备注: 负对照：撤掉修复该用例 5 次全红，修复后 10 次全绿；composer-inline-mention 的 data-fresh 用例在未改源码的同负载下同样偶发红，与本票无关
---
