---
类别: 后台长任务用 `( ... & )` 或 nohup 起，工具调用一返回就被杀，随后还告诉 ian 任务在跑
首次来源: Claude 线程 (2026-10-22)
级别: 2
防护: `scripts/dispatch-agent.mjs` start 脱离进程组启动并立即核对进程写状态文件，汇报前 `check` 读状态文件；负对照在 `scripts/dispatch-agent.test.mjs`（CI 独立 job）：旧写法直起的任务 check 报进程不存在
拦截: 0
复发: 1
备注: 复发 1（先 pi，后 codex）后由 #1556 升级到级别 2
---
