---
类别: 云端容器的 Playwright 缺 `chromium_headless_shell-1243`，integration 的浏览器用例在 pre-push 全红，看着像代码坏了
首次来源: Claude 线程 (2026-10-23)
级别: 2
防护: `#1395` 的 SessionStart 钩子（`.claude/hooks/session-start.sh`）在云端容器把缺失的浏览器修订自动软链到预装版
拦截: 0
复发: 0
备注: 原备注称钩子自动化属未完成，实际 #1395（2026-10-20）早已落地，随 #1630 修正并升到级别 2；旧版 chromium 上视觉断言以 CI 为准这半边属判断错误，机器检查做不到
---
