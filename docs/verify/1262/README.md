# docs/verify/1262 — errorMessage ANSI/OSC8 剥离证据

Ticket #1262：工具输出的 ANSI 转义/Hyperlink 原样进 `build.errorMessage`，板面报错巨长难读。

## 修复面

- **单源**：`packages/shared/src/ansi.ts` `stripAnsiEscapes`（CSI 含 SGR + OSC 含 OSC8；OSC 内容类排除 ESC——停在 ST 前，开/闭对之间的可见标签保留）。
- **写入侧（daemon 捕获）**：`apps/daemon/src/runner.ts` doneBody `errorMessage` 构造点剥（wire、#1026 journal、build.errorMessage、chief 错误行全下游干净）。
- **显示侧（web 兜底）**：`apps/web/src/api/mappers.ts` 失败行 title + 运行历史 meta 剥（存量脏数据不迁移也 readable）。

## 证据清单

| 文件 | 内容 |
|---|---|
| `row-from-user-db.txt` | **before**：用户库实测污染行原文（359,698 字符、75,458 ESC——git commit 钩子带出的 biome 输出） |
| `biome-colored.txt` | 真实 biome `--colors=force` 输出（SGR + OSC8 超链接对） |
| `biome-plain.txt` | 同一诊断 `--colors=off` 输出 |
| `biome-onoff-strip-analysis.json` | 验收 2：两档剥后对照（诊断首行逐字一致；残差 = biome 符号字形档 ⚠/ℹ/✖ vs !/i/× 与计时行，非转义） |
| `e2e-daemon-raw-capture.txt` | 全链 e2e（真 server+daemon+git+stub LLM）：daemon 捕获侧 raw 原文 + 测试结果 |
| `fail-row-1262.png` | **after**：live 栈（8796/5278）板面真截图——污染行渲染为纯文本 |
| `rendered-text.json` | 板面驱动 5/5 PASS（textContent 无 ESC、无 `]8;;`、首行含 文件:行:列+规则名） |

## 复跑入口

- 单元：`pnpm --filter @pacman/shared exec vitest run test/ansi.test.ts`（9 测）；`apps/web test/fail-row-ansi.test.ts`（3 测）；`apps/daemon test/runner-error-lifecycle.test.ts`（12 测含 #1262 两条）。
- 全链：`pnpm --filter @pacman/integration exec vitest run test/ansi-errormessage-e2e.test.ts`（pre-commit 钩子吐真实 biome 彩色诊断 → git commit 失败 → daemon 捕获 → done 上报 → server 落库 → 断言纯文本）。
- 板面视觉：`node .claude/skills/verify-pacman/scripts/launch.mjs`（VERIFY_PORT=8796 VERIFY_WEB_PORT=5278）→ `node .../scripts/drive-1262-ansi-error.mjs` → `cleanup.mjs`。

## Multica 对照

`sanitizeCLIOutput`（`server/pkg/agent/codearts.go:801`）同域：`"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))"` 在 CLI 输出捕获侧剥。其 OSC 分支贪婪 `[^\x07]*` 会把 OSC8 开/闭对之间的可见标签（规则名）一起吞掉——本实现的 OSC 内容类排除 ESC，不犯该形。
