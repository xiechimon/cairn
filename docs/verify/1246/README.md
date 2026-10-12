# #1246 team chart 单子节点断线修复 — 验证证据

## 缺陷

`apps/web/src/routes/team-chart.tsx` 恒渲染括号列（`w-7` 坐标架 + absolute bracket
`top-7`/`bottom-7`）。括号形态按 ≥2 子设计；当子节点只有创建槽（成员 1 的团队，
成员卡即根）时：括号盒塌到 0 高但 `border border-r-0` 仍画 2px 叠边短横，
`w-7` 占位在 link 与子卡之间露 28px 断口，塌片与 link 垂直错台。

## 修复

`children.length === 0`（成员卡除根外为 0，即子列只剩创建槽）时跳过括号列，
link 右缘直贴创建槽左缘；`children.length >= 1`（含槽 ≥2 子）括号 JSX
原样保留。link `w-11` 与全部 testid 不动。

## 证据

### 截图（三态 × 修复前后）

| 态 | before | after |
|---|---|---|
| 0 成员（空态） | before-0-members.png | after-0-members.png |
| 1 成员（单链，修复面） | before-1-member.png | after-1-member.png |
| 3 成员（≥2 子回归面） | before-3-members.png | after-3-members.png |

before-1-member 可见塌片残横线 + 28px 断口；after-1-member 直连无断口。
3 成员态前后逐像素一致（括号形态不动）。

截图方法：`vite build --mode fixture && vite preview`（scratch 端口 8397），
Playwright 对 chart 区域（`div.mt-[9px].flex`）clip 截图，viewport 1440×732。
before 取自未修复代码 + 新 fixture 场景（`team-org-chart-single`）。

### e2e（先红后绿）

新 test：`e2e/team-org-chart.spec.ts` —「chart 组织图单链：不渲染括号列，link
直连创建槽」（场景 `team-org-chart-single`，1 成员 + chief 绑定）：

- 未修复代码上先红 1 条（`team-chart-bracket` 计数 expected 0 / received 1，
  日志 /tmp 保留于会话）：`1 failed`
- 修复后定向三 spec（team-org-chart + team-create-agent + account-team-cleanse，
  覆盖 scenario 12 单链冒烟）：`22 passed (7.2s)`
- 收尾 e2e:affected 全量：`924 passed (2.1m)`

### 断言清单（新增尺子，只钉单链面）

- `team-chart-node` 计数 1、`暂无成员` 计数 0
- `team-chart-bracket` 计数 0（塌片消失）
- link 宽 44 / 高 1（`w-11` 不动）
- 无断口：link boundingBox 右缘 x == 创建槽左缘 x（精确相等）
- 同轴：link 中心 y 与创建槽中心 y 差 ≤1px

既有 ≥2 子括号几何断言（44×1 link / 28 宽括号 / 跨首末子中心）与 0 态
「link 计数 0」断言未改动，全量绿即回归护栏。

### 静态闸

`pnpm lint` / `pnpm typecheck` / `pnpm spec:parse`（924 tests, 123 files
collected）三绿。
