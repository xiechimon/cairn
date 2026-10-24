---
类别: 派活前没查重：派 #1569、#1578 给 codex/pi 时，同机另一个 Claude 会话已在 /tmp/pm-1569-*、/tmp/pm-1578-* 做同票，#1569 白做一版
首次来源: #1569/#1578 (2026-10-24)
级别: 2
防护: `scripts/dispatch-agent.mjs start --ticket <N>` 查系统 tmp 目录下的 git 工作目录、origin 分支、open PR、codex/pi/grok 进程，命中即拒绝启动，`--force` 才放行；纯函数 `scripts/dispatch-dedupe.mjs` 由 `scripts/dispatch-dedupe.test.mjs`（CI dispatch-agent-test job）钉住数字边界、排除自身、gh 不可用
拦截: 0
复发: 0
备注: 负对照：对 1569 跑 `start --ticket 1569` 命中 /tmp/pm-1569-*（分支 obs/1569-langfuse-selfhost）并以退出码 1 拒绝；不带 `--ticket` 仍不查，靠派活提示 `docs/agent-dispatch-prompts.md` 要求带上
---
