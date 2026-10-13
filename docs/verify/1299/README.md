# 1299 验收实录 — skills 执行面借 T3 路线

## What

三件事（票面设计，不扩大范围）：

1. **联合扫描**：daemon skills 面 skillPaths 扩为 `[PACMAN_SKILLS_DIR, <任务 worktree>/.claude/skills]`；pi 后端 `.pi/skills` 若存在同律加入。身份/去重/预算律沿用现状（spec 14 + #1116），只扩扫描面。
2. **Skill 工具**：pi session 增自定义工具 `Skill`（参照 tag-tool.ts 缝）：入参 skill name → 校验在可见集 → 返回 SKILL.md 全文 + `[skills] invoke` 日志。claude-code 后端不动。
3. **/name 保证调用**：runner 组装 worker prompt 时识别 `/<skill-name>`（可见集内）→ 前置确定性加载指令；未知 name no-op + `[skills] unknown-dispatch` 日志。

## Verified

### 单测（三态/五态）

```
pnpm --filter @pacman/daemon exec vitest run test/skills-worktree.test.ts test/skill-tool.test.ts test/skills-catalog.test.ts test/skills-hard-block.test.ts test/skills-native-plugin.test.ts
```

| 测试文件 | 用例数 | 覆盖失败方式 |
|---|---|---|
| skills-worktree.test.ts | 8 | 双目录都有 / 仅团队 / 仅 worktree / 同名冲突（winner+日志）/ 都无 / 缺省零回归 / piWorktreeSkillDirs 返回两目录 |
| skill-tool.test.ts | 5 | 命中返回全文+invoke 日志 / 未见名错误文本 / 空名 / 读文件失败 / 工具名=Skill |
| skills-catalog.test.ts（既有） | 43 | #1116 字节预算与绑定序回归 |
| skills-hard-block.test.ts（既有） | 14 | #917 deny 面回归 |
| skills-native-plugin.test.ts（既有） | 13 | #1171 团队 view 回归 |

五态（联合扫描）：
1. 双目录都有 → 全部可见
2. 仅团队 → worktree 目录不存在静默收窄（不炸）
3. 仅 worktree → PACMAN_SKILLS_DIR 空也可见 worktree 技能
4. 同名冲突 → PACMAN_SKILLS_DIR 条目胜（first-wins，skillPaths 序 team → skillsDir → worktree），buildSkillsCatalog 落 `collision:` 日志点名
5. 都无 → 空集不炸

三态（/name 展开，runner 侧实现，见下方机制实证）：
1. 命中 → prompt 前置「先调用 Skill 工具加载 <name>」指令 + `dispatch:` 日志
2. 未知名 → no-op + `unknown-dispatch:` 日志，步不炸
3. 无 slash → no-op

### 机制实物

`/name` 展开在 runner 组装 worker prompt 时运行（真实派一步路径），单测直接覆盖 runner.ts 的行为面。实证方式：以 mock pi session 捕获 fixture（见 `docs/verify/1299/mock-transcript.md`）。

### 闸

- `pnpm lint` — 绿（54 个既有 warning，0 error）
- `pnpm -r typecheck` — 绿（5 package）
- `pnpm spec:parse` — 绿（apps/web/e2e 922 tests in 127 files；integration/test 30 files）
- daemon 受影响面单测 — 绿（skills-worktree + skill-tool 13 新例，skills-* 全族 118 例，runner-team-skills / runner-local / runner-delivery 29 例）

## Upstream

无。三处改动全在 daemon 进程内：backend/skills.ts（扫描面 + 可见集导出）、backend/pi.ts（brief 与 deny 面透传 worktreeSkillsDirs）、runner.ts（Skill 工具装配 + /name 展开）、skill-tool.ts（新工具）、machine-loop.ts（deps 透传 skillsDir）。

## Risk

- **claude-code 后端不注册 Skill 工具**：其原生 Skill 机制已可观测（skill-facts.ts `skillCallName` 的 `Skill` 分支即识 claude-code 原生调用）。本次只改 pi。
- **worktree 技能目录缺失**：loadSkills 出 warning 诊断不报错（#1299 失败方式 2 静默收窄语义，与既有扫描面同律）。
- **碰撞裁决**：worktree 条目排在 skillPaths 尾部 → first-wins 下 PACMAN_SKILLS_DIR / 团队条目胜。与既有 teamSkillsDir 胜 skillsDir 律一致。

## Acceptance

- PR 开出，commit 带 `closes #1299`
- 闸全绿（lint / typecheck / spec:parse / 受影响面单测）
- docs/verify/1299/ 有调用实证

## Issues

无。
