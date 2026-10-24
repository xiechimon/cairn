# Agent 派活提示模板

将任务、范围和验收命令补在对应模板后；三家均遵循 AGENTS.md。

## 起任务与汇报（#1556）

后台长任务不经 `( ... & )` 或 `nohup ... &` 直起——工具调用返回时的进程组清理会杀掉它们（台账 #1556）。一律走 `scripts/dispatch-agent.mjs`：

```sh
node scripts/dispatch-agent.mjs start <id> [--cwd <目录>] [--ticket <票号> [--force]] -- <完整命令>
node scripts/dispatch-agent.mjs check <id>
```

start 让命令在自己的会话里启动（躲开进程组清理）、立即核对进程并把状态写进状态文件（默认 `$TMPDIR/cairn-dispatch/<id>.json`，`CAIRN_DISPATCH_STATUS_DIR` 可覆写；命令输出写进 `<id>.log`）。汇报任务状态前必须先跑 `check` 读状态文件，不许凭印象说「在跑」；直起的任务没有状态记录，`check` 报进程不存在。

派某张票的活一律带 `--ticket <票号>`（台账「派活前没查重」，#1569/#1578）：start 先查同票是否已有人在做——系统 tmp 目录（`os.tmpdir()` 与 `/tmp`）下名字含票号的 git 工作目录（不含 `--cwd` 自身）、`origin` 上含票号的分支、`xiechimon/cairn` 里搜得到该票号的 open PR、命令行含票号的 codex / pi / grok 进程。任一命中即列出并以退出码 1 拒绝启动；查不了的来源（如 gh 不可用）报「unchecked」，不当作无命中。确认命中项与本次无关后才加 `--force`。

```sh
node scripts/dispatch-agent.mjs start 1556-impl --cwd <worktree> --ticket 1556 -- ai-route run implement -C <worktree> "<任务>"
node scripts/dispatch-agent.mjs check 1556-impl
```

## Codex

实现下述任务并按仓库规则验证。不写新注释；用命名和代码结构表达意图，例外遵循仓库注释纪律。任务中犯错并修好后，当轮执行 AGENTS.md「错误台账」规则，按类别更新 `docs/lessons.md`，取最高可行防护级；新闸用真实失误做负对照。

## Grok

实现下述任务并按仓库规则验证。不写新注释；用命名和代码结构表达意图，例外遵循仓库注释纪律。任务中犯错并修好后，当轮执行 AGENTS.md「错误台账」规则，按类别更新 `docs/lessons.md`，取最高可行防护级；新闸用真实失误做负对照。

## pi

实现下述任务并按仓库规则验证。不写新注释；用命名和代码结构表达意图，例外遵循仓库注释纪律。任务中犯错并修好后，当轮执行 AGENTS.md「错误台账」规则，按类别更新 `docs/lessons.md`，取最高可行防护级；新闸用真实失误做负对照。
