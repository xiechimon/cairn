# PR 评审评分卡（#1080）

> 形态借自 pi 的 `.pi/prompts/pr.md`（受版本管理的固定六节评分卡 + 五步流程）。作者侧标准已在 `.github/PULL_REQUEST_TEMPLATE.md`（模板五节）与 `scripts/pr-evidence-gate.py`（形态闸）——本文件补的是**给 reviewer 的成文标准**：审这个仓的 PR 按什么顺序看什么、输出什么形态。它是判断依据，不是可机械判的闸；机械检查归 CI，见下文「机械检查不归评审者」。

## 五步流程（按序执行，跳步即盲评）

1. **打 `inprogress` 标签**：开工即标记（`gh pr edit <PR> --add-label inprogress`），防两个评审者重复劳动；打不上（权限、标签缺失）就明说并继续，不因此停评。评完把标签移除（`--remove-label`）——标签只表示「评审进行中」。
2. **全文读完**：PR 描述、全部评论、全部 commit、全部变更文件——一个不漏再动手评。
3. **读关联 issue**：body / 评论 / commit message / 交叉链接里引用的每张 issue 全文（含评论）。先理解「要什么」，再评「给的是不是那个」。
4. **不切分支看 diff**：只用 `gh pr view` / `gh pr diff` / `gh api` / `git show <ref>:<path>`（fetch 后）；需要 PR 文件内容就落一次性文件读。**绝不 `gh pr checkout`、绝不 `git switch`**——本仓多车道长期并行、各占独立 worktree 施工，评审者一 checkout 就把 worktree 挪到别人的分支上，撞碎正在施工的现场；评审是只读动作，不改变任何工作区状态。
   - 被 diff 触及的代码文件**整读**（不截断）再对照 diff；diff 没碰但验证行为必须读到的代码路径（调用方、接口另一端、共享面）也一并读。
5. **检查 docs 是否需要同步**：改了已有行为或加了新机制时，`docs/spec/`（分层职责、验收口径、功能地图）、`apps/web/COMPONENTS.md`、`.claude/skills/verify-pacman/SKILL.md` 这类文档面是否该跟着变。发现缺口记进 `Bad` 或 `Tests`，不当场替作者改。

## 六节评分卡（固定输出形态）

对每张被审 PR 输出六节，节名固定：

| 节 | 内容 |
|---|---|
| **What it does** | 一段短话：这个改动做了什么、意图是什么 |
| **Good** | 站得住的选择或改进 |
| **Bad** | 具体问题：回归、缺测试、风险 |
| **Ugly** | 隐蔽的、或高影响的问题 |
| **Tests** | 覆盖了什么、缺什么、现有测试够不够 |
| **Open questions** | 只有**卡住合并决策、需要用户拍板**的事 |

输出格式（每 PR 一段）：

```
PR: <url>
What it does:
- ...
Good:
- ...
Bad:
- ...
Ugly:
- ...
Tests:
- ...
Open questions:
- ...
```

三条硬规矩：

- **Bad / Ugly 查完没发现问题，就在该节下明说**「未发现问题（查过 X / Y 面）」——这是结论，不是凑数；禁止的形态是只剩标题、一句敷衍的「无」。
- **Open questions 没有就整节省略**，连标题都不留——它只收「卡住合并决策、需要用户拍板」的事，审出的一般问题归 Bad / Ugly。
- 六节全部写实条目；写不出真实条目的节不写。

评审结论落 **PR 评论**（`gh pr comment`，长内容写一次性文件走 `--body-file`），不动 PR body——body 是作者的证据面，评审不改它。

## 机械检查不归评审者（别做 CI 的复读机）

lint / typecheck / spec:parse / vitest / e2e 由 CI `check` job 与 `pack-smoke` / `e2e-gate` 必需检查覆盖；Upstream / Failure-path 两节「有答案」由 `pr-evidence-gate.py` 钉住；Acceptance 段 tasks 存在且全勾由 `pr-tasks-gate.py`（pr-evidence job 的 pr-tasks 步）钉住。评审者把判断力花在机器看不见的地方：

- **语义冲突**：两条并行 PR 各自改同一件事、各自能跑绿（git 合并干净、typecheck 才露馅或根本不露）——对照在飞的 open PR 看 `gh pr diff --name-only` 有没有撞件。
- **缝纪律**：`biome.json` 的 `noRestrictedImports` 锁死的依赖是否绕开了薄桥模块（`apps/daemon/src/backend/` 是 GitOps / MCP / LLM provider 缝）。
- **快照面**：动 `packages/shared` 的 wire schema，`snapshot.test.ts` 是否同步更新（JSON 投影变了没更快照 = CI 必红）。
- **尾标纪律**：`closes #N` 是否在 commit message 里（squash 只带 commit message，PR body 不进 main）；分段 PR 是否**误带**了整票的尾标。
- **豁免真实性**（pr-tasks 闸管不了的）：PR 写了 `- [x] no task surface: <理由>` 但明明有任务面 → 机器只验「已勾」，真假归评审者，记 Bad。
