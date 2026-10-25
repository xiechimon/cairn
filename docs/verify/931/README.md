# #931 验证证据：返工回原分支 / 原 PR

The two rework paths (failure restart with feedback + review-gate rejection) no longer produce a second
conversationId / second branch on the same todo; the original branch receives new commits (the mechanism surface of the PR updating in place = conv
branch push). Canonical copy = `docs/spec/23-rework-to-original-branch-and-pr-convergence.md`.

## 复现（本目录证据的生成方式）

```sh
# 集成 E2E（真 server + 真 daemon + hosted bare repo + 门控 stub LLM）
# PACMAN_IT_EVIDENCE=docs/verify/931 时落盘本目录八件证据（apps/web/e2e/
# evidence.ts 同律：opt-in，未设 = no-op）。
cd integration
PACMAN_IT_EVIDENCE=docs/verify/931 pnpm exec vitest run test/rework-branch-reuse-e2e.test.ts

# server 面（复用判定/merged 可见/fail-open/存量取最新/钉回落/纯重启负例）
cd apps/server && pnpm exec vitest run test/rework-branch-reuse.test.ts

# 回归钉：无 PR 常规重启逐字节保持 + 亲和/钉选不回归
cd integration && pnpm exec vitest run test/m7-failed-send-e2e.test.ts
```

github 形态无法在集成层真实克隆（daemon 会真连 github.com），PR 字段按
daemon 真实回填形状（`runner.ts` prProbe → `finishStep`）由测试直插模拟——
复用判定的输入面；merged/closed 判定面在 server 单测以 `githubFetch` mock
钉（`rework-branch-reuse.test.ts` 失败方式 4/5）。

## 证据 → 断言对账

| 文件 | 证明 |
|---|---|
| `builds.json` | 全程仅 **1 个 build 行**（两条返工路都不换 build）：`prevPhase='failed'`、`errorMessage=null`（失败原因由 note 承接）、`prUrl/prNumber` 原样在位（PR 不变） |
| `git-conv-branch.txt` | conv 分支 6 个提交：init → 第一轮 plan/build → **返工轮 plan/build** → **打回轮 plan**——返工提交全落原分支，无第二条 `pacman/conv-*` 分支 |
| `daemon-canon-lines.txt` | 返工轮 `[workspace] Worktree reused` + `[workspace] 返工新会话：工作区回退到分支头` + `new session <conv>` + `pushed <branch>`；打回轮 `continue session`（同 conv 会话续接，#701 边保持）；全程同一 conv id |
| `steps.json` | 返工轮首步 `freshSession=1` + prompt 携返工指令；打回轮重规划步 prompt = `buildReviewRejectPrompt` 输出（两路同源收口） |
| `messages.json` | 反馈用户行 + `返工回到本分支继续，更新原 PR #888。上一轮失败原因：…` 轮界 note 落同一 conversation |
| `plans.json` | plan 版本 v1→v2→v3 连续递增（复用轮不重置） |
| `stub-user-prompts.json` | 返工轮新会话首条 user = `composeTaskPromptWithInstruction(任务全文, buildRestartPrompt(反馈))`（#720 组合串——「只复用分支、上下文真空」的会话面） |
| `todo.json` | `latestBuildId` 不漂移（= 同一 build id）、`phase='confirm'`（打回轮收尾） |

web 呈现面（note 行可见，不冒名用户气泡）钉在
`apps/web/test/transcript-user-words.test.ts` F14（`buildReworkReuseNote` /
`buildReworkNewBranchNote` 的 system 行 → note 渲染）。
