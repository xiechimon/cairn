# #1258 验证证据 — 失败行「查看原始错误/排查指南」可点化

两条腿，票面验收三条逐条对应：

## 1. live 栈真用户路径（`live/`，drive-1258-fail-links 9/9 PASS）

机器 wire（探针扮演机器，与 daemon 同端点）把一个 todo 推到 failed
（plan 步 done(failed) → applyStepFailure → build.errorMessage + todo
failed），浏览器腿在详情页真点。真值三件套：

| 文件 | 内容 |
|---|---|
| `live/result.json` | 9 条 checks 逐条 ok（wire / SQLite / UI 三面） |
| `live/fail-row.png` | 失败行形态（title 全文 + 查看原始错误真按钮，排查指南不在场） |
| `live/raw-error-dialog.png` | 弹窗开态（可及名「原始错误」，正文 = errorMessage 全文 1385 字多行逐字节） |
| `live/dialog-closed.png` | X 关闭后收层 |

关键判据（对应票面验收）：

- **验收 1（有原始错误时点开看得到完整错误文本）**：弹窗
  `[data-testid="fail-raw-error"]` 的 textContent 与 build.errorMessage
  **逐字节相等**（1385 字、多行、首尾 marker 在位）——`live/result.json`
  的 `ui: 弹窗正文 = errorMessage 全文逐字节（多行不截断）` 行。
- **验收 2（排查指南到对的文档位置）**：仓内无「构建失败排查」文档节、
  无文档站可链（#136「查看文档」wontfix 同律）——按票面「无对应文档节
  以不可点态处理」裁决为**不渲染**，`ui: 排查指南死链不渲染` 行钉
  `getByText('排查指南')` 计数 0。
- **验收 3（无内容时不可点态）**：失败行由 mapper 闸（errorMessage 非空
  才产行）结构性保证「查看原始错误」不存在无内容态；wire/SQLite 两行
  钉 errorMessage 全文在位 = 该前提的运行时真值。

复跑配方（from worktree 根）：

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs        # 隔离栈(8791/5273,全新库)
node .claude/skills/verify-pacman/scripts/drive-1258-fail-links.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

探针自播种（provider → API key → 机器 enroll → agent → hosted 项目 →
todo → build → claim → done(failed)），错误文本词面避开
classifyStepFailure 的 quota/capacity/network 桶（quota 桶会挂起不判死）。

## 2. fixture 面 e2e（dead-buttons.spec.ts 第 17 节，随仓可复跑）

`apps/web/e2e/dead-buttons.spec.ts` 两条（scenario 54 = r8-12 失败详情）：

- `fail row 查看原始错误 opens the raw-error dialog with the full text (#1258)`
  ——按钮点击 → dialog 族开面 → 全文逐字 → X 关闭收层。
- `fail row drops the 排查指南 dead link — no doc target, no shape (#1258)`
  ——正控制（失败行在场）+ 死链零渲染 + 留下的是真按钮。

```sh
cd apps/web && pnpm exec playwright test dead-buttons.spec.ts -g "#1258"
```

测试先行：实现前实测红（按钮不存在 / 死链在场），实现后绿。
