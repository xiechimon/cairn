# 功能地图（当前状态活册）

> 本册由 `scripts/generate-feature-map.mjs` 机械抽取生成，勿手改；改口径 = 改脚本后重跑（#894 立首版规则）。
> 重生成：`node scripts/generate-feature-map.mjs`；校验落盘版与源数据一致：加 `--check`。
> 前置：`gh` 已登录、api.github.com 可达。
> 与 03 册分工：03-ROADMAP = 构建顺序历史册；本册 = 当前状态活册。
> 编号注：曾落 spec 序列 22 号，撞号重编至 25（#952）；#1527 起移出编号序列，改落 `docs/feature-map.md`（生成物不占手写册号）。

## 0. 抽取口径

全部规则机械可重跑，无逐行人工编辑。正本 = 脚本本身，本节由脚本渲染。

### 0.1 行与列

行 = 票号并集（三个来源，票号按数值归一、前导零去除）：

1. `docs/spec/*.md` 里的 `#(\d{2,4})(?![0-9a-fA-F])` 引用——负向前瞻排除十六进制色值；
2. `docs/verify/` 的纯数字目录名（已落地验收产物）；
3. CI 测试面（apps、packages、integration 下的 .test.ts / .test.tsx / .spec.ts，跳过 coverage、dist、node_modules、playwright-report、test-results）里的票号引用。

标题与状态取 `gh api repos/<owner>/<repo>/issues?state=all`（含 PR）。行集按 `gh issue list` 口径只收 issue；被引用的 PR 号不生成行（列 §3.2），解析不到的票号列 §3.3。

四列：功能 = `#票号` + issue 标题逐字；哪一档 = §0.2；状态 = §0.3；验证锚 = §0.4。

### 0.2 档位规则（18 册口径）

档位词表来自 `docs/spec/18-定位与差异化.md`（差异化面 / 运行轴 / 通用面）。
判定 = 标题关键词匹配，按下表顺序首中即停，全不中 = 通用面：

| 档 | 标题正则（脚本内正本） |
|---|---|
| 差异化面 | `/闸|gate|confirm|review|审核|方案|plan|驳回|reject|revision|verdict|相位|phase/i` |
| 运行轴 | `/机器|machine|daemon|runtime|执行|executor|worktree|自托管|部署|deploy|enroll|claim|亲和|affinity|沙箱|sandbox|编排|orchestrat|会话|session|跨机|钉选|多机|cli|pin/i` |

### 0.3 状态规则

| issue 状态 | 有验证锚 | 无验证锚 |
|---|---|---|
| closed | 已做 | 未验证 |
| open | 在跑 | 待开 |

### 0.4 验证锚规则

- `docs/verify/<票号>/` 目录存在 → 该路径入锚；
- CI 测试面里引用该票号的文件 → 逐个路径入锚（这些文件由 §0.5 的 CI job 执行）；
- 两者皆无 → 锚列标 `[未验证]`，行进 §3.1 补活清单。

### 0.5 CI 执行面（`.github/workflows/ci.yml` 抽取）

| job | 命名步骤 |
|---|---|
| `check` | Conflict markers、Lane file gate (#1199)、Test spawn gate、PR evidence workflow shape gate、UI debt gate (#851)、UI registry gate (#989)、UI consumer shape gate (#1054)、Install dependencies、Spec parse gate (#1052)、verify-pacman CLI self-test (#1402)、Install Playwright chromium、Drizzle snapshot chain guard、Drizzle migration drift check、Typecheck、Test (vitest，轻 project)、Test (vitest，集成栈单独跑)、Lint (biome ci)、pr-gate self-check (#1401)、Lint warning cap gate (#1192)、UI drift gate (#851) |
| `e2e` | Install ffmpeg、Install dependencies、Install Playwright chromium、E2E (shard ${{ matrix.shard }}/4, #693)、CSS mechanism gate (#747) |
| `e2e-gate` | Aggregate e2e shards |
| `pack-smoke` | Install dependencies、Pack smoke (main package tarball, bare node) |
| `dead-class-gate` | Install dependencies、Dead class gate (#1036) |
| `issue-label-gate` | Issue label gate |
| `feature-map-gate` | Feature map staleness gate (#1160)、Feature map doc freshness check (#1527) |

### 0.6 已知局限（首版如实登记）

1. 引用识别是行级正则，不排代码围栏：spec 代码块里的 `#NNN` 也会被当引用收进。
2. 档位是标题关键词匹配，不做语义判断——多义词不区分（「闸」既是产品硬闸也是 CI 闸名，「review」既是 AI 审核也是一般代码审查）。错档行 = 规则噪音，细化 §0.2 两条正则是后续活。
3. 状态不读 `state_reason`：wontfix / not_planned 关闭的票同样记「已做」。
4. 功能列 = issue 标题逐字。开票后行为再演化，标题不跟。
5. 行集 = 三源引用到的票。从未开票、或开了票但 spec / 测试 / 证据都没引用过的功能不在册。
6. GitHub 数据是生成时点快照；源数据变了重跑即更新（活册的更新方式）。「跑两次一致」指源数据不变时字节一致。

## 1. 统计

| 项 | 数 |
|---|---|
| 地图行（issue） | 605 |
| 其中 差异化面 | 85 |
| 其中 运行轴 | 137 |
| 其中 通用面 | 383 |
| 状态 已做 | 532 |
| 状态 在跑 | 6 |
| 状态 待开 | 3 |
| 状态 未验证 | 64 |
| 锚 = 证据目录 + 测试引用 | 289 |
| 锚 = 仅证据目录 | 78 |
| 锚 = 仅测试引用 | 171 |
| 无锚（`[未验证]`） | 67 |
| 被引用的 PR（不生成行，§3.2） | 107 |
| 解析不到的票号（§3.3） | 0 |
| 非 GitHub 票号的证据目录（§3.4） | 76 |
| 扫描面：spec 册 / 测试文件 | 30 / 492 |

## 2. 功能地图

排序：档位（差异化面 → 运行轴 → 通用面）内按票号升序。

| 功能 | 哪一档 | 状态 | 验证锚 |
|---|---|---|---|
| [#46](https://github.com/xiechimon/pacman/issues/46) 实验：Chief 黑盒行为观察（plan 拆分/驳回回路/memory 写入/双 Agent/通知矩阵） | 差异化面 | 未验证 | [未验证] |
| [#56](https://github.com/xiechimon/pacman/issues/56) Web: 详情基面 — dhead/phase 映射/流元素（r7 23/16/17 捕获组） | 差异化面 | 未验证 | [未验证] |
| [#57](https://github.com/xiechimon/pacman/issues/57) Web: 详情深层 — 执行中/审核/完成 + 文档分栏（r7 26/27/36/38） | 差异化面 | 未验证 | [未验证] |
| [#64](https://github.com/xiechimon/pacman/issues/64) 研究：r8 集中补拍 — 动态面像素基线（驳回/失败/复用/运行历史/AI 审核） | 差异化面 | 未验证 | [未验证] |
| [#67](https://github.com/xiechimon/pacman/issues/67) Web: 弹层批 B — ⌘K 搜索（含结果态）+ chip popover + plan 类型下拉 | 差异化面 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/project-tasks-toolbar.spec.ts` |
| [#75](https://github.com/xiechimon/pacman/issues/75) Web: 深层动态态 — 驳回回路 UI + 失败态 + 复用方案（r8 基线） | 差异化面 | 已做 | `apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/composer-wire-reject.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/rerun-close-family.spec.ts` |
| [#81](https://github.com/xiechimon/pacman/issues/81) M4a Chief 编排：remoteTools relay + 措辞→spec + 驳回 v2 + 双 Agent 分派 | 差异化面 | 未验证 | [未验证] |
| [#113](https://github.com/xiechimon/pacman/issues/113) build: 阶段交接缺口——plan 关未产 plan.md 时 build agent 无任务上下文 | 差异化面 | 已做 | `apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/m3b-machine-git.test.ts`<br>`apps/server/test/m5-face.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`apps/server/test/notifications.test.ts`<br>`apps/server/test/plan-handoff.test.ts`<br>`apps/server/test/stop.test.ts`<br>`apps/server/test/wire.test.ts` |
| [#168](https://github.com/xiechimon/pacman/issues/168) web: 开始任务 rerun dialog / 复用方案 panel 关闭三路径全缺（X/Esc/backdrop） | 差异化面 | 已做 | `apps/web/e2e/rerun-close-family.spec.ts` |
| [#207](https://github.com/xiechimon/pacman/issues/207) task: project-settings 删除区复活——DeleteConfirm + DELETE /api/projects/:id 接线 | 差异化面 | 已做 | `apps/web/e2e/project-settings-dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts` |
| [#238](https://github.com/xiechimon/pacman/issues/238) grilling: plan-diff 面「显示完整文件」同名钮——数据源形态裁决(#225 开放项) | 差异化面 | 已做 | `apps/web/e2e/plan-diff-full-file.spec.ts` |
| [#244](https://github.com/xiechimon/pacman/issues/244) task: plan-diff 面「显示完整文件」钮接线(#238 裁决 A) | 差异化面 | 已做 | `apps/web/e2e/plan-diff-full-file.spec.ts` |
| [#277](https://github.com/xiechimon/pacman/issues/277) spec: W3 steer 中断——building/review 态发消息(06 册 D9 W3) | 差异化面 | 已做 | `apps/server/test/steer.test.ts`<br>`integration/test/w3-steer-e2e.test.ts` |
| [#280](https://github.com/xiechimon/pacman/issues/280) task: steer web 面——composer building/review 态激活 + e2e(W3) | 差异化面 | 已做 | `integration/test/w3-steer-e2e.test.ts` |
| [#306](https://github.com/xiechimon/pacman/issues/306) M7-W2 菜单桩清零（chief 更多/sched 更多/skills 排序/account-swap/transcript 折叠/plan 行） | 差异化面 | 已做 | `apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/chief-drawer-model.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#312](https://github.com/xiechimon/pacman/issues/312) M7-W5 AI 审核全链（r8 §3.1：模态 → 审核步 → blocking 自动修订） | 差异化面 | 已做 | `docs/verify/312/`<br>`apps/server/test/review.test.ts` |
| [#318](https://github.com/xiechimon/pacman/issues/318) M7-W2 桩群校准新增：更多菜单完成/关闭 + 开始任务 dialog 统一面 + 查看方案 + 任务行点击 + 未保存闸 | 差异化面 | 已做 | `apps/server/test/wire.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts` |
| [#320](https://github.com/xiechimon/pacman/issues/320) M7-W3 失败面发消息 = 带反馈重启：composer failed 相位发送语义接真 | 差异化面 | 已做 | `docs/verify/320/`<br>`apps/server/test/artifact-gate.test.ts`<br>`integration/test/m7-failed-send-e2e.test.ts` |
| [#326](https://github.com/xiechimon/pacman/issues/326) M7-W5.2 AI 审核 findings + blocking 自动修订回路（#312 子票） | 差异化面 | 未验证 | [未验证] |
| [#330](https://github.com/xiechimon/pacman/issues/330) M7-W5 AI 审核第二片：审核步执行 + findings 渲染 + blocking 自动修订回路 | 差异化面 | 已做 | `docs/verify/330/`<br>`apps/daemon/test/review-findings.test.ts`<br>`apps/daemon/test/runner-review.test.ts`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/review-reject.test.ts`<br>`apps/server/test/review.test.ts` |
| [#426](https://github.com/xiechimon/pacman/issues/426) B2 热身：token-gate + machine-authorize 两件最小散件 | 差异化面 | 已做 | `docs/verify/426/` |
| [#509](https://github.com/xiechimon/pacman/issues/509) web,server: AI 审核的选人默认——优先跨厂商（审核人 provider ≠ 产出步 Agent 的 provider） | 差异化面 | 已做 | `apps/server/test/review.test.ts`<br>`apps/web/test/review-default.test.ts` |
| [#511](https://github.com/xiechimon/pacman/issues/511) server,daemon: 审核步的信息集窄于人的——审核关口应把「变更」一并交给审核者（现只给方案全文，且排除在 worktree 之外） | 差异化面 | 已做 | `apps/daemon/test/runner-review.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/review.test.ts`<br>`packages/shared/test/review-prompt.test.ts` |
| [#666](https://github.com/xiechimon/pacman/issues/666) e2e: deflake m5-web-e2e plan-card stall (CI-only) and chip-hotzone H2 focus-steal race | 差异化面 | 已做 | `docs/verify/666/`<br>`apps/web/e2e/chip-hotzone.spec.ts`<br>`apps/web/test/sse-team-events.test.ts`<br>`integration/test/web-plans-convergence.test.ts` |
| [#681](https://github.com/xiechimon/pacman/issues/681) web: i18n-coverage gate hangs forever on a '#' inside any regex literal in scanned src (zero-advance PrivateIdentifier spin) | 差异化面 | 已做 | `docs/verify/681/`<br>`apps/web/test/i18n-coverage.test.ts`<br>`apps/web/test/i18n-scan.test.ts` |
| [#682](https://github.com/xiechimon/pacman/issues/682) machine dispatch closure: pin machines from task entry surfaces, make enabledRuntimes a real claim gate, offline-pin wait annotation | 差异化面 | 已做 | `docs/verify/682/`<br>`apps/server/test/machine-local.test.ts`<br>`apps/server/test/machine-pin.test.ts`<br>`apps/server/test/rework-branch-reuse.test.ts` |
| [#698](https://github.com/xiechimon/pacman/issues/698) 步被 claim 后零模型调用直接 finished——m5 相位不推进的真因（含 .chat-plan-title 间歇红） | 差异化面 | 已做 | `docs/verify/698/`<br>`apps/daemon/test/runner-silent-noop.test.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#700](https://github.com/xiechimon/pacman/issues/700) daemon: review verdict extraction must scan past trailing tool-call messages (B-C13) | 差异化面 | 已做 | `docs/verify/700/`<br>`apps/daemon/test/review-findings.test.ts`<br>`apps/daemon/test/runner-review.test.ts`<br>`apps/daemon/test/verify-verdict.test.ts`<br>`apps/server/test/review.test.ts` |
| [#701](https://github.com/xiechimon/pacman/issues/701) server,web: review gate human rejection path — reuse the review→planning edge (B-C12) | 差异化面 | 已做 | `docs/verify/701/`<br>`apps/server/test/review-reject.test.ts`<br>`apps/server/test/rework-branch-reuse.test.ts`<br>`apps/web/e2e/review-reject.spec.ts`<br>`integration/test/done-dialog-e2e.test.ts`<br>`packages/shared/test/review-reject-prompt.test.ts` |
| [#702](https://github.com/xiechimon/pacman/issues/702) server: failed review must not lock the merge path of a done build (B-C17) | 差异化面 | 已做 | `docs/verify/702/`<br>`apps/server/test/failed-review-restore.test.ts`<br>`apps/server/test/manual-drop-matrix.test.ts`<br>`apps/server/test/phase.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`integration/test/done-dialog-e2e.test.ts` |
| [#703](https://github.com/xiechimon/pacman/issues/703) server,daemon: gate artifact validation — no confirm without a plan, no review without changes (B-C10/B-C11/B-C14) | 差异化面 | 已做 | `docs/verify/703/`<br>`apps/daemon/test/runner-artifact.test.ts`<br>`apps/daemon/test/runner-restart-prompt.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/plan-handoff.test.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`integration/test/crash-recover.test.ts`<br>`integration/test/gate-e2e.test.ts`<br>`integration/test/m3a-demo.test.ts`<br>`integration/test/m4b-mcp-e2e.test.ts`<br>`integration/test/m4b-memory-e2e.test.ts`<br>`integration/test/port-base-e2e.test.ts`<br>`integration/test/shell-e2e.test.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`integration/test/skills-routing-e2e.test.ts`<br>`integration/test/w3-steer-e2e.test.ts` |
| [#704](https://github.com/xiechimon/pacman/issues/704) server: hosted repo for manual projects + agent PR backfill so the review surfaces have truth (B-C1/B-C16) | 差异化面 | 已做 | `docs/verify/704/`<br>`apps/daemon/test/github-probe.test.ts`<br>`apps/daemon/test/runner-delivery.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/delivery-surface.test.ts` |
| [#705](https://github.com/xiechimon/pacman/issues/705) web: re-verify gate-page SSE liveness on current main (B-C3) | 差异化面 | 已做 | `docs/verify/705/` |
| [#707](https://github.com/xiechimon/pacman/issues/707) server,daemon: model source must follow the executor machine, not the control-plane host (G22) | 差异化面 | 已做 | `docs/verify/707/`<br>`apps/daemon/test/claude-code-models.test.ts`<br>`apps/daemon/test/machine-boot.test.ts`<br>`apps/server/test/chief-tools.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/model-sources.test.ts`<br>`packages/shared/test/model-source.test.ts` |
| [#709](https://github.com/xiechimon/pacman/issues/709) 任务：真闭环复验——AI 审核实过、产品内合并落地（#519 闭环零人肉替代） | 差异化面 | 已做 | `apps/daemon/test/review-findings.test.ts` |
| [#717](https://github.com/xiechimon/pacman/issues/717) m5 CI 间歇红的浏览器侧：plan 卡/相位 chip 停更的 UI 刷新面（#698 判因收尾） | 差异化面 | 已做 | `docs/verify/717/`<br>`apps/web/test/invalidate-converged.test.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#747](https://github.com/xiechimon/pacman/issues/747) web,ci: build-artifact gate — compiled CSS must contain the animation mechanisms the source claims | 差异化面 | 已做 | `docs/verify/747/` |
| [#750](https://github.com/xiechimon/pacman/issues/750) ci: PR 正文证据面闸——图链必须内嵌且必须 200（打包缺陷的机械约束） | 差异化面 | 已做 | `docs/verify/750/` |
| [#755](https://github.com/xiechimon/pacman/issues/755) web,daemon,server: dragging a started card back to 待开始 must gate a task reset (interrupt build + clear artifacts) | 差异化面 | 已做 | `docs/verify/755/`<br>`apps/server/test/reset-todo.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/board-queued-column.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts` |
| [#762](https://github.com/xiechimon/pacman/issues/762) ci: e2e 合并闸从未生效——e2e-gate 不在必需检查，且失败路径上被 GitHub 当作通过 | 差异化面 | 已做 | `docs/verify/762/` |
| [#778](https://github.com/xiechimon/pacman/issues/778) web: 内部标记 [wake:gate] 漏进总管抽屉输入框——用户面须剥离内部 marker | 差异化面 | 已做 | `docs/verify/778/`<br>`apps/web/test/chief-user-echo.test.ts` |
| [#808](https://github.com/xiechimon/pacman/issues/808) daemon,server: review verdict extraction must tolerate string line numbers (B-C13 follow-up) | 差异化面 | 已做 | `docs/verify/808/`<br>`apps/daemon/test/review-findings.test.ts`<br>`apps/daemon/test/verify-verdict.test.ts` |
| [#851](https://github.com/xiechimon/pacman/issues/851) 施工期止血闸：CI 拦新增 per-face CSS 与裸控件（#908 波 0a） | 差异化面 | 已做 | `docs/verify/851/` |
| [#866](https://github.com/xiechimon/pacman/issues/866) AMP对齐T5：命令闸 tracer | 差异化面 | 已做 | `docs/verify/866/`<br>`apps/daemon/test/command-gate.test.ts`<br>`packages/shared/test/permission-rules.test.ts` |
| [#880](https://github.com/xiechimon/pacman/issues/880) test: 去 flake —— m5-web-e2e 驳回支线 `waitChip(规划中)` 同日三次 150s 超时 | 差异化面 | 已做 | `docs/verify/880/`<br>`integration/test/m5-web-e2e.test.ts` |
| [#892](https://github.com/xiechimon/pacman/issues/892) research: 量闸 —— 真闭环实测里数 withPlan 分布 + 找闸被跳过的路径 | 差异化面 | 已做 | `apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/server/test/chief-dispatch.test.ts`<br>`apps/server/test/chief-settings.test.ts`<br>`apps/server/test/gate-actor.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts` |
| [#900](https://github.com/xiechimon/pacman/issues/900) server: chief 不得自过 review 闸（complete_todos 纳入权限模型） | 差异化面 | 已做 | `docs/verify/900/`<br>`apps/server/test/gate-actor.test.ts` |
| [#901](https://github.com/xiechimon/pacman/issues/901) web+server: 从 confirm/review 拖向 done 要求确认弹层 + 落审计行 | 差异化面 | 已做 | `apps/server/test/gate-actor.test.ts`<br>`apps/web/e2e/board-dnd-live.spec.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`integration/test/done-dialog-e2e.test.ts` |
| [#902](https://github.com/xiechimon/pacman/issues/902) server: 过闸动作记 actor（announcement 行） | 差异化面 | 已做 | `apps/server/test/gate-actor.test.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`integration/test/done-dialog-e2e.test.ts` |
| [#903](https://github.com/xiechimon/pacman/issues/903) chief: 派发的 plan/直执行选择权交还 charter 或人 | 差异化面 | 已做 | `docs/verify/903/`<br>`apps/server/test/chief-dispatch.test.ts`<br>`apps/server/test/chief-reject-diff.test.ts`<br>`apps/server/test/chief-settings.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/orchestration-source.test.ts`<br>`apps/web/e2e/chief-settings.spec.ts`<br>`integration/test/m4b-watch-wake-e2e.test.ts`<br>`packages/shared/test/chief-tools.test.ts` |
| [#904](https://github.com/xiechimon/pacman/issues/904) test: plan.md 落库通道全链验证（withPlan build → plan 表 → confirm 有物可看） | 差异化面 | 已做 | `docs/verify/904/`<br>`apps/daemon/test/runner-upload-recovery.test.ts`<br>`apps/server/test/plan-handoff.test.ts`<br>`integration/test/plan-upload-recovery.test.ts` |
| [#929](https://github.com/xiechimon/pacman/issues/929) daemon: 命令闸改用 pi 原生 tool_call 阻断缝（现在在复刻 bash 工具换 operations） | 差异化面 | 已做 | `apps/daemon/test/command-gate.test.ts`<br>`integration/test/gate-e2e.test.ts` |
| [#939](https://github.com/xiechimon/pacman/issues/939) ci: PR 模板 + 闸加两问（上游等价物 / 失败路径证据） | 差异化面 | 已做 | `docs/verify/939/` |
| [#980](https://github.com/xiechimon/pacman/issues/980) Map: 组件形态对齐 shadcn 官网——registry 同源 + 禁手写闸 + 色调重选（每域原型先行） | 差异化面 | 未验证 | [未验证] |
| [#989](https://github.com/xiechimon/pacman/issues/989) 禁手写闸落成：components/ui 白名单进 CI（#851 扩展） | 差异化面 | 已做 | `docs/verify/989/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts` |
| [#994](https://github.com/xiechimon/pacman/issues/994) web: 合并闸对空授权集放行、server 403——显式全关的 Agent「完成」可点但必被拒 | 差异化面 | 已做 | `docs/verify/994/`<br>`apps/web/e2e/merge-reject.spec.ts`<br>`apps/web/test/merge-gate.test.ts` |
| [#1025](https://github.com/xiechimon/pacman/issues/1025) daemon: 首轮规划提示词注入 plan.md 契约（plan.md 只存在于纠错轮） | 差异化面 | 已做 | `docs/verify/1025/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/daemon/test/runner-restart-prompt.test.ts`<br>`apps/server/test/machine-zombie-claim.test.ts`<br>`apps/web/e2e/transcript-user-words.spec.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`packages/shared/test/plan-first-round-prompt.test.ts` |
| [#1026](https://github.com/xiechimon/pacman/issues/1026) daemon: plan 上传幂等（done 失败后重跑产生同内容重复版本） | 差异化面 | 已做 | `apps/daemon/test/machine-recover.test.ts`<br>`apps/daemon/test/runner-upload-recovery.test.ts`<br>`apps/server/test/plan-handoff.test.ts`<br>`integration/test/plan-upload-recovery.test.ts` |
| [#1027](https://github.com/xiechimon/pacman/issues/1027) daemon: receivePlanUpload 校验步 kind/status（现在只验机器归属） | 差异化面 | 已做 | `apps/daemon/test/runner-upload-recovery.test.ts`<br>`apps/server/test/plan-handoff.test.ts` |
| [#1054](https://github.com/xiechimon/pacman/issues/1054) web: 消费点「看得见的方形盒」73 处未随 registry 对齐（闸的盲区，需判据+机器闸） | 差异化面 | 已做 | `docs/verify/1054/`<br>`apps/web/e2e/spec-brief-card.spec.ts` |
| [#1087](https://github.com/xiechimon/pacman/issues/1087) diagram: 文字出框的机器闸（第三张坏图漏到用户手上，brief 写了两次仍没拦住） | 差异化面 | 已做 | `docs/verify/1087/` |
| [#1101](https://github.com/xiechimon/pacman/issues/1101) web: 审核页 diff 视图两缺陷——右滑丢红绿底色 + 无行内逐字高亮 | 差异化面 | 已做 | `docs/verify/1101/`<br>`apps/web/e2e/diff-word-highlight.spec.ts` |
| [#1107](https://github.com/xiechimon/pacman/issues/1107) diagram: 图必须有可编辑的 .drawio 源（3 张缺源，机器闸） | 差异化面 | 已做 | `docs/verify/1107/` |
| [#1138](https://github.com/xiechimon/pacman/issues/1138) server: agent 级并发闸——claim 按 agent 计数 | 差异化面 | 已做 | `docs/verify/1138/`<br>`apps/server/test/agent-concurrency.test.ts` |
| [#1150](https://github.com/xiechimon/pacman/issues/1150) server: CI 磨绿环——轮询 PR checks，红派修复步，绿进 review | 差异化面 | 已做 | `docs/verify/1150/`<br>`apps/server/test/ci-loop.test.ts`<br>`apps/server/test/rework-branch-reuse.test.ts` |
| [#1153](https://github.com/xiechimon/pacman/issues/1153) tracer: 持续派发环端到端——投喂到 review，中途静默死机换机续跑 | 差异化面 | 已做 | `docs/verify/1153/` |
| [#1160](https://github.com/xiechimon/pacman/issues/1160) scripts: feature-map 陈旧闸——机器核对 verify-pacman map 引用与当前树（#1156 漏拦根因） | 差异化面 | 已做 | `docs/verify/1160/` |
| [#1195](https://github.com/xiechimon/pacman/issues/1195) build artifact gate reports zero-changes when the agent commits on a non-conv branch (PR delivered anyway) | 差异化面 | 已做 | `docs/verify/1195/`<br>`apps/daemon/test/runner-branch-drift.test.ts`<br>`apps/daemon/test/workspace.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/pr-reconcile.test.ts`<br>`packages/shared/test/work-branch-note.test.ts` |
| [#1203](https://github.com/xiechimon/pacman/issues/1203) plan.md handoff collides with repo checkout: move it out of the repo and backstop with lane-file-gate | 差异化面 | 已做 | `apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/runner-artifact.test.ts`<br>`apps/daemon/test/runner-branch-drift.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/daemon/test/runner-restart-prompt.test.ts`<br>`apps/web/e2e/transcript-user-words.spec.ts`<br>`integration/test/m7-failed-send-e2e.test.ts`<br>`integration/test/rework-branch-reuse-e2e.test.ts`<br>`packages/shared/test/plan-first-round-prompt.test.ts`<br>`packages/shared/test/work-branch-note.test.ts` |
| [#1204](https://github.com/xiechimon/pacman/issues/1204) Rework loop broken: change-request from review fails with 'plan 步无指派 Agent' when assignment.plan is null; rework also drops session context | 差异化面 | 已做 | `apps/server/test/rework-plan-fallback.test.ts` |
| [#1208](https://github.com/xiechimon/pacman/issues/1208) Machine pin from composer is ignored by dispatch: plan and build steps both run on the unpinned machine | 差异化面 | 已做 | `docs/verify/1208/` |
| [#1236](https://github.com/xiechimon/pacman/issues/1236) web: 完成任务确认 dialog 点击后相位不变（rework 卡必现，普通卡亦曾现） | 差异化面 | 已做 | `docs/verify/1236/`<br>`integration/test/done-dialog-e2e.test.ts` |
| [#1240](https://github.com/xiechimon/pacman/issues/1240) ci: pr-tasks-gate — PR body tasks must exist and be all checked before merge; template seeds the checklist | 差异化面 | 已做 | `docs/verify/1240/` |
| [#1248](https://github.com/xiechimon/pacman/issues/1248) docs: ADR 0018 多 agent 团队——角色 agent 流水线 + chief 拆票 + 机器能力闸（含 agent 与机器/skills/MCP 的协调模型） | 差异化面 | 已做 | `docs/verify/1248/` |
| [#1251](https://github.com/xiechimon/pacman/issues/1251) daemon,server(1248): machine capability reporting + dispatch capability gate + visible pending reasons | 差异化面 | 已做 | `docs/verify/1251/`<br>`apps/daemon/test/machine-boot.test.ts`<br>`apps/daemon/test/machine-capabilities.test.ts`<br>`apps/server/test/capability-pending-reason.test.ts`<br>`apps/server/test/machine-capability-gate.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`packages/shared/test/machine-capabilities.test.ts` |
| [#1254](https://github.com/xiechimon/pacman/issues/1254) chief: plan 就绪后默认自动确认施工，真决策点才走 ask-user-question | 差异化面 | 已做 | `apps/server/test/chief-auto-confirm.test.ts`<br>`apps/server/test/chief-watch.test.ts` |
| [#1266](https://github.com/xiechimon/pacman/issues/1266) web: ⌘J 再按一次窗口闪一下（回归，需防再犯闸） | 差异化面 | 已做 | `docs/verify/1266/`<br>`apps/web/e2e/chief-toggle-flash.spec.ts`<br>`apps/web/test/gesture-machine.test.ts` |
| [#1312](https://github.com/xiechimon/pacman/issues/1312) daemon/server: build 步在同机续不上 plan 会话——session not found 且无降级，plan→confirm→build 断链 | 差异化面 | 已做 | `docs/verify/1312/`<br>`apps/daemon/test/claude-transcript-path.test.ts`<br>`apps/daemon/test/runner-issue-fence.test.ts`<br>`apps/daemon/test/runner-recover-degrade.test.ts`<br>`apps/server/test/machine-pin.test.ts`<br>`packages/shared/test/confirmed-plan-note.test.ts`<br>`packages/shared/test/issue-fence.test.ts` |
| [#1313](https://github.com/xiechimon/pacman/issues/1313) web/server: review 期零实质改动的卡没有「不合并」收口——「完成」强制 merge conv 分支且要 agent 合并授权 | 差异化面 | 已做 | `docs/verify/1313/`<br>`apps/server/test/delivery-surface.test.ts`<br>`apps/web/e2e/empty-review-closeout.spec.ts` |
| [#1316](https://github.com/xiechimon/pacman/issues/1316) daemon: git 2.43.0 rejects reset --hard --end-of-options | 差异化面 | 已做 | `docs/verify/1316/`<br>`apps/daemon/test/git.test.ts`<br>`apps/daemon/test/sync.test.ts` |
| [#1404](https://github.com/xiechimon/pacman/issues/1404) server,shared,daemon: 自举闭环 P3 合并就绪闸（判定绑 patchDigest、自动审核与验证、chief go/no-go、pacman/merge-gate） | 差异化面 | 在跑 | `docs/verify/1404/`<br>`apps/server/test/github-gate-transport.test.ts`<br>`apps/server/test/merge-gate-digest.test.ts`<br>`apps/server/test/merge-gate-evidence-link.test.ts`<br>`apps/server/test/merge-gate-imports.test.ts`<br>`apps/server/test/merge-gate-paths.test.ts`<br>`apps/server/test/merge-gate-readiness.test.ts`<br>`apps/server/test/merge-gate-tables.test.ts`<br>`apps/server/test/schema.test.ts`<br>`packages/shared/test/snapshot.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1440](https://github.com/xiechimon/pacman/issues/1440) 合并闸：人类裁决待定时 PR 仍被 auto-merge 合入（#1435 事故，needs-decision 标签 + pr-evidence 必需检查） | 差异化面 | 已做 | `docs/verify/1440/` |
| [#1442](https://github.com/xiechimon/pacman/issues/1442) web: axe-core accessibility gate in e2e, and the violations it finds | 差异化面 | 已做 | `docs/verify/1442/`<br>`apps/web/e2e/a11y-axe.spec.ts` |
| [#1457](https://github.com/xiechimon/pacman/issues/1457) shared: one rule for which phases can start, so the board cannot offer a drop the server rejects | 差异化面 | 已做 | `docs/verify/1457/`<br>`apps/server/test/github-reads.test.ts`<br>`apps/server/test/issue-intake.test.ts`<br>`apps/web/test/columns.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1492](https://github.com/xiechimon/pacman/issues/1492) server,daemon: plan 结构契约（Verification 必须可机器校验）+ 报告兜底 + 票 dedupeKey | 差异化面 | 已做 | `docs/verify/1492/`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/persona-split-verify.test.ts`<br>`packages/shared/test/plan-contract-prompt.test.ts`<br>`packages/shared/test/plan-contract.test.ts`<br>`packages/shared/test/ticket-dedupe.test.ts`<br>`packages/shared/test/verify-prompt.test.ts` |
| [#16](https://github.com/xiechimon/pacman/issues/16) 研究：上游核心近读 — agent loop / bus / session / memory | 运行轴 | 已做 | `apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#25](https://github.com/xiechimon/pacman/issues/25) 设计：agent core TS 化（loop / runner / bus / session / memory） | 运行轴 | 已做 | `apps/server/test/rework-plan-fallback.test.ts`<br>`apps/server/test/second-pr-guard.test.ts` |
| [#27](https://github.com/xiechimon/pacman/issues/27) 设计：providers 路由 + config + security + CLI TS 化 | 运行轴 | 已做 | `integration/test/board-trio-e2e.test.ts` |
| [#37](https://github.com/xiechimon/pacman/issues/37) 研究：协议面与 executor 行为观察（API/WS 词表、MCP、tds start、BYOK/OAuth 面） | 运行轴 | 未验证 | [未验证] |
| [#41](https://github.com/xiechimon/pacman/issues/41) 设计：架构平价（编排/executor/MCP/密钥/通知） | 运行轴 | 未验证 | [未验证] |
| [#79](https://github.com/xiechimon/pacman/issues/79) M3a daemon 骨架（T2 时间盒）：AgentBackend 缝 + machine 协议 + upload-urls | 运行轴 | 已做 | `integration/test/m3a-demo.test.ts` |
| [#80](https://github.com/xiechimon/pacman/issues/80) M3b daemon 深面：worktree 契约 + step 三类 + merge 202（单机生命周期实跑） | 运行轴 | 已做 | `integration/test/m3b-demo.test.ts` |
| [#82](https://github.com/xiechimon/pacman/issues/82) M4b 编排深面：memory 写路径 + MCP 双面 + watch/wake 三触发 | 运行轴 | 未验证 | [未验证] |
| [#109](https://github.com/xiechimon/pacman/issues/109) 品牌槽切换：tds 族 → pacman 族（素材替换计划 D3 触发：与正版 todos.dev 同机共存冲突，提前执行） | 运行轴 | 已做 | `apps/server/test/git-hosting.test.ts`<br>`apps/web/test/i18n.test.ts`<br>`apps/web/test/pwa.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#179](https://github.com/xiechimon/pacman/issues/179) grilling: 机器添加弹窗形态——配额墙 vs CLI 两步(local-first 裁决) | 运行轴 | 已做 | `apps/web/e2e/machine-add-dialog.spec.ts` |
| [#181](https://github.com/xiechimon/pacman/issues/181) task: 机器添加弹窗实现 | 运行轴 | 已做 | `apps/web/e2e/machine-add-dialog.spec.ts` |
| [#222](https://github.com/xiechimon/pacman/issues/222) task: 机器行内三动作承接——语义考古 + 端点核 + 接线(#200 裁决) | 运行轴 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts` |
| [#262](https://github.com/xiechimon/pacman/issues/262) task: cli 包改名 @xiechimon/pacman-cli + publishConfig(W2) | 运行轴 | 未验证 | [未验证] |
| [#266](https://github.com/xiechimon/pacman/issues/266) task: 首发执行 0.1.0——干净环境全链实测 + publish(W2) | 运行轴 | 未验证 | [未验证] |
| [#278](https://github.com/xiechimon/pacman/issues/278) task: steer 服务端写面——conversations POST 扩 build conv + pending 持面 + machine 投递通道(W3) | 运行轴 | 已做 | `apps/server/test/steer.test.ts`<br>`apps/server/test/stop.test.ts`<br>`integration/test/w3-steer-e2e.test.ts` |
| [#279](https://github.com/xiechimon/pacman/issues/279) task: steer daemon 接线——wake 事件→拉取→AgentSessionHandle.steer(W3) | 运行轴 | 已做 | `apps/daemon/test/machine-steer.test.ts`<br>`integration/test/w3-steer-e2e.test.ts` |
| [#285](https://github.com/xiechimon/pacman/issues/285) task: 浏览器授权页 /app/machines/authorize——enroll/start/poll 的 web 面(W4) | 运行轴 | 已做 | `apps/server/test/enroll-browser.test.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/machine-authorize.spec.ts` |
| [#297](https://github.com/xiechimon/pacman/issues/297) task: cli 代理 shell 下 machine API 401——undici 代理路径丢鉴权(env -u 痊愈,首发实测) | 运行轴 | 已做 | `apps/daemon/test/proxy.test.ts` |
| [#307](https://github.com/xiechimon/pacman/issues/307) M7-W2 外链型按钮处置（keys-docs/res-doclink/create-agent-swap/prj-set-change） | 运行轴 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts` |
| [#308](https://github.com/xiechimon/pacman/issues/308) M7 composer 停止钮：steer 全链（前端 + server + daemon） | 运行轴 | 已做 | `docs/verify/308/`<br>`apps/daemon/test/machine-stop.test.ts`<br>`apps/daemon/test/runner-stop.test.ts`<br>`apps/server/test/stop.test.ts`<br>`apps/server/test/wire.test.ts`<br>`integration/test/m7-failed-send-e2e.test.ts`<br>`integration/test/m7-stop-e2e.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#319](https://github.com/xiechimon/pacman/issues/319) M7-W5 分支同步全链：分支对话框「同步到机器」（机器选择 + 执行 + 结果卡） | 运行轴 | 已做 | `docs/verify/319/`<br>`apps/daemon/test/runner-artifact.test.ts`<br>`apps/daemon/test/runner-stop.test.ts`<br>`apps/daemon/test/runner-upload-recovery.test.ts`<br>`apps/server/test/wire.test.ts`<br>`integration/test/m7-branch-dialog-e2e.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#350](https://github.com/xiechimon/pacman/issues/350) 模型服务/机器页「按钮不可点」复报 = 行可点感误导（实测无遮挡） | 运行轴 | 未验证 | [未验证] |
| [#354](https://github.com/xiechimon/pacman/issues/354) verify feature map 扩三面（providers tabs / machines 本机行+switches / picker dialog） | 运行轴 | 已做 | `docs/verify/354/` |
| [#356](https://github.com/xiechimon/pacman/issues/356) providers runtime tabs + model-sources 端点 | 运行轴 | 已做 | `docs/verify/356/`<br>`apps/server/test/model-sources.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/providers-tabs.spec.ts`<br>`apps/web/test/model-options.test.ts` |
| [#357](https://github.com/xiechimon/pacman/issues/357) machines 本地化（本机基线 + per-runtime switches + schema 两列） | 运行轴 | 已做 | `docs/verify/357/`<br>`apps/server/test/machine-local.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/machines-local.spec.ts` |
| [#362](https://github.com/xiechimon/pacman/issues/362) G2-T2 daemon executor（local 镜像 clone + GitHub per-step token） | 运行轴 | 已做 | `apps/daemon/test/local-executor.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/server/test/g2t2-executor-wire.test.ts`<br>`integration/test/g2t2-local-lifecycle.test.ts` |
| [#368](https://github.com/xiechimon/pacman/issues/368) T2: MCP 本地 config 面（~/.claude.json + machine-wire slug 化 + drop mcp_server 表） | 运行轴 | 已做 | `docs/verify/368/`<br>`apps/daemon/test/config-state.test.ts`<br>`apps/daemon/test/mcp-config.test.ts`<br>`apps/server/test/legacy-export.test.ts`<br>`apps/server/test/mcp-servers.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`integration/test/m4b-mcp-e2e.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#371](https://github.com/xiechimon/pacman/issues/371) T3: skills 执行面注入（daemon loadSkills + catalog 注入 systemPrompt + read 工具白名单） | 运行轴 | 已做 | `apps/daemon/test/config-state.test.ts`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#372](https://github.com/xiechimon/pacman/issues/372) T4: skills catalog per-agent 运行时筛选（daemon 按 agent.skills 白名单过滤） | 运行轴 | 已做 | `apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/skill-inject-claim.test.ts`<br>`integration/test/skills-inject-e2e.test.ts` |
| [#423](https://github.com/xiechimon/pacman/issues/423) 第一片落地执行 | 运行轴 | 已做 | `docs/verify/423/` |
| [#425](https://github.com/xiechimon/pacman/issues/425) B1 执行：弹层族收编 shadcn Dialog（19 挂载点） | 运行轴 | 已做 | `docs/verify/425/`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#435](https://github.com/xiechimon/pacman/issues/435) #412 执行：值正本并流 + tokens.css 降别名 + 死 token 清理 + 一次性视觉重钉 | 运行轴 | 未验证 | [未验证] |
| [#468](https://github.com/xiechimon/pacman/issues/468) ⌘J 改 toggle（可开可关）+ 机器人 FAB/快捷键控件悬浮 kbd 提示 | 运行轴 | 已做 | `apps/web/e2e/hotkeys.spec.ts` |
| [#471](https://github.com/xiechimon/pacman/issues/471) spinner 动起来 + 静止态 live 线索 | 运行轴 | 已做 | `apps/daemon/test/activity.test.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/spinner-live.spec.ts`<br>`apps/web/test/activity-live-row.test.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`apps/web/test/transcript-quiescent.test.ts` |
| [#482](https://github.com/xiechimon/pacman/issues/482) daemon machine-loop：flight.claim 声明后从未赋值——「SSE wake 中断在飞 claim 立即重发」兜底是死代码 | 运行轴 | 已做 | `apps/daemon/test/machine-claim.test.ts` |
| [#503](https://github.com/xiechimon/pacman/issues/503) web: 机器行 runtime 开关换成官方品牌 mark；并发上限 maxConcurrent 连概念摘除 | 运行轴 | 已做 | `docs/verify/503/`<br>`apps/web/e2e/machines-local.spec.ts`<br>`apps/web/e2e/machines-shell-switch.spec.ts` |
| [#508](https://github.com/xiechimon/pacman/issues/508) daemon: 团队密钥注入面——现为半成品（服务端下发后 daemon 丢弃），按 UI 文案接线即留下长期明文 env 暴露 | 运行轴 | 已做 | `apps/daemon/test/secret-channel.test.ts`<br>`apps/web/e2e/agent-detail.spec.ts` |
| [#518](https://github.com/xiechimon/pacman/issues/518) 研究：pacman 与 Multica runtime 模型的能力差距盘点 | 运行轴 | 未验证 | [未验证] |
| [#521](https://github.com/xiechimon/pacman/issues/521) 任务：按主张与实测重排 backlog 并出执行票 | 运行轴 | 未验证 | [未验证] |
| [#622](https://github.com/xiechimon/pacman/issues/622) daemon(claude-code): 第二运行时最小闭环——SDK 桥、per-step 解析、零凭据通道 | 运行轴 | 已做 | `docs/verify/622/`<br>`apps/daemon/test/claude-transcript-path.test.ts`<br>`apps/daemon/test/map-claude-event.test.ts`<br>`apps/daemon/test/runner-runtime.test.ts`<br>`apps/server/test/provider-config.test.ts` |
| [#640](https://github.com/xiechimon/pacman/issues/640) 落 XMON-98 拍板点 1：父卡不引入、开始任务面撤销选择、子卡带编排来源字段 | 运行轴 | 已做 | `docs/verify/640/`<br>`apps/server/test/conv-stream-catchup.test.ts`<br>`apps/server/test/orchestration-source.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/test/dnd.test.ts`<br>`integration/test/board-trio-e2e.test.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`packages/shared/test/records.test.ts` |
| [#645](https://github.com/xiechimon/pacman/issues/645) Chief drawer: bind N to the new-session button, scoped to the open drawer | 运行轴 | 已做 | `docs/verify/645/`<br>`apps/web/e2e/hotkeys.spec.ts` |
| [#647](https://github.com/xiechimon/pacman/issues/647) daemon(claude-code): T4 工具面接线——remoteTools/localTools/mcpServers 经 createSdkMcpServer in-process 回调，总管步不再撞 fail-closed | 运行轴 | 已做 | `docs/verify/647/`<br>`apps/daemon/test/claude-t4-tools.test.ts`<br>`apps/daemon/test/runner-runtime.test.ts` |
| [#654](https://github.com/xiechimon/pacman/issues/654) daemon(pi)+server+shared: relay 协议 400 自适配——compat 旋钮物化 + 按错误回落，deepseek-v4.1-flash[1M] 通道零失败 | 运行轴 | 已做 | `docs/verify/654/`<br>`apps/daemon/test/pi-config-effect.test.ts`<br>`apps/daemon/test/pi-protocol-fallback.test.ts`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/server/test/provider-config.test.ts` |
| [#656](https://github.com/xiechimon/pacman/issues/656) web: 全站动效收敛 shadcn 默认——方向 B 逐域执行票（ADR 0009，motion.css 复刻 registry 退役） | 运行轴 | 已做 | `docs/verify/656/`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#667](https://github.com/xiechimon/pacman/issues/667) web: chief drawer renders two user bubbles per turn — POST row vs daemon transcript echo row, dedup on the read side | 运行轴 | 已做 | `docs/verify/667/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`apps/web/test/chief-user-echo.test.ts` |
| [#684](https://github.com/xiechimon/pacman/issues/684) server: chief turn invisible when no machine ever claims it — pending/claimed steps hang forever after daemon death | 运行轴 | 已做 | `docs/verify/684/`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/chief-abandoned-sweep.test.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#691](https://github.com/xiechimon/pacman/issues/691) daemon 进程 10-02 23:04 自行退出且无痕（非用户终止）——查死因 | 运行轴 | 已做 | `docs/verify/691/`<br>`apps/daemon/test/machine-boot.test.ts`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`integration/test/crash-recover.test.ts`<br>`integration/test/m4b-watch-wake-e2e.test.ts` |
| [#699](https://github.com/xiechimon/pacman/issues/699) daemon: 540s streamBodyTimeout wall kills healthy long steps — activity-reset the body arm and name the real killer (B-C9) | 运行轴 | 已做 | `docs/verify/699/`<br>`apps/daemon/test/runner-stream-timeout.test.ts` |
| [#706](https://github.com/xiechimon/pacman/issues/706) server: build-step liveness sweeper — bounded visible failure when the machine is gone (B-C7) | 运行轴 | 已做 | `docs/verify/706/`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/schedules.test.ts` |
| [#708](https://github.com/xiechimon/pacman/issues/708) daemon,server: surface step failure root cause and unify auto_retry lifecycles (B-C2 residuals) | 运行轴 | 已做 | `docs/verify/708/`<br>`apps/daemon/test/map-pi-event.test.ts`<br>`apps/daemon/test/pi-config-effect.test.ts`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/daemon/test/runner-quota-breaker.test.ts` |
| [#720](https://github.com/xiechimon/pacman/issues/720) daemon: 失败重启轮的 feedback 指令不进会话——用户填的返工理由 agent 看不到（#703 侦察期发现） | 运行轴 | 已做 | `docs/verify/720/`<br>`apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/daemon/test/runner-restart-prompt.test.ts`<br>`apps/server/test/second-pr-guard.test.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`integration/test/m7-failed-send-e2e.test.ts`<br>`integration/test/restart-blank-feedback-e2e.test.ts`<br>`integration/test/rework-branch-reuse-e2e.test.ts`<br>`packages/shared/test/plan-first-round-prompt.test.ts`<br>`packages/shared/test/restart-prompt.test.ts`<br>`packages/shared/test/work-branch-note.test.ts` |
| [#729](https://github.com/xiechimon/pacman/issues/729) web: paste clipboard images into composer and new-task spec via the existing attachment chain | 运行轴 | 已做 | `docs/verify/729/`<br>`apps/web/e2e/attachment-strip.spec.ts`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/composer-paste.spec.ts`<br>`apps/web/test/attachment-paste.test.ts`<br>`apps/web/test/attachments-client.test.ts` |
| [#730](https://github.com/xiechimon/pacman/issues/730) daemon,server: make image attachments visible to the worker agent (real pixels, not base64 text) | 运行轴 | 已做 | `docs/verify/730/`<br>`apps/daemon/test/backend-image-delivery.test.ts`<br>`apps/daemon/test/machine-steer.test.ts`<br>`apps/daemon/test/runner-images.test.ts`<br>`apps/daemon/test/step-attachments.test.ts`<br>`apps/server/test/machine-attachment.test.ts`<br>`packages/shared/test/attachment-token.test.ts` |
| [#741](https://github.com/xiechimon/pacman/issues/741) web: click an agent identity to open its settings — chief drawer chip + agent mention chips route to the agent detail page | 运行轴 | 已做 | `docs/verify/741/`<br>`apps/web/e2e/agent-identity-chip.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-identity.test.ts`<br>`apps/web/test/segments-mention-nav.test.ts` |
| [#758](https://github.com/xiechimon/pacman/issues/758) web: 新建任务对话框的机器 chip 无持久化记忆（项目 chip 有） | 运行轴 | 已做 | `docs/verify/758/` |
| [#770](https://github.com/xiechimon/pacman/issues/770) web: 模型选择器去掉「自有 relay」段——只留 Claude Code 等 runtime 源（用户已裁不要） | 运行轴 | 已做 | `docs/verify/770/`<br>`apps/server/test/chief-tools.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/test/model-options.test.ts` |
| [#861](https://github.com/xiechimon/pacman/issues/861) 对齐 AMP：远程编排（本机可关）+ 单机编排者 + 沙箱形态调研 | 运行轴 | 已做 | `apps/server/test/machine-stale-sweep.test.ts` |
| [#862](https://github.com/xiechimon/pacman/issues/862) AMP对齐T1：跨机续跑最小闭环 | 运行轴 | 已做 | `docs/verify/862/`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/machine-stale-sweep.test.ts`<br>`integration/test/crash-recover.test.ts` |
| [#863](https://github.com/xiechimon/pacman/issues/863) AMP对齐T2：会话亲和 | 运行轴 | 已做 | `docs/verify/863/`<br>`apps/server/test/machine-wire.test.ts` |
| [#864](https://github.com/xiechimon/pacman/issues/864) AMP对齐T3：离线钉选超时策略 | 运行轴 | 已做 | `docs/verify/864/`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/machine-stale-sweep.test.ts` |
| [#865](https://github.com/xiechimon/pacman/issues/865) AMP对齐T4：单机编排默认策略 | 运行轴 | 已做 | `docs/verify/865/` |
| [#867](https://github.com/xiechimon/pacman/issues/867) AMP对齐T6：跨机凭据预检 | 运行轴 | 已做 | `docs/verify/867/`<br>`apps/daemon/test/claude-code-auth.test.ts`<br>`apps/daemon/test/machine-backends.test.ts`<br>`apps/daemon/test/map-claude-event.test.ts`<br>`apps/daemon/test/runner-runtime.test.ts` |
| [#881](https://github.com/xiechimon/pacman/issues/881) server: 收口「有界等待」的剩余两条缝（钉选在线但 runtime 被挡 / 会话机器在线但卡死） | 运行轴 | 已做 | `docs/verify/881/`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/chief-abandoned-sweep.test.ts`<br>`apps/server/test/machine-stale-sweep.test.ts` |
| [#882](https://github.com/xiechimon/pacman/issues/882) daemon: 撞到非 SSE 端点时要点名真实响应形态，而不是笼统 `Stream ended` | 运行轴 | 已做 | `docs/verify/882/`<br>`apps/daemon/test/map-pi-event.test.ts`<br>`apps/daemon/test/provider-response.test.ts`<br>`packages/shared/test/task-failure.test.ts` |
| [#887](https://github.com/xiechimon/pacman/issues/887) web: 机器卡 runtime 只留图标，去掉 pi / Claude Code 的文字名 | 运行轴 | 已做 | `docs/verify/887/`<br>`apps/web/e2e/machines-local.spec.ts` |
| [#895](https://github.com/xiechimon/pacman/issues/895) server+web: 单机编排默认策略（T4 实现）——主力机默认钉选 + machines 页三态标注 | 运行轴 | 已做 | `apps/server/test/machine-pin.test.ts`<br>`apps/web/e2e/machines-chief-state.spec.ts`<br>`packages/shared/test/records.test.ts` |
| [#913](https://github.com/xiechimon/pacman/issues/913) 批次表 v2：逐域拆批、验收模板 v2 与并行车道编排 | 运行轴 | 未验证 | [未验证] |
| [#915](https://github.com/xiechimon/pacman/issues/915) 新色板 token 值翻转与明暗双模封版执行（C · 纸兰定版） | 运行轴 | 已做 | `docs/verify/915/`<br>`apps/web/e2e/sidebar-nav.spec.ts`<br>`apps/web/e2e/sidebar-visual.spec.ts` |
| [#917](https://github.com/xiechimon/pacman/issues/917) server+daemon: 技能可见面收归 pacman —— 关 Skill 工具面 / 目录全量 / 显式 settingSources / 白名单硬挡 | 运行轴 | 已做 | `docs/verify/917/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/runner-brief.test.ts`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/daemon/test/skills-hard-block.test.ts`<br>`apps/daemon/test/skills-native-plugin.test.ts`<br>`apps/server/test/skill-inject-claim.test.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`integration/test/skills-routing-e2e.test.ts` |
| [#918](https://github.com/xiechimon/pacman/issues/918) web+daemon: 活行与详情显示「读了哪些技能」（含被 deny 挡下的事件） | 运行轴 | 已做 | `docs/verify/918/`<br>`apps/daemon/test/activity.test.ts`<br>`apps/server/test/m5-face.test.ts`<br>`apps/web/e2e/skills-routing.spec.ts`<br>`apps/web/test/activity-live-row.test.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`packages/shared/test/skill-facts.test.ts` |
| [#920](https://github.com/xiechimon/pacman/issues/920) server+daemon: 远端技能分发改成「清单 + 按需拉」，空清单必须显式报错 | 运行轴 | 已做 | `docs/verify/920/`<br>`apps/daemon/test/pi-protocol-fallback.test.ts`<br>`apps/daemon/test/runner-artifact.test.ts`<br>`apps/daemon/test/runner-brief.test.ts`<br>`apps/daemon/test/runner-create-tag.test.ts`<br>`apps/daemon/test/runner-delivery.test.ts`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/daemon/test/runner-images.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/runner-restart-prompt.test.ts`<br>`apps/daemon/test/runner-review.test.ts`<br>`apps/daemon/test/runner-runtime.test.ts`<br>`apps/daemon/test/runner-silent-noop.test.ts`<br>`apps/daemon/test/runner-stop.test.ts`<br>`apps/daemon/test/runner-stream-timeout.test.ts`<br>`apps/daemon/test/runner-team-skills.test.ts`<br>`apps/daemon/test/secret-channel.test.ts`<br>`apps/daemon/test/shell-channel.test.ts`<br>`apps/daemon/test/skills-native-plugin.test.ts`<br>`apps/daemon/test/skills-version-skew.test.ts`<br>`apps/daemon/test/team-skills.test.ts`<br>`apps/server/test/skill-import.test.ts`<br>`apps/server/test/skill-write.test.ts`<br>`integration/test/skills-routing-e2e.test.ts` |
| [#923](https://github.com/xiechimon/pacman/issues/923) daemon: pi 依赖 0.86.0 → 1.0.3（跨大版本；导入面已实测兼容，锁文件改动需排在合并队列之后） | 运行轴 | 已做 | `docs/verify/923/`<br>`integration/test/crash-recover.test.ts` |
| [#925](https://github.com/xiechimon/pacman/issues/925) daemon: pi 会话的运行面与信任面显式化（project trust / telemetry / settings 被 inMemory 整体绕过） | 运行轴 | 已做 | `docs/verify/925/`<br>`apps/daemon/test/pi-session-policy.test.ts`<br>`integration/test/pi-session-policy.test.ts` |
| [#926](https://github.com/xiechimon/pacman/issues/926) daemon: 重试与收敛时序显式化（retry.* 未接、agent_settled 取代 willRetry 猜测） | 运行轴 | 已做 | `docs/verify/926/`<br>`apps/daemon/test/map-pi-event.test.ts`<br>`apps/daemon/test/pi-retry-config.test.ts`<br>`apps/daemon/test/runner-error-lifecycle.test.ts` |
| [#927](https://github.com/xiechimon/pacman/issues/927) daemon: 成本可见性（usage 已在用、cost 未接；缓存保留未设） | 运行轴 | 已做 | `apps/daemon/test/map-pi-event.test.ts`<br>`apps/daemon/test/pi-config-effect.test.ts`<br>`apps/daemon/test/pi-session-policy.test.ts`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`integration/test/pi-session-policy.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#930](https://github.com/xiechimon/pacman/issues/930) daemon: MCP 桥改用 pi 原生 MCP（registerMcpServer/createMcpExtension；解析层保留） | 运行轴 | 已做 | `apps/daemon/test/mcp-config.test.ts`<br>`apps/daemon/test/pi-mcp-attention.test.ts`<br>`integration/test/m4b-mcp-e2e.test.ts` |
| [#931](https://github.com/xiechimon/pacman/issues/931) server+daemon: 有 PR 的任务返工要回到原分支/原 PR —— 失败重启现在另起新会话、孤儿化原 PR | 运行轴 | 已做 | `docs/verify/931/`<br>`apps/server/test/ci-loop.test.ts`<br>`apps/server/test/pr-reconcile.test.ts`<br>`apps/server/test/rework-branch-reuse.test.ts`<br>`apps/server/test/second-pr-guard.test.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`integration/test/rework-branch-reuse-e2e.test.ts` |
| [#955](https://github.com/xiechimon/pacman/issues/955) daemon,server,web: 总管过程按事件边界实时封段——流式期分行，工具与思考各成一行 | 运行轴 | 已做 | `docs/verify/955/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/segment.test.ts`<br>`apps/server/test/conv-stream-catchup.test.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-segments.test.ts` |
| [#958](https://github.com/xiechimon/pacman/issues/958) daemon,server: write the step brief into the worktree and let each CLI load it natively (supersedes spec 17 A9) | 运行轴 | 已做 | `apps/daemon/test/runner-brief.test.ts`<br>`apps/daemon/test/workspace.test.ts`<br>`integration/test/skills-inject-e2e.test.ts` |
| [#982](https://github.com/xiechimon/pacman/issues/982) registry 件漂移审计：17 件 CLI 同源件逐件 diff 上游，本地偏离判去留 | 运行轴 | 已做 | `apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts` |
| [#991](https://github.com/xiechimon/pacman/issues/991) 批次表：全量原型一次性落地 + 实审后挂跑施工的车道编排 | 运行轴 | 已做 | `apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/spec-brief-card.spec.ts` |
| [#1003](https://github.com/xiechimon/pacman/issues/1003) 批次 0b：registry 对齐前置——漂移件重拉、scale-fade 退役、chat 原语锁、段序 pin | 运行轴 | 已做 | `docs/verify/1003/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/shadcn-primitives.spec.ts` |
| [#1028](https://github.com/xiechimon/pacman/issues/1028) daemon: 预签名上传 URL 只存内存，重启即 404（恢复只能整会话重跑） | 运行轴 | 已做 | `apps/daemon/test/runner-upload-recovery.test.ts`<br>`integration/test/plan-upload-recovery.test.ts` |
| [#1029](https://github.com/xiechimon/pacman/issues/1029) daemon: document_diff 是死 schema（从未写入，diff 端点现算） | 运行轴 | 已做 | `apps/server/test/project-delete.test.ts`<br>`apps/server/test/schema.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1050](https://github.com/xiechimon/pacman/issues/1050) daemon,shared,web: claude-code 可用性事实源——探二进制与版本，providers 页五态 | 运行轴 | 已做 | `docs/verify/1050/`<br>`apps/daemon/test/claude-code-bin.test.ts`<br>`apps/daemon/test/skills-native-plugin.test.ts`<br>`apps/server/test/model-sources.test.ts`<br>`apps/web/e2e/providers-tabs.spec.ts` |
| [#1056](https://github.com/xiechimon/pacman/issues/1056) chief: 悬浮窗草稿跨整页刷新持久化（Multica 对齐，#1009 A0 实审 spin-off） | 运行轴 | 已做 | `docs/verify/1056/`<br>`apps/web/e2e/chief-draft-persist.spec.ts` |
| [#1065](https://github.com/xiechimon/pacman/issues/1065) daemon: 僵尸认领——机器被杀后服务端 waitWake 仍在 75s 内替死机器认领新步 | 运行轴 | 已做 | `docs/verify/1065/`<br>`apps/server/test/machine-zombie-claim.test.ts` |
| [#1108](https://github.com/xiechimon/pacman/issues/1108) server+daemon+web: 机器并发上限与排队可见——超 N 才排队，排队呈现位次与等待对象 | 运行轴 | 已做 | `docs/verify/1108/`<br>`apps/daemon/test/machine-parallel.test.ts`<br>`apps/server/test/capability-pending-reason.test.ts`<br>`apps/server/test/machine-concurrency.test.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/machines-local.spec.ts`<br>`apps/web/e2e/machines-shell-switch.spec.ts`<br>`apps/web/e2e/queued-action.spec.ts`<br>`apps/web/test/activity-live-row.test.ts` |
| [#1125](https://github.com/xiechimon/pacman/issues/1125) server: split routes.ts into per-domain registration modules (routes-machine.ts precedent) | 运行轴 | 已做 | `docs/verify/1125/` |
| [#1128](https://github.com/xiechimon/pacman/issues/1128) test: split chief.test.ts and machine-loop.test.ts by scenario | 运行轴 | 已做 | `docs/verify/1128/`<br>`apps/daemon/test/machine-backends.test.ts`<br>`apps/daemon/test/machine-boot.test.ts`<br>`apps/daemon/test/machine-claim.test.ts`<br>`apps/daemon/test/machine-parallel.test.ts`<br>`apps/daemon/test/machine-recover.test.ts`<br>`apps/daemon/test/machine-steer.test.ts`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/machine-stop.test.ts`<br>`apps/server/test/chief-dispatch.test.ts`<br>`apps/server/test/chief-memory.test.ts`<br>`apps/server/test/chief-reject-diff.test.ts`<br>`apps/server/test/chief-settings.test.ts`<br>`apps/server/test/chief-thread.test.ts`<br>`apps/server/test/chief-tools.test.ts`<br>`apps/server/test/chief-watch.test.ts` |
| [#1136](https://github.com/xiechimon/pacman/issues/1136) server: 机器行陈旧判定——presence 落 lastSeenAt + 阈值扫掠翻 offline | 运行轴 | 已做 | `docs/verify/1136/`<br>`apps/server/test/machine-stale-sweep.test.ts` |
| [#1137](https://github.com/xiechimon/pacman/issues/1137) server: 事件入口 tracer——GitHub webhook → 建 todo + orchestrate | 运行轴 | 已做 | `docs/verify/1137/`<br>`apps/server/test/schema.test.ts`<br>`apps/server/test/webhook.test.ts`<br>`apps/server/test/wire.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1141](https://github.com/xiechimon/pacman/issues/1141) web: chief 悬浮窗全站可达——摘掉 agent 详情页与机器授权页的抑制路由 | 运行轴 | 已做 | `apps/web/e2e/hotkeys.spec.ts` |
| [#1147](https://github.com/xiechimon/pacman/issues/1147) Map: 持续派发环与机器可丢——chief 不占槽、环境钩子、CI 磨绿、状态离机 | 运行轴 | 已做 | `docs/verify/1147/` |
| [#1148](https://github.com/xiechimon/pacman/issues/1148) daemon: chief 步不占并发槽 + 端口基座 PACMAN_PORT_BASE + 上限 env 兜底 | 运行轴 | 已做 | `docs/verify/1148/`<br>`apps/daemon/test/machine-parallel-chief.test.ts`<br>`apps/daemon/test/machine-parallel.test.ts`<br>`apps/daemon/test/skills-hard-block.test.ts`<br>`apps/server/test/machine-concurrency-chief.test.ts`<br>`integration/test/port-base-e2e.test.ts` |
| [#1149](https://github.com/xiechimon/pacman/issues/1149) daemon: 环境生命周期钩子 .agents/setup 与 .agents/resume | 运行轴 | 已做 | `docs/verify/1149/`<br>`apps/daemon/test/config-state.test.ts`<br>`apps/daemon/test/workspace-hooks.test.ts`<br>`apps/daemon/test/workspace.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1152](https://github.com/xiechimon/pacman/issues/1152) docs: localPath 降级「单机器缓存」标注 + 机器可丢 ADR | 运行轴 | 已做 | `docs/verify/1152/`<br>`apps/web/e2e/project-new-fs-pick.spec.ts` |
| [#1171](https://github.com/xiechimon/pacman/issues/1171) 物化团队技能落进 CLI 原生技能目录（claude 后端 Skill 机制原生可见） | 运行轴 | 已做 | `docs/verify/1171/`<br>`apps/daemon/test/skills-native-plugin.test.ts` |
| [#1175](https://github.com/xiechimon/pacman/issues/1175) web: 机器行「已授权远程 shell」常驻副行改挂 shell 开关的 tooltip（hover 弹出） | 运行轴 | 已做 | `docs/verify/1175/`<br>`apps/web/e2e/machines-local.spec.ts` |
| [#1186](https://github.com/xiechimon/pacman/issues/1186) skills: 技能注入面三前置条件的机器断言（真实派发收尾核对；只做机器可判那半） | 运行轴 | 已做 | `docs/verify/1186/`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/server/test/skill-injection-check.test.ts`<br>`packages/shared/test/skill-injection-check.test.ts` |
| [#1210](https://github.com/xiechimon/pacman/issues/1210) local-repo projects cannot build on remote machines: chief silently re-dispatches to the repo host | 运行轴 | 已做 | `docs/verify/1210/`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/workspace-local-unreachable.test.ts` |
| [#1213](https://github.com/xiechimon/pacman/issues/1213) 双执行源落地：github 形态项目加挂 localPath 同机加速位（ADR 0017） | 运行轴 | 已做 | `docs/verify/1213/`<br>`apps/daemon/test/workspace-source.test.ts`<br>`apps/server/test/project-dual-source.test.ts`<br>`apps/server/test/project-identity.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-settings-local-path.spec.ts` |
| [#1225](https://github.com/xiechimon/pacman/issues/1225) daemon: push/clone auth should fall back to the executing machine's own git credentials when the per-step integration token is invalid | 运行轴 | 已做 | `docs/verify/1225/`<br>`apps/daemon/test/git.test.ts`<br>`apps/daemon/test/runner-cred-fallback.test.ts`<br>`apps/daemon/test/workspace-cred-fallback.test.ts` |
| [#1241](https://github.com/xiechimon/pacman/issues/1241) daemon/server: machine concurrency cap derived from machine capability, not a fixed number | 运行轴 | 已做 | `docs/verify/1241/`<br>`apps/daemon/test/machine-capabilities.test.ts`<br>`apps/server/test/machine-concurrency-backfill.test.ts`<br>`apps/server/test/machine-concurrency-recommendation.test.ts`<br>`apps/server/test/machine-concurrency-startup-backfill.test.ts`<br>`apps/web/e2e/machines-concurrency-source.spec.ts`<br>`apps/web/e2e/machines-shell-switch.spec.ts`<br>`packages/shared/test/machine-capabilities.test.ts` |
| [#1257](https://github.com/xiechimon/pacman/issues/1257) server,scheduler: 认领超时不判死 build——挂起等机器，照 Multica 的存活门限语义 | 运行轴 | 已做 | `docs/verify/1257/`<br>`apps/daemon/test/runner-network-retry.test.ts`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/capability-pending-reason.test.ts`<br>`apps/server/test/chief-abandoned-sweep.test.ts`<br>`apps/server/test/chief-demotion.test.ts`<br>`apps/server/test/queued-cancel-release.test.ts`<br>`apps/server/test/quota-hold.test.ts`<br>`apps/web/e2e/detail-queued-exit.spec.ts`<br>`apps/web/test/sse-team-events.test.ts`<br>`packages/shared/test/task-failure.test.ts` |
| [#1259](https://github.com/xiechimon/pacman/issues/1259) agent 绑定归属机（worker 面）+ 机器生命周期出口 + 机器详情页闭环 | 运行轴 | 已做 | `docs/verify/1259/`<br>`apps/server/test/agent-concurrency.test.ts`<br>`apps/server/test/agent-home-machine.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/build-abandoned-sweep.test.ts`<br>`apps/server/test/capability-pending-reason.test.ts`<br>`apps/server/test/delivery-surface.test.ts`<br>`apps/server/test/failed-review-restore.test.ts`<br>`apps/server/test/g2t2-executor-wire.test.ts`<br>`apps/server/test/github-issues.test.ts`<br>`apps/server/test/github-writeback.test.ts`<br>`apps/server/test/m3b-machine-git.test.ts`<br>`apps/server/test/m4b-memory.test.ts`<br>`apps/server/test/m5-face.test.ts`<br>`apps/server/test/machine-attachment.test.ts`<br>`apps/server/test/machine-capability-gate.test.ts`<br>`apps/server/test/machine-concurrency.test.ts`<br>`apps/server/test/machine-exit.test.ts`<br>`apps/server/test/machine-pin.test.ts`<br>`apps/server/test/machine-shell.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`apps/server/test/machine-zombie-claim.test.ts`<br>`apps/server/test/mcp-servers.test.ts`<br>`apps/server/test/persona-split-verify.test.ts`<br>`apps/server/test/plan-handoff.test.ts`<br>`apps/server/test/project-dual-source.test.ts`<br>`apps/server/test/queued-cancel-release.test.ts`<br>`apps/server/test/quota-hold.test.ts`<br>`apps/server/test/quota-wait.test.ts`<br>`apps/server/test/review.test.ts`<br>`apps/server/test/rework-branch-reuse.test.ts`<br>`apps/server/test/rework-plan-fallback.test.ts`<br>`apps/server/test/second-pr-guard.test.ts`<br>`apps/server/test/skill-import.test.ts`<br>`apps/server/test/skill-inject-claim.test.ts`<br>`apps/server/test/skill-write.test.ts`<br>`apps/server/test/steer.test.ts`<br>`apps/server/test/stop.test.ts`<br>`apps/server/test/task-meta.test.ts`<br>`apps/server/test/unassigned-build.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/machine-detail.spec.ts`<br>`apps/web/e2e/machines-local.spec.ts`<br>`apps/web/e2e/providers-tabs.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts`<br>`integration/test/board-trio-e2e.test.ts`<br>`integration/test/plan-upload-recovery.test.ts`<br>`packages/shared/test/persona.test.ts` |
| [#1260](https://github.com/xiechimon/pacman/issues/1260) 总管降级为普通 agent（对齐 Multica leader 模型）+ 亲和机制退役 | 运行轴 | 已做 | `docs/verify/1260/`<br>`apps/daemon/test/runner-recover-degrade.test.ts`<br>`apps/server/test/agent-concurrency.test.ts`<br>`apps/server/test/chief-abandoned-sweep.test.ts`<br>`apps/server/test/chief-demotion.test.ts`<br>`apps/server/test/chief-questions.test.ts`<br>`apps/server/test/chief-settings.test.ts`<br>`apps/server/test/chief-skill-route.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/machine-concurrency-chief.test.ts`<br>`apps/server/test/machine-concurrency.test.ts`<br>`apps/server/test/machine-pin.test.ts`<br>`apps/server/test/machine-shell.test.ts`<br>`apps/web/e2e/chief-drawer-model.spec.ts`<br>`apps/web/e2e/chief-settings.spec.ts`<br>`integration/test/port-base-e2e.test.ts`<br>`packages/shared/test/records.test.ts` |
| [#1261](https://github.com/xiechimon/pacman/issues/1261) daemon,server,web: relay 额度空/限流必须显性反馈，不许静默空转 | 运行轴 | 已做 | `docs/verify/1261/`<br>`apps/daemon/test/provider-response.test.ts`<br>`apps/daemon/test/runner-quota-breaker.test.ts`<br>`apps/server/test/quota-wait.test.ts`<br>`apps/web/e2e/quota-wait-board.spec.ts`<br>`packages/shared/test/task-failure.test.ts` |
| [#1262](https://github.com/xiechimon/pacman/issues/1262) daemon,server,web: 工具输出的 ANSI 转义/Hyperlink 原样进 errorMessage，板面报错巨长难读 | 运行轴 | 已做 | `docs/verify/1262/`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/web/test/fail-row-ansi.test.ts`<br>`integration/test/ansi-errormessage-e2e.test.ts`<br>`packages/shared/test/ansi.test.ts` |
| [#1286](https://github.com/xiechimon/pacman/issues/1286) daemon 重启后 journal continue 必败：pi 会话不随 journal 持久化（#50 连跪三次） | 运行轴 | 已做 | `docs/verify/1286/`<br>`apps/daemon/test/runner-recover-degrade.test.ts` |
| [#1290](https://github.com/xiechimon/pacman/issues/1290) daemon: claude 二进制探测加 well-known 目录回落 + launchd 模板 PATH 补 homebrew | 运行轴 | 已做 | `docs/verify/1290/`<br>`apps/daemon/test/claude-code-bin.test.ts` |
| [#1299](https://github.com/xiechimon/pacman/issues/1299) skills 执行面借 T3 路线：联合扫描 + Skill 工具可观测调用 + /name 保证派发 | 运行轴 | 已做 | `docs/verify/1299/`<br>`apps/daemon/test/skill-tool.test.ts`<br>`apps/daemon/test/skills-worktree.test.ts` |
| [#1303](https://github.com/xiechimon/pacman/issues/1303) web: chief 未读徽标算法——机器 chatter 计未读、线程粒度错位、永不过期、无上限 | 运行轴 | 已做 | `docs/verify/1303/`<br>`apps/server/test/chief-unread-badge.test.ts`<br>`apps/web/e2e/chief-fab.spec.ts` |
| [#1307](https://github.com/xiechimon/pacman/issues/1307) daemon: claude-code 会话继承用户全局 MCP——320 工具/960KB schema 吃光 glm 窗口,autocompact thrash 必现(对齐 Multica 三态受管) | 运行轴 | 已做 | `docs/verify/1307/`<br>`apps/daemon/test/claude-mcp-strict.test.ts`<br>`apps/daemon/test/runner-mcp-managed.test.ts`<br>`apps/server/test/mcp-servers.test.ts` |
| [#1308](https://github.com/xiechimon/pacman/issues/1308) live 思考正文流式上屏——thinking_delta 进会话流（对齐 dsh Think 行） | 运行轴 | 已做 | `docs/verify/1308/`<br>`apps/daemon/test/runner-thinking-delta.test.ts`<br>`apps/server/test/conv-stream-catchup.test.ts`<br>`apps/server/test/thinking-delta.test.ts`<br>`apps/web/test/sse-conversation-stream.test.ts`<br>`apps/web/test/thinking-live-row.test.ts`<br>`packages/shared/test/thinking-delta-stream.test.ts` |
| [#1329](https://github.com/xiechimon/pacman/issues/1329) daemon: git 2.43.0 checkout --end-of-options is ignored by sync | 运行轴 | 已做 | `docs/verify/1329/`<br>`apps/daemon/test/git.test.ts`<br>`apps/daemon/test/sync.test.ts` |
| [#1394](https://github.com/xiechimon/pacman/issues/1394) web: agent 预合并判定票——ready-for-agent PR 由 pacman 自己的 agent 判定「简单可合」并执行合并（吃自己狗粮） | 运行轴 | 在跑 | `apps/server/test/issue-intake.test.ts` |
| [#1398](https://github.com/xiechimon/pacman/issues/1398) web: Chief 编排区 Paper 页面（抽屉、问题卡、设置） | 运行轴 | 已做 | `docs/verify/1398/`<br>`apps/web/e2e/chief-thread-switcher-scroll.spec.ts`<br>`apps/web/e2e/paper-chief.spec.ts`<br>`apps/web/test/chief-identity.test.ts` |
| [#1402](https://github.com/xiechimon/pacman/issues/1402) verify: 自举闭环 P1 验证 CLI 收敛（vp.mjs 子命令 + feature map 到达路径 + archive） | 运行轴 | 已做 | `docs/verify/1402/` |
| [#1405](https://github.com/xiechimon/pacman/issues/1405) server: 自举闭环 P4 自治合并执行器（mergePolicy、sha 绑定合并、急停、熔断、日上限） | 运行轴 | 待开 | [未验证] |
| [#1406](https://github.com/xiechimon/pacman/issues/1406) server,daemon: 自举闭环 P5 自主进料与仓规内化（issue 轮询、chief GitHub 读工具、PR 评论回灌） | 运行轴 | 在跑 | `docs/verify/1406/`<br>`apps/daemon/test/runner-issue-fence.test.ts`<br>`apps/daemon/test/step-attachments.test.ts`<br>`apps/server/test/github-issues.test.ts`<br>`apps/server/test/github-reads.test.ts`<br>`apps/server/test/issue-fence.test.ts`<br>`apps/server/test/issue-intake.test.ts`<br>`apps/server/test/mcp-face.test.ts`<br>`apps/server/test/persona-repo-rules.test.ts`<br>`apps/server/test/webhook.test.ts`<br>`apps/web/test/transcript-issue-fence.test.ts`<br>`packages/shared/test/chief-tools.test.ts`<br>`packages/shared/test/issue-fence.test.ts`<br>`packages/shared/test/persona.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1408](https://github.com/xiechimon/pacman/issues/1408) ops: 自举闭环 P7 长期宿主自部署与回滚（待宿主） | 运行轴 | 待开 | [未验证] |
| [#1434](https://github.com/xiechimon/pacman/issues/1434) web: dragging a queued card into 执行中 lights the column, then the start fails with 未能开始编排 | 运行轴 | 已做 | `docs/verify/1434/`<br>`apps/web/e2e/board-queued-drop.spec.ts`<br>`apps/web/test/columns.test.ts` |
| [#1445](https://github.com/xiechimon/pacman/issues/1445) server: closing a task leaves its build step claimable, so a machine can run a closed task | 运行轴 | 已做 | `docs/verify/1445/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/web/e2e/detail-queued-exit.spec.ts` |
| [#1447](https://github.com/xiechimon/pacman/issues/1447) web,shared: a queued card sits in 执行中 and says 排队中 / 等机器 / 等额度 in its footer | 运行轴 | 已做 | `docs/verify/1447/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/server/test/phase.test.ts`<br>`apps/web/e2e/board-queued-column.spec.ts`<br>`apps/web/e2e/board-queued-drop.spec.ts`<br>`apps/web/e2e/queued-action.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1451](https://github.com/xiechimon/pacman/issues/1451) server: marking an in-progress task done leaves its build step running or claimable | 运行轴 | 已做 | `docs/verify/1451/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/server/test/persona-split-verify.test.ts` |
| [#1453](https://github.com/xiechimon/pacman/issues/1453) server: a step that finishes just before its stop lands still advances or re-queues a card that left 执行中 | 运行轴 | 已做 | `docs/verify/1453/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/server/test/pr-reconcile.test.ts` |
| [#1458](https://github.com/xiechimon/pacman/issues/1458) daemon tests: three cases fail in cloud containers (root, inherited GIT_CONFIG_*, slow init reaping) | 运行轴 | 已做 | `docs/verify/1458/`<br>`apps/daemon/test/runner-brief.test.ts`<br>`apps/daemon/test/workspace-hooks.test.ts` |
| [#1460](https://github.com/xiechimon/pacman/issues/1460) daemon: per-step git credentials overwrite GIT_CONFIG_* the machine's environment already sets | 运行轴 | 已做 | `docs/verify/1460/`<br>`apps/daemon/test/git.test.ts`<br>`apps/daemon/test/workspace-hooks.test.ts`<br>`apps/daemon/test/workspace.test.ts` |
| [#1473](https://github.com/xiechimon/pacman/issues/1473) daemon, server: a released step can run twice on one machine, and the old run's report is applied | 运行轴 | 已做 | `docs/verify/1473/`<br>`apps/daemon/test/machine-stop.test.ts`<br>`apps/daemon/test/step-reclaim.test.ts`<br>`apps/server/test/step-claim-report.test.ts` |
| [#1484](https://github.com/xiechimon/pacman/issues/1484) daemon: the per-step git credential helper answers for any host the remote resolves to | 运行轴 | 已做 | `docs/verify/1484/`<br>`apps/daemon/test/credentials.test.ts`<br>`apps/daemon/test/git.test.ts`<br>`apps/daemon/test/local-executor.test.ts`<br>`apps/daemon/test/runner-cred-fallback.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/workspace.test.ts` |
| [#1485](https://github.com/xiechimon/pacman/issues/1485) daemon: the inline credential helper leaves username and password unquoted in the shell | 运行轴 | 已做 | `docs/verify/1485/`<br>`apps/daemon/test/git.test.ts` |
| [#1488](https://github.com/xiechimon/pacman/issues/1488) server: reset deletes a running step before the daemon pulls its stop, so the step runs to the end | 运行轴 | 已做 | `docs/verify/1488/`<br>`apps/daemon/test/runner-stop.test.ts`<br>`apps/server/test/machine-wire.test.ts` |
| [#1490](https://github.com/xiechimon/pacman/issues/1490) daemon: a stop fetched before the session opens, or before a crash, is dropped | 运行轴 | 已做 | `docs/verify/1490/` |
| [#1493](https://github.com/xiechimon/pacman/issues/1493) server,daemon: 模型降级链 + provider 熔断（额度用完或模型挂了换备选接着跑） | 运行轴 | 已做 | `docs/verify/1493/`<br>`apps/daemon/test/runner-error-lifecycle.test.ts`<br>`apps/server/test/model-fallback.test.ts`<br>`apps/server/test/provider-health.test.ts`<br>`packages/shared/test/task-failure.test.ts` |
| [#1497](https://github.com/xiechimon/pacman/issues/1497) Team ownership checks in startBuilds, claim and chief delete_memory (after #1470) | 运行轴 | 已做 | `docs/verify/1497/`<br>`apps/server/test/team-ownership-1497.test.ts` |
| [#10](https://github.com/xiechimon/pacman/issues/10) Kernel: MCP agent channel | 通用面 | 已做 | `apps/web/e2e/branch-button.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts` |
| [#11](https://github.com/xiechimon/pacman/issues/11) Kernel: HTTP API surface | 通用面 | 已做 | `packages/shared/test/records.test.ts` |
| [#12](https://github.com/xiechimon/pacman/issues/12) Kernel: SPA three screens | 通用面 | 已做 | `apps/daemon/test/runner-issue-fence.test.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`apps/web/test/mention-token.test.ts`<br>`packages/shared/test/issue-fence.test.ts` |
| [#13](https://github.com/xiechimon/pacman/issues/13) Kernel: logging + crash recovery | 通用面 | 已做 | `apps/web/e2e/agent-detail.spec.ts` |
| [#14](https://github.com/xiechimon/pacman/issues/14) Map: nanobot TS 复刻（pacman）— 系统设计 spec + ROADMAP | 通用面 | 已做 | `apps/server/test/gate-actor.test.ts` |
| [#15](https://github.com/xiechimon/pacman/issues/15) 研究：作者构建顺序考古（上游 git 历史） | 通用面 | 已做 | `apps/web/e2e/overlay-focus.spec.ts` |
| [#24](https://github.com/xiechimon/pacman/issues/24) 设计：TS 技术栈锁死 | 通用面 | 已做 | `apps/daemon/test/runner-plan-contract.test.ts`<br>`apps/server/test/rework-plan-fallback.test.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`packages/shared/test/plan-first-round-prompt.test.ts` |
| [#30](https://github.com/xiechimon/pacman/issues/30) 设计：WebUI 功能级 parity | 通用面 | 已做 | `integration/test/board-trio-e2e.test.ts` |
| [#34](https://github.com/xiechimon/pacman/issues/34) Map: todos.dev 1:1 复刻（pacman）— 像素级 UI + 功能平价 spec | 通用面 | 已做 | `apps/daemon/test/map-pi-event.test.ts` |
| [#35](https://github.com/xiechimon/pacman/issues/35) 研究：todos.dev 公开站全量盘点（页面/文案/设计 token/PWA/定价边界） | 通用面 | 未验证 | [未验证] |
| [#36](https://github.com/xiechimon/pacman/issues/36) 研究：登录后 workspace UI 全量盘点（屏幕×状态×组件清单+截图） | 通用面 | 未验证 | [未验证] |
| [#38](https://github.com/xiechimon/pacman/issues/38) 研究：地基对比（craft-agents-oss / pi SDK / Claude Agent SDK / 自研基线） | 通用面 | 未验证 | [未验证] |
| [#39](https://github.com/xiechimon/pacman/issues/39) 锁定：地基选型终拍（库化路线具体化） | 通用面 | 未验证 | [未验证] |
| [#40](https://github.com/xiechimon/pacman/issues/40) 决议：领域模型与术语表（CONTEXT.md） | 通用面 | 未验证 | [未验证] |
| [#42](https://github.com/xiechimon/pacman/issues/42) 原型：代表性双屏像素级复刻试做 | 通用面 | 已做 | `apps/web/e2e/notify-click.spec.ts` |
| [#43](https://github.com/xiechimon/pacman/issues/43) 设计：技术栈锁定 v2 | 通用面 | 未验证 | [未验证] |
| [#44](https://github.com/xiechimon/pacman/issues/44) 决议：发布与素材替换策略（清单+时机+署名口径） | 通用面 | 已做 | `integration/test/done-dialog-e2e.test.ts` |
| [#45](https://github.com/xiechimon/pacman/issues/45) 设计：构建顺序、spec 出版格式与地图收尾（ROADMAP） | 通用面 | 未验证 | [未验证] |
| [#52](https://github.com/xiechimon/pacman/issues/52) Web: 双屏像素实现 — apps/web 看板+详情（fixture 数据）+ r7 对拍 harness | 通用面 | 未验证 | [未验证] |
| [#53](https://github.com/xiechimon/pacman/issues/53) Web: 骨架 — monorepo + token/主题/字体/图标 + 对拍 harness + CI | 通用面 | 未验证 | [未验证] |
| [#54](https://github.com/xiechimon/pacman/issues/54) Web: 看板基面 — 侧栏/顶栏/6 列/卡片基础态（r7 01/02 捕获组） | 通用面 | 已做 | `packages/shared/test/task-failure.test.ts` |
| [#55](https://github.com/xiechimon/pacman/issues/55) Web: 看板卡态 — 卡片变体矩阵 + rail 收起（r7 22/21/33/35/03） | 通用面 | 已做 | `apps/web/e2e/user-menu-trigger.spec.ts` |
| [#58](https://github.com/xiechimon/pacman/issues/58) Web: 收尾 — 导航闭环 + scenario 收口 + 全矩阵终验 | 通用面 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/task-meta-e2e.test.ts` |
| [#66](https://github.com/xiechimon/pacman/issues/66) Web: 弹层批 A — 新建任务 dialog + 删除确认 + 更多菜单 | 通用面 | 已做 | `apps/web/e2e/project-empty-new-task.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts` |
| [#68](https://github.com/xiechimon/pacman/issues/68) Web: 弹层批 C — Token 用量 + 分支与 PR + 验收确认 + dark 弹层全套 | 通用面 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/rerun-close-family.spec.ts`<br>`apps/web/e2e/secret-add-dialog.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts` |
| [#72](https://github.com/xiechimon/pacman/issues/72) Web: Chief 面板静态面（drawer/线程/设置 4 tab） | 通用面 | 未验证 | [未验证] |
| [#73](https://github.com/xiechimon/pacman/issues/73) Web: 动效 + 拖拽排序 | 通用面 | 已做 | `apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts` |
| [#74](https://github.com/xiechimon/pacman/issues/74) Web: 中英双语接线 + PWA（manifest/sw.js 字节搬，push handler 形状保留） | 通用面 | 已做 | `apps/web/e2e/storage-unavailable.spec.ts`<br>`apps/web/test/created-at.test.ts`<br>`apps/web/test/i18n-coverage.test.ts`<br>`apps/web/test/i18n.test.ts`<br>`apps/web/test/pwa.test.ts`<br>`apps/web/test/rel-time.test.ts` |
| [#78](https://github.com/xiechimon/pacman/issues/78) M2c server：密钥三层 + 搜索 + 通知 SSE 三事件 | 通用面 | 已做 | `apps/server/test/wire.test.ts` |
| [#83](https://github.com/xiechimon/pacman/issues/83) M5 汇合：fixture 切真 API + live streaming + E2E 主时序全链（含 M6 终验） | 通用面 | 已做 | `apps/server/test/m5-face.test.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#104](https://github.com/xiechimon/pacman/issues/104) 升级窗口：TypeScript 5.9.3 → 7.0.2（工具链兼容面核实 + 全量回归） | 通用面 | 未验证 | [未验证] |
| [#105](https://github.com/xiechimon/pacman/issues/105) 升级窗口：react-router 7.18.4 → 8.4.0（library mode 回归 + 路由形状保真） | 通用面 | 未验证 | [未验证] |
| [#106](https://github.com/xiechimon/pacman/issues/106) 升级窗口：Tailwind CSS 3.4.19 → 4.x（dark 反相变体等价实现 + 全矩阵重验） | 通用面 | 未验证 | [未验证] |
| [#107](https://github.com/xiechimon/pacman/issues/107) 升级窗口：pi 0.85.1 → 0.86.0（D6 首个窗口：Breaking 段阅读 + AgentBackend 缝回归） | 通用面 | 未验证 | [未验证] |
| [#114](https://github.com/xiechimon/pacman/issues/114) web: 浏览器通知引导条未建——NOTIFICATION_BANNER_COPY 有文案无组件 | 通用面 | 已做 | `apps/web/e2e/account-controls.spec.ts`<br>`apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/notify-banner.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#121](https://github.com/xiechimon/pacman/issues/121) web: 侧栏交互重做——导航 SPA 化 + 删安装 App + hover 高亮 | 通用面 | 已做 | `apps/web/e2e/agent-identity-chip.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/search-result-rows.spec.ts`<br>`apps/web/e2e/sidebar-nav.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts`<br>`apps/web/e2e/user-menu-nav.spec.ts`<br>`apps/web/test/chief-identity.test.ts` |
| [#122](https://github.com/xiechimon/pacman/issues/122) web: 主题系统点亮——外观切换激活 + icon 深浅色自适应 | 通用面 | 已做 | `apps/web/e2e/theme-toggle.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#123](https://github.com/xiechimon/pacman/issues/123) web: 质感打磨——卡片边框/侧栏衔接/横向滚动条(参考 claude.ai) | 通用面 | 已做 | `apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/sidebar-seam.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#127](https://github.com/xiechimon/pacman/issues/127) web: 用户菜单开闭触发——头像 chip 接 popover(弹层族入场) | 通用面 | 已做 | `apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/project-tasks-toolbar.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#128](https://github.com/xiechimon/pacman/issues/128) web: 侧栏视觉修正——hover 色阶/形状一致/⌘K pill 重合 | 通用面 | 已做 | `apps/web/e2e/sidebar-nav.spec.ts`<br>`apps/web/e2e/sidebar-visual.spec.ts` |
| [#129](https://github.com/xiechimon/pacman/issues/129) web: 全局 shell 一致 + local-first 净化——ChiefFab 全页唤醒/侧栏形态固定/删 FREE·升级/主题默认跟系统 | 通用面 | 已做 | `apps/web/e2e/chief-draft-persist.spec.ts`<br>`apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/shell-consistency.spec.ts`<br>`apps/web/e2e/sidebar-search-offboard.spec.ts`<br>`apps/web/e2e/storage-unavailable.spec.ts` |
| [#133](https://github.com/xiechimon/pacman/issues/133) web: secondary/resources shell 标题带吞点击——返回/新建钮物理点不到（pointer-events 未同步 board 先例） | 通用面 | 已做 | `apps/web/e2e/title-band-clicks.spec.ts` |
| [#134](https://github.com/xiechimon/pacman/issues/134) web: 侧栏收起/搜索只在看板页活——三 shell 未传 onToggle/onSearch（collapse 状态上移） | 通用面 | 已做 | `apps/web/e2e/sidebar-search-offboard.spec.ts` |
| [#135](https://github.com/xiechimon/pacman/issues/135) web: 侧栏接缝回归 + 顶部分隔线延伸全屏——dogfood 裁决 v2（修订 #123「柔边不画缝」） | 通用面 | 已做 | `apps/web/e2e/sidebar-seam.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#136](https://github.com/xiechimon/pacman/issues/136) web: dogfood 死钮台账——live 面未接线行为盘点（2026-09-24 排查） | 通用面 | 已做 | `apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#137](https://github.com/xiechimon/pacman/issues/137) web: 搜索交互——⌘K 开面板输入框未自动聚焦 + 常亮互斥 | 通用面 | 已做 | `apps/web/e2e/search-close-flash.spec.ts`<br>`apps/web/e2e/search-focus.spec.ts` |
| [#138](https://github.com/xiechimon/pacman/issues/138) web: 分段控件族修——page-tab 显示/未选中 hover/全族巡检 | 通用面 | 已做 | `apps/web/e2e/segmented-controls.spec.ts` |
| [#139](https://github.com/xiechimon/pacman/issues/139) web: 边框体系统一——卡片复用弹层边框写法 + zoom 110% 渲染修复 | 通用面 | 已做 | `apps/web/e2e/visual-polish.spec.ts` |
| [#146](https://github.com/xiechimon/pacman/issues/146) web: 总管面板收尾——Esc 关闭修复 + 快捷提示接预置词 + composer 行裁决 | 通用面 | 已做 | `apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/chief-drawer-model.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#147](https://github.com/xiechimon/pacman/issues/147) web: 折叠族接线——侧栏分组折叠 + 看板六列折叠(状态持久化) | 通用面 | 已做 | `apps/web/e2e/collapse-family.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#148](https://github.com/xiechimon/pacman/issues/148) web: account/team local-first 净化——删退出登录/删除账户 + 通知开关接真权限 + team 页死钮处置 | 通用面 | 已做 | `apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/chip-assign.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts` |
| [#149](https://github.com/xiechimon/pacman/issues/149) web: 零散死钮处置 + feedback 页整页移除(local-first 裁决) | 通用面 | 已做 | `apps/server/test/git-hosting.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts`<br>`apps/web/e2e/skills-page.spec.ts` |
| [#150](https://github.com/xiechimon/pacman/issues/150) web: 侧栏分组折叠——项目/资源 GroupHeader 点击收起/展开 + 品牌槽持久化（r2 §1.1 同形键） | 通用面 | 已做 | `apps/server/test/pr-reconcile.test.ts` |
| [#151](https://github.com/xiechimon/pacman/issues/151) web: 看板列折叠——六列列头钮收起/展开（收起态形态需原站补拍或 §8 设计裁决） | 通用面 | 未验证 | [未验证] |
| [#159](https://github.com/xiechimon/pacman/issues/159) web: 搜索结果行——点击不生效 + 常亮改 hover 跟随鼠标 | 通用面 | 已做 | `apps/web/e2e/search-focus.spec.ts`<br>`apps/web/e2e/search-result-rows.spec.ts` |
| [#160](https://github.com/xiechimon/pacman/issues/160) web: 看板拖拽解封——todo-card 的 drag 禁令拆除,接通已有 dnd 逻辑层 | 通用面 | 已做 | `apps/server/test/manual-drop-matrix.test.ts`<br>`apps/server/test/pr-reconcile.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/test/columns.test.ts` |
| [#161](https://github.com/xiechimon/pacman/issues/161) web: 卡片阴影/边框统一——大卡片复用小卡片规格 + 小卡片阴影收浅去飘浮感 | 通用面 | 已做 | `apps/web/e2e/visual-polish.spec.ts` |
| [#163](https://github.com/xiechimon/pacman/issues/163) web: 用户菜单两件——弹层锚定头像上方 + 菜单行接真导航 | 通用面 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/user-menu-nav.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#170](https://github.com/xiechimon/pacman/issues/170) web: 创建 Agent dialog(team 页死钮解封,M0+ 弹层族首票) | 通用面 | 已做 | `apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/secret-add-dialog.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts` |
| [#172](https://github.com/xiechimon/pacman/issues/172) Map: 弹层族收口——剩余死钮接线与 local-first 裁决出账 | 通用面 | 未验证 | [未验证] |
| [#173](https://github.com/xiechimon/pacman/issues/173) task: 密钥添加弹窗——secrets 页 res-new 死钮接线 | 通用面 | 已做 | `apps/web/e2e/secret-add-dialog.spec.ts` |
| [#174](https://github.com/xiechimon/pacman/issues/174) task: MCP 添加弹窗——mcp-servers 页 res-add 死钮接线 | 通用面 | 未验证 | [未验证] |
| [#175](https://github.com/xiechimon/pacman/issues/175) task: 模型服务自定义 provider 弹窗——providers 页添加面 | 通用面 | 已做 | `apps/web/e2e/dialog-viewport.spec.ts` |
| [#176](https://github.com/xiechimon/pacman/issues/176) task: new-task 项目选择器——new-task-dialog 下拉接真数据 | 通用面 | 已做 | `apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/project-empty-new-task.spec.ts` |
| [#177](https://github.com/xiechimon/pacman/issues/177) task: project-settings 三钮——更换仓库/切分支/删除项目 | 通用面 | 已做 | `apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts` |
| [#178](https://github.com/xiechimon/pacman/issues/178) task: project tasks 工具条——筛选/排序/视图切换 | 通用面 | 已做 | `apps/web/e2e/project-tasks-toolbar.spec.ts` |
| [#180](https://github.com/xiechimon/pacman/issues/180) grilling: Chief 章程编辑形态与压缩模型数据源 | 通用面 | 已做 | `apps/web/e2e/chief-settings.spec.ts` |
| [#182](https://github.com/xiechimon/pacman/issues/182) task: Chief 设置面接线——agent 行/章程/压缩模型三件 | 通用面 | 已做 | `apps/web/e2e/chief-settings.spec.ts`<br>`apps/web/e2e/chip-assign.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#189](https://github.com/xiechimon/pacman/issues/189) task: DELETE /api/projects/:id 端点 + 级联设计——project-settings 删除区复活前置 | 通用面 | 已做 | `apps/server/test/project-delete.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts` |
| [#193](https://github.com/xiechimon/pacman/issues/193) task: .dlg 壳层矮视口溢出家族修——max-height/overflow 统一收编 | 通用面 | 已做 | `apps/web/e2e/dialog-viewport.spec.ts` |
| [#194](https://github.com/xiechimon/pacman/issues/194) task: e2e spec inline import 家族清扫——top-level import 合规 | 通用面 | 未验证 | [未验证] |
| [#201](https://github.com/xiechimon/pacman/issues/201) grilling: GitHub 技能扫描路线——server 出站 fetch vs GitOps clone vs 出账 | 通用面 | 已做 | `apps/server/test/pr-reconcile.test.ts` |
| [#202](https://github.com/xiechimon/pacman/issues/202) task: prj-file-row 接文件详情面——useProjectFile + viewer 容器渲染 | 通用面 | 已做 | `apps/server/test/pr-reconcile.test.ts`<br>`apps/web/e2e/diff-full-file.spec.ts`<br>`apps/web/e2e/file-viewer.spec.ts` |
| [#203](https://github.com/xiechimon/pacman/issues/203) task: server 长 chief 压缩模型槽——compactionModel 列 + PATCH 第三槽 | 通用面 | 已做 | `apps/server/test/chief-settings.test.ts` |
| [#204](https://github.com/xiechimon/pacman/issues/204) task: chief 设置面压缩模型启用——下拉接 providers 真值（静态化翻回） | 通用面 | 未验证 | [未验证] |
| [#208](https://github.com/xiechimon/pacman/issues/208) task: PATCH /api/todos/:id 加 assignment 槽——编辑分配接线前置 | 通用面 | 已做 | `apps/server/test/wire.test.ts`<br>`apps/web/e2e/chip-assign.spec.ts` |
| [#209](https://github.com/xiechimon/pacman/issues/209) task: chip-popover 编辑分配接线——agent 选择弹层 + PATCH assignment | 通用面 | 已做 | `apps/web/e2e/chip-assign.spec.ts` |
| [#216](https://github.com/xiechimon/pacman/issues/216) bug: CI 偶发 git-hosting.test.ts unhandled write EPIPE(lib/git.ts:46)——两次在案 | 通用面 | 已做 | `apps/server/test/git-lib.test.ts` |
| [#219](https://github.com/xiechimon/pacman/issues/219) 对账漏网: docpane diff「显示完整文件」钮(.diff-expand)——全文数据源形态裁决 | 通用面 | 已做 | `apps/server/test/build-diff-fulltext.test.ts`<br>`apps/web/e2e/diff-full-file.spec.ts` |
| [#221](https://github.com/xiechimon/pacman/issues/221) task: 弹窗样式族整族抽取——六弹窗 CSS 收 shared 层(#199 裁决) | 通用面 | 未验证 | [未验证] |
| [#223](https://github.com/xiechimon/pacman/issues/223) task: server 长 GitHub 出站 fetch——skills 扫描发现半(#201 裁决路线 A) | 通用面 | 已做 | `apps/server/test/oauth.test.ts` |
| [#224](https://github.com/xiechimon/pacman/issues/224) task: server 长 conv 分支文件全文读面——diff 全文数据源(#219 裁决 A) | 通用面 | 已做 | `apps/server/test/build-diff-fulltext.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/diff-full-file.spec.ts` |
| [#225](https://github.com/xiechimon/pacman/issues/225) task: docpane「显示完整文件」钮接线(#219 裁决 A,web 半) | 通用面 | 已做 | `apps/server/test/build-diff-fulltext.test.ts`<br>`apps/web/e2e/diff-full-file.spec.ts`<br>`apps/web/e2e/plan-diff-full-file.spec.ts` |
| [#229](https://github.com/xiechimon/pacman/issues/229) task: parity 矩阵补弹层族 open 态行——r8 基线门禁化(M6 Q3) | 通用面 | 未验证 | [未验证] |
| [#230](https://github.com/xiechimon/pacman/issues/230) task: provider/agent/mcp 三族 POST body schema 上收 shared(M6 Q4b) | 通用面 | 未验证 | [未验证] |
| [#231](https://github.com/xiechimon/pacman/issues/231) task: OAuth 握手面——一族打通 + web 接线 + wizard 连号脚本(M6 Q2/Q5) | 通用面 | 已做 | `apps/server/test/github-oauth.test.ts`<br>`apps/server/test/oauth.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/provider-oauth.spec.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#232](https://github.com/xiechimon/pacman/issues/232) task: M6 功能平价终验——全口径重跑 + 05 册终版(Q1 裁决 A) | 通用面 | 未验证 | [未验证] |
| [#235](https://github.com/xiechimon/pacman/issues/235) task: skills GitHub 扫描钮接线——scan 端点消费(#223 后票) | 通用面 | 未验证 | [未验证] |
| [#243](https://github.com/xiechimon/pacman/issues/243) bug: OAuth state TTL 人环太短 + state 过期走裸 JSON 错误面(连号首趟实测) | 通用面 | 已做 | `apps/server/test/github-oauth.test.ts`<br>`apps/server/test/oauth.test.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts` |
| [#247](https://github.com/xiechimon/pacman/issues/247) spec: W1 开源门面 + 可选 token 鉴权(06 册 D8/D9) | 通用面 | 已做 | `apps/server/test/token-auth.test.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/token-gate.spec.ts` |
| [#249](https://github.com/xiechimon/pacman/issues/249) task: 素材核账——产品内资产逐项核(W1,素材替换计划清单) | 通用面 | 已做 | `apps/web/test/pwa.test.ts` |
| [#251](https://github.com/xiechimon/pacman/issues/251) task: server 可选 token 鉴权——PACMAN_TOKEN 中间件 + 四豁免 + 0.0.0.0 WARN(W1) | 通用面 | 已做 | `apps/server/test/token-auth.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#253](https://github.com/xiechimon/pacman/issues/253) task: web token 门页——401 捕获 + localStorage + fetch/SSE 接线(W1) | 通用面 | 已做 | `apps/server/test/token-auth.test.ts`<br>`apps/web/e2e/token-gate.spec.ts` |
| [#261](https://github.com/xiechimon/pacman/issues/261) task: server bundle 管线 + 主包整形——@xiechimon/pacman 可发布(W2) | 通用面 | 未验证 | [未验证] |
| [#263](https://github.com/xiechimon/pacman/issues/263) task: npm 首发 wizard 人肉引导脚本(W2) | 通用面 | 未验证 | [未验证] |
| [#264](https://github.com/xiechimon/pacman/issues/264) task: pack 冒烟 + CI job——tarball 裸 node 起服务(W2) | 通用面 | 未验证 | [未验证] |
| [#286](https://github.com/xiechimon/pacman/issues/286) task: ⌘K 搜索切服务端——面板从客户端过滤切 GET /api/search(W4) | 通用面 | 已做 | `apps/server/test/search.test.ts` |
| [#290](https://github.com/xiechimon/pacman/issues/290) spec: streamdown 引入评估——只评估不实装(W4) | 通用面 | 未验证 | [未验证] |
| [#302](https://github.com/xiechimon/pacman/issues/302) M7 · 功能闭环——死按钮清零与反向差距收编 | 通用面 | 已做 | `apps/server/test/wire.test.ts` |
| [#303](https://github.com/xiechimon/pacman/issues/303) M7-W1 总账票：四方对账 + 附件/提及规格补采 + 后端能力盘点 | 通用面 | 未验证 | [未验证] |
| [#304](https://github.com/xiechimon/pacman/issues/304) M7-W2 语音按钮移除（composer + 新建任务对话框） | 通用面 | 已做 | `apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#305](https://github.com/xiechimon/pacman/issues/305) M7-W2 project 空态新建钮 + 新建项目选择仓库接线 | 通用面 | 已做 | `apps/server/test/pr-reconcile.test.ts`<br>`apps/web/e2e/newtask-project-persist.spec.ts`<br>`apps/web/e2e/project-empty-new-task.spec.ts` |
| [#309](https://github.com/xiechimon/pacman/issues/309) M7 新建任务标签：对话框标签 UI + server 写路径 | 通用面 | 已做 | `docs/verify/309/`<br>`apps/server/test/wire.test.ts`<br>`integration/test/task-meta-e2e.test.ts` |
| [#310](https://github.com/xiechimon/pacman/issues/310) M7-W5 附件：composer + 新建任务全链 | 通用面 | 已做 | `docs/verify/310/`<br>`apps/server/test/attachments.test.ts`<br>`apps/server/test/m4b-memory.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/composer-paste.spec.ts`<br>`apps/web/e2e/spec-brief-card.spec.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#311](https://github.com/xiechimon/pacman/issues/311) M7-W5 提及：composer + 新建任务 @引用 | 通用面 | 已做 | `docs/verify/311/` |
| [#344](https://github.com/xiechimon/pacman/issues/344) verify-pacman api-key probe 过时：#287 弹窗化后未提交表单即等一次性明文 | 通用面 | 已做 | `docs/verify/344/` |
| [#346](https://github.com/xiechimon/pacman/issues/346) 分支对话框 buildId 两处漏传：同步 tab 在 live 栈上恒为 fixture 占位（#319 功能不可达） | 通用面 | 已做 | `integration/test/m7-branch-dialog-e2e.test.ts` |
| [#347](https://github.com/xiechimon/pacman/issues/347) 详情页发送钮被总管悬浮钮遮挡：原站同形（r5 实测），按 D1 定夺修或保真 | 通用面 | 已做 | `apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#349](https://github.com/xiechimon/pacman/issues/349) integration 测试并行 vite build 写同一 dist：全量 pnpm test 间歇假红 | 通用面 | 已做 | `integration/test/board-trio-e2e.test.ts`<br>`integration/test/done-dialog-e2e.test.ts`<br>`integration/test/web-plans-convergence.test.ts` |
| [#351](https://github.com/xiechimon/pacman/issues/351) 看板更名工作台 + 6 列收敛为 4 列 | 通用面 | 已做 | `docs/verify/351/`<br>`apps/server/test/manual-drop-matrix.test.ts`<br>`apps/server/test/phase.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/collapse-family.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#352](https://github.com/xiechimon/pacman/issues/352) 新建项目：支持本地仓库 + GitHub 认证选仓 | 通用面 | 已做 | `apps/web/e2e/project-new-repo.spec.ts` |
| [#355](https://github.com/xiechimon/pacman/issues/355) 添加服务商 picker dialog 重构 | 通用面 | 已做 | `apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts` |
| [#358](https://github.com/xiechimon/pacman/issues/358) chief-model-select 数据源切换到 model-sources | 通用面 | 已做 | `docs/verify/358/`<br>`apps/server/test/wire.test.ts`<br>`apps/web/test/model-options.test.ts` |
| [#359](https://github.com/xiechimon/pacman/issues/359) G2-T1 shared + server schema/API（含 localPath + github_connection） | 通用面 | 已做 | `docs/verify/359/`<br>`apps/server/test/github-connection.test.ts`<br>`apps/server/test/project-local.test.ts`<br>`apps/server/test/wire.test.ts`<br>`packages/shared/test/snapshot.test.ts` |
| [#360](https://github.com/xiechimon/pacman/issues/360) G2-T3 web 新建项目表单（两行菜单 + 名称回填 + 去蓝） | 通用面 | 已做 | `docs/verify/360/`<br>`apps/web/e2e/project-new-repo.spec.ts` |
| [#361](https://github.com/xiechimon/pacman/issues/361) G2-T4 GitHub OAuth 认证 + picker 面板 | 通用面 | 已做 | `docs/verify/361/`<br>`apps/server/test/github-oauth.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`packages/shared/test/snapshot.test.ts` |
| [#363](https://github.com/xiechimon/pacman/issues/363) 撤 board topbar 的「看板指南」帮助按钮 | 通用面 | 已做 | `docs/verify/363/`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#365](https://github.com/xiechimon/pacman/issues/365) 资源面本地化：skills 与 MCP 只读本地 / spec: docs/spec/13 | 通用面 | 未验证 | [未验证] |
| [#366](https://github.com/xiechimon/pacman/issues/366) 详情页重设计：去 文档\|聊天 tabs，对齐 todos.dev 现行 3-pane 布局 | 通用面 | 已做 | `docs/verify/366/`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/segmented-controls.spec.ts`<br>`integration/test/m7-branch-dialog-e2e.test.ts` |
| [#367](https://github.com/xiechimon/pacman/issues/367) T1: skills 本地目录面（删 GitHub 扫描 + folder 上传 + skill 表） | 通用面 | 已做 | `docs/verify/367/`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/daemon/test/skills-hard-block.test.ts`<br>`apps/server/test/legacy-export.test.ts`<br>`apps/server/test/m5-face.test.ts`<br>`apps/server/test/skills-local.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/segmented-controls.spec.ts`<br>`apps/web/e2e/skills-page.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts`<br>`packages/shared/test/chief-tools.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#385](https://github.com/xiechimon/pacman/issues/385) codex preset 行 authorize 404：OAuth 族表只武装 github-copilot | 通用面 | 已做 | `docs/verify/385/`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts` |
| [#386](https://github.com/xiechimon/pacman/issues/386) server 400 校验错误 reason code 化：消除 web 子串分类耦合 | 通用面 | 已做 | `docs/verify/386/`<br>`apps/server/test/fs-list.test.ts`<br>`apps/server/test/fs-pick.test.ts`<br>`apps/server/test/project-local.test.ts`<br>`apps/web/e2e/project-commit-detail.spec.ts`<br>`apps/web/e2e/project-new-fs-pick.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#387](https://github.com/xiechimon/pacman/issues/387) dicebear Lorelei 头像系统：Agent/用户按名种子化生成 | 通用面 | 已做 | `docs/verify/387/`<br>`apps/web/e2e/avatar-dicebear.spec.ts` |
| [#388](https://github.com/xiechimon/pacman/issues/388) 弹层与 focus 视觉缺陷组：头像菜单间距 / UA 蓝框收编 / schedules 弹层全屏+Esc+动画收敛 | 通用面 | 已做 | `docs/verify/388/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/newtask-single-field.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/e2e/registry-focus-ring.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#389](https://github.com/xiechimon/pacman/issues/389) 快捷键组：新任务 N（含角标）+ 空格呼出总管（焦点入抽屉） | 通用面 | 已做 | `docs/verify/389/`<br>`apps/web/e2e/chief-minimize-scroll.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/newtask-project-persist.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts` |
| [#390](https://github.com/xiechimon/pacman/issues/390) 品牌与排版组：字重基线 / 左上 Pacman logo / 返回钮去 hover / 侧栏色调对齐 | 通用面 | 已做 | `docs/verify/390/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#391](https://github.com/xiechimon/pacman/issues/391) 看板拖拽卡片下缘阴影消失 | 通用面 | 已做 | `docs/verify/391/`<br>`apps/web/e2e/board-dnd.spec.ts` |
| [#394](https://github.com/xiechimon/pacman/issues/394) 新建任务无标题面：正文单字段 + agent 回填标题/标签 + 固定标签词表 | 通用面 | 已做 | `docs/verify/394/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/task-meta-prompt.test.ts`<br>`apps/server/test/task-meta.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/newtask-single-field.spec.ts`<br>`apps/web/e2e/project-empty-new-task.spec.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/task-meta-e2e.test.ts`<br>`packages/shared/test/task-meta.test.ts` |
| [#398](https://github.com/xiechimon/pacman/issues/398) board-dnd.spec.ts:34 拖中 data-drop 断言高负载偶发 flake | 通用面 | 已做 | `apps/web/e2e/board-dnd.spec.ts` |
| [#403](https://github.com/xiechimon/pacman/issues/403) 看板按标签筛选面（固定词表消费闭环；与 #351 顺序约束） | 通用面 | 已做 | `apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/board-filter.spec.ts`<br>`apps/web/test/tag-filter.test.ts` |
| [#404](https://github.com/xiechimon/pacman/issues/404) 收编 board-page/project-page 的 createTodo/createAndStart 重复 | 通用面 | 已做 | `apps/web/e2e/newtask-project-persist.spec.ts` |
| [#409](https://github.com/xiechimon/pacman/issues/409) 迁移面盘点：ui 原语消费矩阵 + css 依赖图 + 三面钉扎点清单 | 通用面 | 已做 | `apps/web/e2e/machine-authorize.spec.ts`<br>`apps/web/test/ui-reuse-inventory.test.ts` |
| [#410](https://github.com/xiechimon/pacman/issues/410) primitives 层选型：Radix vs Base UI | 通用面 | 已做 | `apps/web/test/ui-reuse-inventory.test.ts` |
| [#411](https://github.com/xiechimon/pacman/issues/411) e2e 三面钉扎重钉策略：类名断言迁移民径 + 几何基线处置 | 通用面 | 已做 | `apps/web/e2e/elevation-ladder.spec.ts`<br>`apps/web/e2e/machine-authorize.spec.ts`<br>`apps/web/e2e/spinner-live.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#412](https://github.com/xiechimon/pacman/issues/412) token 管道架构：tokens.css × shadcn 变量规约合流 | 通用面 | 未验证 | [未验证] |
| [#414](https://github.com/xiechimon/pacman/issues/414) 试点落地：主界面看板 shadcn 化（B 美学，用户审后定合并） | 通用面 | 已做 | `apps/web/e2e/search-focus.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#417](https://github.com/xiechimon/pacman/issues/417) Map: 全站铺开 shadcn/ui——批次表、验收口径与第一片落地 | 通用面 | 已做 | `apps/web/test/ui-reuse-inventory.test.ts` |
| [#418](https://github.com/xiechimon/pacman/issues/418) 弹层行为契约对照：shadcn Dialog × 仓内 OverlayMount 家族 | 通用面 | 未验证 | [未验证] |
| [#419](https://github.com/xiechimon/pacman/issues/419) mention-picker 悬空 token 修复（迁前必修） | 通用面 | 未验证 | [未验证] |
| [#420](https://github.com/xiechimon/pacman/issues/420) 弹层族迁移设计：11 壳的 shadcn 化与行为契约保留 | 通用面 | 未验证 | [未验证] |
| [#421](https://github.com/xiechimon/pacman/issues/421) 批次表与每片验收标准（铺开蓝图核心件） | 通用面 | 未验证 | [未验证] |
| [#422](https://github.com/xiechimon/pacman/issues/422) 第一片真域选定与迁移面（resources vs secondary） | 通用面 | 未验证 | [未验证] |
| [#430](https://github.com/xiechimon/pacman/issues/430) 弹层行为契约对照（Base UI 代数） | 通用面 | 未验证 | [未验证] |
| [#440](https://github.com/xiechimon/pacman/issues/440) 新建项目本地文件夹选取：server 代弹 macOS 原生对话框（POST /api/fs/pick） | 通用面 | 已做 | `docs/verify/440/`<br>`apps/server/test/fs-pick.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-fs-pick.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#441](https://github.com/xiechimon/pacman/issues/441) 应用内目录浏览器：本地文件夹选取的 remote/headless 兜底 | 通用面 | 已做 | `apps/server/test/fs-list.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-fs-pick.spec.ts` |
| [#442](https://github.com/xiechimon/pacman/issues/442) 总管呼出热键由空格改为 ⌘J（替换 #389 的空格绑定） | 通用面 | 已做 | `apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts` |
| [#443](https://github.com/xiechimon/pacman/issues/443) 详情页总管 FAB 改为「有未读才显示」 | 通用面 | 已做 | `apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/shell-consistency.spec.ts` |
| [#444](https://github.com/xiechimon/pacman/issues/444) 总管 FAB 显示绑定主 Agent 头像 | 通用面 | 已做 | `apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts` |
| [#445](https://github.com/xiechimon/pacman/issues/445) 看板顶栏重排：仓库筛选 + 撤「+ 任务」+ 无底色类型过滤；任务卡渲染标签 | 通用面 | 已做 | `apps/web/e2e/board-filter.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/newtask-dismiss-gesture.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/newtask-single-field.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/test/repo-filter.test.ts`<br>`apps/web/test/tag-filter.test.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/task-meta-e2e.test.ts` |
| [#446](https://github.com/xiechimon/pacman/issues/446) 从 GitHub issue 建任务：issue 作为来源，label 与标题成为该项目上的元信息真值 | 通用面 | 已做 | `apps/daemon/test/task-meta-prompt.test.ts`<br>`apps/server/test/github-issues.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-github-issues.spec.ts`<br>`packages/shared/test/records.test.ts` |
| [#447](https://github.com/xiechimon/pacman/issues/447) web: 总管面板形态——悬浮卡 → 贴右竖板（四壳让位 + 详情顶右栏 + 删形态切换钮） | 通用面 | 已做 | `docs/verify/447/`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#448](https://github.com/xiechimon/pacman/issues/448) mention-picker 构建产物里面板不居中（.anim-pop transform 覆盖 translateX(-50%)） | 通用面 | 已做 | `apps/web/e2e/mention-picker-center.spec.ts` |
| [#452](https://github.com/xiechimon/pacman/issues/452) 自派任务建时于 GitHub 建 issue，回填标题写进 issue（依赖 #446） | 通用面 | 已做 | `apps/server/test/github-issues.test.ts`<br>`apps/server/test/github-repo-dot-segments.test.ts`<br>`apps/server/test/github-writeback.test.ts`<br>`apps/server/test/orchestration-source.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/github-issue-writeback.spec.ts`<br>`packages/shared/test/github-repo-ref.test.ts` |
| [#462](https://github.com/xiechimon/pacman/issues/462) CI push-run E2E flake 三 symptom 留档：m5 超时/拒连 + board-filter Escape 关层竞态（PR run 六连绿对照） | 通用面 | 已做 | `apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/test/invalidate-converged.test.ts`<br>`apps/web/test/sse-connection.test.ts`<br>`apps/web/test/sse-conversation-stream.test.ts`<br>`integration/test/web-plans-convergence.test.ts` |
| [#466](https://github.com/xiechimon/pacman/issues/466) use-esc.ts（对话框族）同形接线：useEscClose 也按渲染重挂，存同类 Escape 丢失窗口 | 通用面 | 已做 | `apps/web/e2e/escape-wiring.spec.ts` |
| [#469](https://github.com/xiechimon/pacman/issues/469) 对话区两件事：工具输出独立成块 + 对话文本块级 markdown 渲染 | 通用面 | 已做 | `apps/web/e2e/chat-md-toolout.spec.ts`<br>`apps/web/e2e/chat-tools-identity.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/transcript-tool-echo.test.ts` |
| [#470](https://github.com/xiechimon/pacman/issues/470) 对话正文字号提阶 + 行宽上限 | 通用面 | 已做 | `apps/web/e2e/chat-tools-identity.spec.ts`<br>`apps/web/e2e/chat-type-measure.spec.ts`<br>`apps/web/e2e/spec-brief-card.spec.ts` |
| [#472](https://github.com/xiechimon/pacman/issues/472) composer 改 in-flow：文字永不被输入框压住 | 通用面 | 已做 | `apps/web/e2e/detail-3pane.spec.ts` |
| [#485](https://github.com/xiechimon/pacman/issues/485) web: /app/team 的 Agent 无法点击与编辑 + 创建 Agent 弹窗内联服务商/模型位 | 通用面 | 已做 | `docs/verify/485/`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#486](https://github.com/xiechimon/pacman/issues/486) web: 资源五页内容超出视口即被裁——.res-col overflow:hidden 使面板无滚动容器 | 通用面 | 已做 | `docs/verify/486/`<br>`apps/web/e2e/skills-page.spec.ts` |
| [#487](https://github.com/xiechimon/pacman/issues/487) 侧栏头部选中态搬内容：点品牌进 /app/team 时图标右移 3px、名字左移 2px | 通用面 | 已做 | `apps/web/test/chief-markdown.test.ts` |
| [#490](https://github.com/xiechimon/pacman/issues/490) web: /app/team 的 chart 布局恒渲染「暂无成员」——chart 未接数据，参考产品的 chart 实为组织图 | 通用面 | 已做 | `apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/team-create-agent.spec.ts` |
| [#494](https://github.com/xiechimon/pacman/issues/494) web: 资源页滚动容器移到面板右缘（拆 res-body / res-col，对齐 .secondary-body 同形） | 通用面 | 已做 | `docs/verify/494/`<br>`apps/web/e2e/skills-page.spec.ts` |
| [#499](https://github.com/xiechimon/pacman/issues/499) web: Agent 详情编辑面收尾项（#485 显式缺口） | 通用面 | 已做 | `apps/server/test/capabilities.test.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts`<br>`apps/web/test/thinking-level.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#504](https://github.com/xiechimon/pacman/issues/504) web: 看板列超出视口高度且卡片列表无滚动出口 | 通用面 | 已做 | `apps/web/e2e/board-overflow.spec.ts` |
| [#510](https://github.com/xiechimon/pacman/issues/510) web: Agent 权限面的团队密钥改回聚合总开关（#485 的 per-secret 粒度是自造，原版没有） | 通用面 | 已做 | `docs/verify/510/`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#515](https://github.com/xiechimon/pacman/issues/515) Map: pacman 自我定位——真闭环、参考实现纪律与两轴取舍 | 通用面 | 未验证 | [未验证] |
| [#516](https://github.com/xiechimon/pacman/issues/516) 决策：pacman 凭什么存在——对抗性论证（含最强反驳「不如直接用 Multica」） | 通用面 | 未验证 | [未验证] |
| [#519](https://github.com/xiechimon/pacman/issues/519) 任务：控制面搬上常开主机 + 用 pacman 在自己仓库跑通 #510 的完整闭环（产出断裂点清单） | 通用面 | 已做 | `apps/daemon/test/machine-boot.test.ts`<br>`apps/daemon/test/review-findings.test.ts`<br>`apps/daemon/test/runner-review.test.ts`<br>`apps/server/test/artifact-gate.test.ts`<br>`apps/server/test/failed-review-restore.test.ts`<br>`apps/server/test/phase.test.ts`<br>`apps/server/test/review.test.ts` |
| [#520](https://github.com/xiechimon/pacman/issues/520) 决策：定位陈述的载体与内容（docs/spec/16 + ADR） | 通用面 | 未验证 | [未验证] |
| [#561](https://github.com/xiechimon/pacman/issues/561) web: board/notify-banner.tsx 切 components/ui/Button（#414 试点片收口；#519 真闭环试点任务） | 通用面 | 未验证 | [未验证] |
| [#610](https://github.com/xiechimon/pacman/issues/610) web: 用户菜单面板底边盖住账号行顶分隔线（#388 锚定律 × #414 seam 重叠带） | 通用面 | 已做 | `docs/verify/610/`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#612](https://github.com/xiechimon/pacman/issues/612) web: 详情对话面——用户原话无格式 + spec 区与首条气泡双渲染，系统合成 prompt 泄漏成用户气泡 | 通用面 | 已做 | `docs/verify/612/`<br>`apps/server/test/second-pr-guard.test.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/spec-brief-card.spec.ts`<br>`apps/web/e2e/transcript-user-words.spec.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`apps/web/test/transcript-issue-fence.test.ts`<br>`apps/web/test/transcript-user-words.test.ts`<br>`packages/shared/test/plan-first-round-prompt.test.ts`<br>`packages/shared/test/restart-prompt.test.ts`<br>`packages/shared/test/review-reject-prompt.test.ts` |
| [#613](https://github.com/xiechimon/pacman/issues/613) 看板面 UI 打磨：卡片标签 pill 溢出行盒 + 筛选面板并入全站 popup vocabulary | 通用面 | 已做 | `docs/verify/613/` |
| [#615](https://github.com/xiechimon/pacman/issues/615) web: 总管抽屉四连报——主模型/agent 不可设、头像不闭环、死钮、composer 未复用、UI 打磨 | 通用面 | 已做 | `docs/verify/615/`<br>`apps/server/test/chief-settings.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/chat-tools-identity.spec.ts`<br>`apps/web/e2e/chief-drawer-model.spec.ts`<br>`apps/web/e2e/shell-consistency.spec.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#616](https://github.com/xiechimon/pacman/issues/616) web: 看板拖拽抬升卡在录屏里不流畅——overlay 层逐帧重栅格 + 落位/让位曲线慢起步 | 通用面 | 已做 | `docs/verify/616/`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/test/dnd.test.ts` |
| [#624](https://github.com/xiechimon/pacman/issues/624) web: chief 抽屉输入框接 steer 占位 canon——CHIEF_INPUT_PLACEHOLDER_STEERING 已在 shared、抽屉零消费 | 通用面 | 已做 | `docs/verify/624/`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/test/i18n-coverage.test.ts` |
| [#625](https://github.com/xiechimon/pacman/issues/625) web: 抽 composer 共享 wire 核心 useComposerWire——detail 与 chief 抽屉输入逻辑单源（两件皮肤各自保留） | 通用面 | 已做 | `docs/verify/625/`<br>`apps/web/e2e/composer-wire-reject.spec.ts` |
| [#626](https://github.com/xiechimon/pacman/issues/626) web: 模型选择器收敛——三面（agent 创建 / agent 概览 / chief 主模型）实现核心单源，壳按各面裁决保留 | 通用面 | 已做 | `docs/verify/626/` |
| [#627](https://github.com/xiechimon/pacman/issues/627) server+shared: chief 新增 provider/model 候选读工具——修复「指定模型」自主环，不再靠猜 modelId 落脏值 | 通用面 | 已做 | `apps/server/test/chief-tools.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/m4b-memory.test.ts`<br>`packages/shared/test/chief-tools.test.ts` |
| [#629](https://github.com/xiechimon/pacman/issues/629) web: 板面卡按压面对齐参考站——灭「小链接」原生拖影、按压整卡 tint、卡面文本不可选中 | 通用面 | 已做 | `docs/verify/629/`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/card-press.spec.ts` |
| [#631](https://github.com/xiechimon/pacman/issues/631) web+server: 总管对话失败闭环——异常进 toast（sonner）+ 失败原因落线程，不再静默 | 通用面 | 已做 | `docs/verify/631/`<br>`apps/server/test/chief-abandoned-sweep.test.ts`<br>`apps/server/test/chief-demotion.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/web/e2e/chief-draft-persist.spec.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/composer-wire-reject.spec.ts` |
| [#634](https://github.com/xiechimon/pacman/issues/634) web: 任务详情页三件——工具块/JSON 卡对齐参考站、状态 chip 整块可点、ESC 分层退出详情 | 通用面 | 已做 | `docs/verify/634/`<br>`apps/web/e2e/chip-hotzone.spec.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-esc.spec.ts`<br>`apps/web/e2e/footer-copy.spec.ts`<br>`apps/web/test/transcript-tool-echo.test.ts` |
| [#636](https://github.com/xiechimon/pacman/issues/636) web: 看板筛选面板照参考站重做——checkbox 行 / 全选·反选行 / 全出血分隔线逐项对齐，创建者维度换成 tag | 通用面 | 已做 | `docs/verify/636/`<br>`apps/web/e2e/board-filter.spec.ts` |
| [#638](https://github.com/xiechimon/pacman/issues/638) web: 全站静默 mutation 失败面接线 toast——26 件普查账（#631 收尾） | 通用面 | 已做 | `docs/verify/638/`<br>`apps/web/e2e/board-dnd-live.spec.ts`<br>`apps/web/e2e/project-settings-identity.spec.ts` |
| [#644](https://github.com/xiechimon/pacman/issues/644) web: 总管设置 tabs 切换滑动效果（参考站实测对齐）+ 全站动效迁移 shadcn——只到原型与取舍 | 通用面 | 已做 | `docs/verify/644/`<br>`apps/web/e2e/segmented-controls.spec.ts` |
| [#650](https://github.com/xiechimon/pacman/issues/650) web: 总管抽屉助手回复走共用 markdown 解析器（** 星号漏字面）+ 用户头像取真人真值 | 通用面 | 已做 | `docs/verify/650/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#651](https://github.com/xiechimon/pacman/issues/651) web: 总管抽屉回复流式输出——消费既有 text_delta 通道 + 抽屉可滚动 | 通用面 | 已做 | `docs/verify/651/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-flight-expand.test.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#658](https://github.com/xiechimon/pacman/issues/658) web: remove dead CSS rules and orphaned primitive variants (audit groups A, B, F, G, H+I + failed-tone gap) | 通用面 | 已做 | `docs/verify/658/` |
| [#670](https://github.com/xiechimon/pacman/issues/670) web: retire the old ui/button primitive — zero consumers since XMON-25/#607 | 通用面 | 已做 | `docs/verify/670/` |
| [#672](https://github.com/xiechimon/pacman/issues/672) web: transcript 加载指示器换 loading-dev LinearDots——单点试点，#471 braille reel 退役（ADR 0009 D4 修订） | 通用面 | 已做 | `docs/verify/672/`<br>`apps/web/e2e/spinner-live.spec.ts` |
| [#675](https://github.com/xiechimon/pacman/issues/675) web: render todo mentions as chips — complete the mention SCHEME regex, revive .mention-chip--todo | 通用面 | 已做 | `docs/verify/675/`<br>`apps/web/e2e/agent-identity-chip.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts`<br>`apps/web/test/i18n-scan.test.ts`<br>`apps/web/test/segments-mention-nav.test.ts` |
| [#688](https://github.com/xiechimon/pacman/issues/688) web: 定一条 z 阶梯——活动弹层必须在常驻侧板之上（⌘J 抽屉压住新建任务面） | 通用面 | 已做 | `docs/verify/688/`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/z-ladder.spec.ts` |
| [#690](https://github.com/xiechimon/pacman/issues/690) web: migrate the ui/checkbox primitive to the official Base UI Checkbox (pilot face) | 通用面 | 已做 | `docs/verify/690/`<br>`apps/web/e2e/checkbox-unified.spec.ts` |
| [#692](https://github.com/xiechimon/pacman/issues/692) web: ⌘J 抽屉打开后工作台三栏挤成一团——board 在抽屉占位下的 reflow 重排 | 通用面 | 已做 | `docs/verify/692/`<br>`apps/web/e2e/board-docked-reflow.spec.ts`<br>`apps/web/e2e/board-zoom-fit.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#693](https://github.com/xiechimon/pacman/issues/693) test: 测试重心下移——e2e 全量归 CI，本地只跑受影响面 | 通用面 | 已做 | `docs/verify/693/` |
| [#727](https://github.com/xiechimon/pacman/issues/727) Research: composer @// Claude-Code parity + image paste — canon, diff matrix, open decisions | 通用面 | 已做 | `apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/e2e/composer-paste.spec.ts`<br>`apps/web/test/attachment-paste.test.ts`<br>`apps/web/test/completion.test.ts` |
| [#728](https://github.com/xiechimon/pacman/issues/728) web: align inline @ completion with the Claude Code interaction canon (detail composer) | 通用面 | 已做 | `docs/verify/728/`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/test/completion.test.ts`<br>`apps/web/test/mention-token.test.ts` |
| [#731](https://github.com/xiechimon/pacman/issues/731) web: add / slash completion to the detail composer (mechanism + skill vocabulary) | 通用面 | 已做 | `docs/verify/731/`<br>`apps/web/e2e/chief-drawer-slash.spec.ts`<br>`apps/web/e2e/composer-slash.spec.ts`<br>`apps/web/test/slash-commands.test.ts` |
| [#732](https://github.com/xiechimon/pacman/issues/732) web: chief-drawer composer — rule and wire the @//, attachment and paste faces (#146/#136 scope revisit) | 通用面 | 已做 | `docs/verify/732/`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#739](https://github.com/xiechimon/pacman/issues/739) web: chief drawer live-turn presence row — visible loading face while activeRun is in flight and no deltas have arrived | 通用面 | 已做 | `docs/verify/739/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-flight-expand.test.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#740](https://github.com/xiechimon/pacman/issues/740) server,web: conversation stream mid-turn catch-up — replay the in-flight delta buffer on subscribe | 通用面 | 已做 | `docs/verify/740/`<br>`apps/server/test/conv-stream-catchup.test.ts`<br>`apps/web/test/chief-stream-handoff.test.ts`<br>`apps/web/test/sse-conversation-stream.test.ts` |
| [#742](https://github.com/xiechimon/pacman/issues/742) web: chief drawer user bubbles render markdown and mention chips (same-source parser as assistant rows) | 通用面 | 已做 | `docs/verify/742/`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-markdown.test.ts` |
| [#746](https://github.com/xiechimon/pacman/issues/746) verify: 机制生效类验收必须落到编译产物/运行时实物——判据固化进 verify-pacman skill（六实例） | 通用面 | 已做 | `apps/web/e2e/composer-inline-mention.spec.ts` |
| [#751](https://github.com/xiechimon/pacman/issues/751) Chief model picker: centered modal instead of anchored popover; selected row unreadable | 通用面 | 已做 | `docs/verify/751/`<br>`apps/web/e2e/chief-drawer-model.spec.ts` |
| [#753](https://github.com/xiechimon/pacman/issues/753) web,server,shared: drag rules are stale — todos.dev 2026-10-03 recheck: pending/done cards ARE draggable, per-source target matrix | 通用面 | 已做 | `docs/verify/753/`<br>`apps/server/test/manual-drop-matrix.test.ts`<br>`apps/web/e2e/board-dnd-live.spec.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/card-press.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#757](https://github.com/xiechimon/pacman/issues/757) web: 附件在途占位 + 点击 chip 预览图片（粘贴后到渲染前的空窗） | 通用面 | 已做 | `docs/verify/757/`<br>`apps/web/e2e/attachment-strip.spec.ts`<br>`apps/web/e2e/attachment-title.spec.ts`<br>`apps/web/test/attachment-paste.test.ts`<br>`packages/shared/test/attachment-token.test.ts`<br>`packages/shared/test/records.test.ts`<br>`packages/shared/test/task-meta.test.ts` |
| [#759](https://github.com/xiechimon/pacman/issues/759) server: 附件没有回收策略——上传件永久累积（含「粘了没发」与已删任务的孤儿件） | 通用面 | 已做 | `docs/verify/759/`<br>`apps/daemon/test/step-attachments-gc.test.ts`<br>`apps/server/test/attachment-gc.test.ts` |
| [#760](https://github.com/xiechimon/pacman/issues/760) web,server: composer 的 @ 要对齐 Claude Code——补文件/目录候选面（现仅 agents-only，需仓内文件枚举 wire 面） | 通用面 | 已做 | `docs/verify/760/`<br>`apps/server/test/git-hosting.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/test/mention-token.test.ts` |
| [#765](https://github.com/xiechimon/pacman/issues/765) ci: e2e 的 --shard 从未生效——4 条分片各跑全量 688 用例（每个 PR 的 e2e 面是设计的 4 倍） | 通用面 | 已做 | `docs/verify/765/` |
| [#771](https://github.com/xiechimon/pacman/issues/771) web: 复选框取消选中时闪/弹一下（点开正常，关闭那一下抖） | 通用面 | 已做 | `docs/verify/771/`<br>`apps/web/e2e/search-close-flash.spec.ts` |
| [#772](https://github.com/xiechimon/pacman/issues/772) web: 总管设置文字格式不统一（Agent/章程/记忆混排）+ 压缩模型 picker 值被挤满 | 通用面 | 已做 | `docs/verify/772/`<br>`apps/web/e2e/chief-settings.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/thinking-row-truncate.spec.ts` |
| [#774](https://github.com/xiechimon/pacman/issues/774) web,server: 本地模型缺失时无兜底，直接「发送失败」——加 fallback | 通用面 | 已做 | `docs/verify/774/` |
| [#775](https://github.com/xiechimon/pacman/issues/775) web: composer 输入框与抽屉书框加阴影美化（better-ui 走一轮） | 通用面 | 已做 | `docs/verify/775/` |
| [#777](https://github.com/xiechimon/pacman/issues/777) web: 缓存命中率做到 UI 上（cacheRead 已有加总，只差展示） | 通用面 | 已做 | `docs/verify/777/`<br>`apps/server/test/rework-branch-reuse.test.ts` |
| [#782](https://github.com/xiechimon/pacman/issues/782) web: 换肤 Herdr 紫（米色纸面 + 暖黑底，只换色不动几何） | 通用面 | 未验证 | [未验证] |
| [#787](https://github.com/xiechimon/pacman/issues/787) web(theme): add spot-soft, spot-text-on-tint, disabled-mix and theme-switch suppression (P0) | 通用面 | 已做 | `docs/verify/787/`<br>`apps/web/e2e/theme-toggle.spec.ts` |
| [#788](https://github.com/xiechimon/pacman/issues/788) web(theme): land Herdr token values in shadcn.css (P1) | 通用面 | 已做 | `docs/verify/788/` |
| [#789](https://github.com/xiechimon/pacman/issues/789) web(theme): V2 checkbox bone 16px square plus hand-made check motion (P2) | 通用面 | 已做 | `docs/verify/789/`<br>`apps/web/e2e/checkbox-unified.spec.ts` |
| [#790](https://github.com/xiechimon/pacman/issues/790) web(theme): V2 overlay bone plus scale-fade enter replacing slide (P3) | 通用面 | 已做 | `docs/verify/790/`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#791](https://github.com/xiechimon/pacman/issues/791) web(theme): accent-soft row hovers, button brighten, danger reds and focus rings (P4+P5) | 通用面 | 已做 | `docs/verify/791/`<br>`apps/web/e2e/accent-typo.spec.ts` |
| [#792](https://github.com/xiechimon/pacman/issues/792) web(theme): board/sidebar/chief/detail/pages bone convergence (P6) | 通用面 | 已做 | `docs/verify/792/`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/sidebar-visual.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#793](https://github.com/xiechimon/pacman/issues/793) web(theme): dual-theme contrast re-measure and fixture baseline seal (P7) | 通用面 | 已做 | `docs/verify/793/` |
| [#811](https://github.com/xiechimon/pacman/issues/811) web: 总管设置页四连 bug——返回钮无反应 + 头像不同步 + 记忆页误报未选 + 关注提醒未闭环 | 通用面 | 已做 | `docs/verify/811/`<br>`apps/web/e2e/chief-settings.spec.ts` |
| [#812](https://github.com/xiechimon/pacman/issues/812) web: @ 提及选中后只插入 token 不渲染 chip，体感死板 | 通用面 | 已做 | `docs/verify/812/`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/test/mention-token.test.ts` |
| [#813](https://github.com/xiechimon/pacman/issues/813) Base UI 主题迁移地图（V2 + Herdr 紫）：目的地、已定事项与剩余雾区 | 通用面 | 未验证 | [未验证] |
| [#814](https://github.com/xiechimon/pacman/issues/814) web: 新建任务输入框有序列表自动续行（只做 1. 2. 3.） | 通用面 | 已做 | `docs/verify/814/`<br>`apps/web/e2e/spec-brief-card.spec.ts`<br>`apps/web/test/ordered-list.test.ts` |
| [#821](https://github.com/xiechimon/pacman/issues/821) web: loading 菊花换主题色 + 呼吸效果 | 通用面 | 已做 | `docs/verify/821/`<br>`apps/web/e2e/spinner-live.spec.ts` |
| [#822](https://github.com/xiechimon/pacman/issues/822) web: 回合在飞存在行可展开看实时步骤（现在箭头是死的） | 通用面 | 已做 | `docs/verify/822/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/activity-live-row.test.ts`<br>`apps/web/test/chief-flight-expand.test.ts` |
| [#823](https://github.com/xiechimon/pacman/issues/823) web: 输入自然话自动识别 skill 并提示（不做嵌入式链） | 通用面 | 已做 | `docs/verify/823/`<br>`apps/server/test/chief-skill-route.test.ts`<br>`packages/shared/test/skill-inject.test.ts`<br>`packages/shared/test/skill-route.test.ts` |
| [#827](https://github.com/xiechimon/pacman/issues/827) web: 任务详情页顶部下滑时呈覆盖态而非平铺（需长内容复现） | 通用面 | 已做 | `docs/verify/827/`<br>`apps/web/e2e/spec-flow.spec.ts` |
| [#828](https://github.com/xiechimon/pacman/issues/828) web: 卡片分支钮顶着下载 glyph（点不开或误导），无分支的卡应隐藏 | 通用面 | 已做 | `docs/verify/828/`<br>`apps/web/e2e/branch-button.spec.ts` |
| [#837](https://github.com/xiechimon/pacman/issues/837) web(theme): 主题残留面收敛——徽标/按钮/圆点/输入框等未迁移色 | 通用面 | 已做 | `docs/verify/837/` |
| [#840](https://github.com/xiechimon/pacman/issues/840) chore: drive-project-new-form.mjs 仍期望 indigo 焦点边（#839 发现的探针残留） | 通用面 | 已做 | `docs/verify/840/` |
| [#841](https://github.com/xiechimon/pacman/issues/841) web: 总管抽屉输入框缺 / 补全——/clear 被当正文发出去了 | 通用面 | 已做 | `docs/verify/841/`<br>`apps/web/e2e/chief-drawer-slash.spec.ts` |
| [#844](https://github.com/xiechimon/pacman/issues/844) web: 搜索面板第二次 Ctrl+K 关闭时闪一下（ retained 挂载疑似） | 通用面 | 已做 | `docs/verify/844/`<br>`apps/web/e2e/search-close-flash.spec.ts` |
| [#848](https://github.com/xiechimon/pacman/issues/848) 内联 @ 候选开五类（#727 D3 落地） | 通用面 | 已做 | `docs/verify/848/`<br>`apps/web/e2e/composer-inline-mention.spec.ts`<br>`apps/web/test/mention-token.test.ts` |
| [#849](https://github.com/xiechimon/pacman/issues/849) 全站输入框圆角统一为直角（V2 骨架收敛） | 通用面 | 已做 | `docs/verify/849/` |
| [#853](https://github.com/xiechimon/pacman/issues/853) web(851): consolidate parallel chip skins into ui chip primitive | 通用面 | 已做 | `docs/verify/853/` |
| [#854](https://github.com/xiechimon/pacman/issues/854) web(851): migrate hand-rolled overlay plates to shared primitives plus color escape | 通用面 | 已做 | `docs/verify/854/`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#855](https://github.com/xiechimon/pacman/issues/855) web(851): rule on bare input sites, primitive or deliberate-native | 通用面 | 已做 | `docs/verify/855/` |
| [#857](https://github.com/xiechimon/pacman/issues/857) chief 抽屉流式闪清：每轮首条刚发完就清空，只留终稿 | 通用面 | 已做 | `docs/verify/857/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/test/chief-stream-handoff.test.ts`<br>`apps/web/test/sse-conversation-stream.test.ts` |
| [#860](https://github.com/xiechimon/pacman/issues/860) 对话框 composer 加上有序列表自动续行（Enter 发送 / Shift+Enter 换行续号） | 通用面 | 已做 | `docs/verify/860/`<br>`apps/web/e2e/chief-panel.spec.ts` |
| [#872](https://github.com/xiechimon/pacman/issues/872) web: 模型选择器选中态改「整行铺满高亮」（去掉勾与文字间的空档） | 通用面 | 已做 | `docs/verify/872/`<br>`apps/web/e2e/chief-settings.spec.ts` |
| [#873](https://github.com/xiechimon/pacman/issues/873) web: 对话面统一——流式行秒数卡 1s / 右侧按钮点不动 / 需要自动下滑 | 通用面 | 已做 | `docs/verify/873/`<br>`apps/web/e2e/skills-routing.spec.ts`<br>`apps/web/test/transcript-quiescent.test.ts` |
| [#884](https://github.com/xiechimon/pacman/issues/884) web: 详情行的「恢复」图形是死形 —— 接真或去掉，不做补丁 | 通用面 | 已做 | `docs/verify/884/`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#885](https://github.com/xiechimon/pacman/issues/885) web: 收尾评审记的既有 LOW 项 —— 活行靶高 20px / 320px 窄列横向溢出 | 通用面 | 已做 | `docs/verify/885/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/detail-narrow.spec.ts` |
| [#886](https://github.com/xiechimon/pacman/issues/886) web: Chief 卡边界看不见 + 与「创建 Agent」卡风格不统一 | 通用面 | 已做 | `docs/verify/886/` |
| [#905](https://github.com/xiechimon/pacman/issues/905) web+server: 提出需求后只有「处理中…」一个黑盒状态 —— 要可见（在干什么 / 到哪一步 / 为什么久） | 通用面 | 已做 | `docs/verify/905/`<br>`apps/daemon/test/activity.test.ts`<br>`apps/server/test/conv-stream-catchup.test.ts`<br>`apps/server/test/m5-face.test.ts`<br>`apps/web/test/activity-live-row.test.ts`<br>`apps/web/test/sse-conversation-stream.test.ts` |
| [#908](https://github.com/xiechimon/pacman/issues/908) Map: 全站 UI 换代——全量 shadcn 化 + 色相重选 + 几何重设计（像素纪律退役） | 通用面 | 未验证 | [未验证] |
| [#909](https://github.com/xiechimon/pacman/issues/909) 全站视觉方向重选：候选色板 × 双版原型，用户审后定版 | 通用面 | 未验证 | [未验证] |
| [#910](https://github.com/xiechimon/pacman/issues/910) 新 e2e 钉扎口径：per-face 类名清零后 locator 与视觉探针钉什么 | 通用面 | 已做 | `apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/attachment-strip.spec.ts`<br>`apps/web/e2e/attachment-title.spec.ts`<br>`apps/web/e2e/avatar-dicebear.spec.ts`<br>`apps/web/e2e/board-dnd-live.spec.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/board-docked-reflow.spec.ts`<br>`apps/web/e2e/board-filter.spec.ts`<br>`apps/web/e2e/board-overflow.spec.ts`<br>`apps/web/e2e/branch-button.spec.ts`<br>`apps/web/e2e/card-press.spec.ts`<br>`apps/web/e2e/chat-md-toolout.spec.ts`<br>`apps/web/e2e/chat-tools-identity.spec.ts`<br>`apps/web/e2e/chat-type-measure.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/chip-assign.spec.ts`<br>`apps/web/e2e/composer-paste.spec.ts`<br>`apps/web/e2e/composer-slash.spec.ts`<br>`apps/web/e2e/composer-wire-reject.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/e2e/detail-esc.spec.ts`<br>`apps/web/e2e/detail-narrow.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/diff-full-file.spec.ts`<br>`apps/web/e2e/diff-word-highlight.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/file-viewer.spec.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/machines-chief-state.spec.ts`<br>`apps/web/e2e/machines-local.spec.ts`<br>`apps/web/e2e/machines-shell-switch.spec.ts`<br>`apps/web/e2e/mention-picker-center.spec.ts`<br>`apps/web/e2e/merge-reject.spec.ts`<br>`apps/web/e2e/newtask-project-persist.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/newtask-single-field.spec.ts`<br>`apps/web/e2e/notify-banner.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/plan-diff-full-file.spec.ts`<br>`apps/web/e2e/project-commit-detail.spec.ts`<br>`apps/web/e2e/project-empty-new-task.spec.ts`<br>`apps/web/e2e/project-files-local.spec.ts`<br>`apps/web/e2e/project-github-issues.spec.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-fs-pick.spec.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts`<br>`apps/web/e2e/project-tasks-toolbar.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts`<br>`apps/web/e2e/providers-tabs.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/review-reject.spec.ts`<br>`apps/web/e2e/search-close-flash.spec.ts`<br>`apps/web/e2e/search-focus.spec.ts`<br>`apps/web/e2e/search-result-rows.spec.ts`<br>`apps/web/e2e/secret-add-dialog.spec.ts`<br>`apps/web/e2e/segmented-controls.spec.ts`<br>`apps/web/e2e/shell-consistency.spec.ts`<br>`apps/web/e2e/sidebar-nav.spec.ts`<br>`apps/web/e2e/sidebar-seam.spec.ts`<br>`apps/web/e2e/sidebar-search-offboard.spec.ts`<br>`apps/web/e2e/sidebar-visual.spec.ts`<br>`apps/web/e2e/skills-page.spec.ts`<br>`apps/web/e2e/skills-write.spec.ts`<br>`apps/web/e2e/spinner-live.spec.ts`<br>`apps/web/e2e/title-band-clicks.spec.ts`<br>`apps/web/e2e/transcript-user-words.spec.ts`<br>`apps/web/e2e/user-menu-nav.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts`<br>`apps/web/e2e/z-ladder.spec.ts`<br>`apps/web/test/segments-mention-nav.test.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/m7-branch-dialog-e2e.test.ts`<br>`integration/test/task-meta-e2e.test.ts` |
| [#912](https://github.com/xiechimon/pacman/issues/912) 几何与色彩 token scale 正本表：从定版原型提炼逐域施工正本 | 通用面 | 未验证 | [未验证] |
| [#919](https://github.com/xiechimon/pacman/issues/919) integration: 技能路由的行为验收 —— 不提技能的票，看 lane 自己命中 | 通用面 | 已做 | `docs/verify/919/`<br>`apps/daemon/test/skills-version-skew.test.ts`<br>`apps/web/e2e/skills-routing.spec.ts`<br>`integration/test/skills-routing-e2e.test.ts` |
| [#921](https://github.com/xiechimon/pacman/issues/921) 探针 dump 工具：视觉重钉机械化的采集与对照表生成 | 通用面 | 已做 | `docs/verify/921/` |
| [#932](https://github.com/xiechimon/pacman/issues/932) web: 320px 窄列横向溢出修复（#885 记录在案项落地） | 通用面 | 已做 | `docs/verify/932/`<br>`apps/web/e2e/detail-narrow.spec.ts` |
| [#933](https://github.com/xiechimon/pacman/issues/933) web: 折叠工具组行补最小身份（裸 pill 读感修复） | 通用面 | 已做 | `docs/verify/933/`<br>`apps/web/e2e/chat-tools-identity.spec.ts` |
| [#938](https://github.com/xiechimon/pacman/issues/938) chore: squash 合并下的清场脚本 —— 判据用 GitHub merged 列表，不猜祖先关系 | 通用面 | 已做 | `docs/verify/938/` |
| [#942](https://github.com/xiechimon/pacman/issues/942) ui/ 原语退役正典表：chip 五态→badge 映射 + input 几何处置 + .dlg-* 别名 | 通用面 | 已做 | `docs/verify/942/`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/secret-add-dialog.spec.ts`<br>`apps/web/e2e/skills-write.spec.ts` |
| [#943](https://github.com/xiechimon/pacman/issues/943) 域施工·board/sidebar：board.css 189 行清零 + 16 裸控件 shadcn 化（验收模板 v2 首验） | 通用面 | 已做 | `docs/verify/943/`<br>`apps/web/e2e/board-dnd-live.spec.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/board-docked-reflow.spec.ts`<br>`apps/web/e2e/board-filter.spec.ts`<br>`apps/web/e2e/board-overflow.spec.ts`<br>`apps/web/e2e/card-press.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/notify-banner.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts`<br>`apps/web/e2e/search-close-flash.spec.ts`<br>`apps/web/e2e/search-focus.spec.ts`<br>`apps/web/e2e/shell-consistency.spec.ts`<br>`apps/web/e2e/sidebar-nav.spec.ts`<br>`apps/web/e2e/sidebar-seam.spec.ts`<br>`apps/web/e2e/sidebar-search-offboard.spec.ts`<br>`apps/web/e2e/sidebar-visual.spec.ts`<br>`apps/web/e2e/user-menu-nav.spec.ts`<br>`apps/web/e2e/user-menu-trigger.spec.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/task-meta-e2e.test.ts` |
| [#944](https://github.com/xiechimon/pacman/issues/944) 域施工·resources：resources.css 806 行清零 + 17 裸控件与老原语 4 处退役（验收模板 v2 首验） | 通用面 | 已做 | `docs/verify/944/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/machines-chief-state.spec.ts`<br>`apps/web/e2e/machines-local.spec.ts`<br>`apps/web/e2e/machines-shell-switch.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/provider-oauth.spec.ts`<br>`apps/web/e2e/providers-tabs.spec.ts`<br>`apps/web/e2e/secret-add-dialog.spec.ts`<br>`apps/web/e2e/skills-page.spec.ts`<br>`apps/web/e2e/skills-write.spec.ts` |
| [#945](https://github.com/xiechimon/pacman/issues/945) 域施工·detail-a：detail.css 2147 行清零 + 本域 spec 重钉 | 通用面 | 已做 | `docs/verify/945/`<br>`apps/web/e2e/branch-button.spec.ts`<br>`apps/web/e2e/chat-md-toolout.spec.ts`<br>`apps/web/e2e/chat-tools-identity.spec.ts`<br>`apps/web/e2e/chat-type-measure.spec.ts`<br>`apps/web/e2e/chip-hotzone.spec.ts`<br>`apps/web/e2e/composer-paste.spec.ts`<br>`apps/web/e2e/composer-slash.spec.ts`<br>`apps/web/e2e/composer-wire-reject.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/e2e/detail-esc.spec.ts`<br>`apps/web/e2e/detail-narrow.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/diff-full-file.spec.ts`<br>`apps/web/e2e/diff-word-highlight.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/plan-diff-full-file.spec.ts`<br>`apps/web/e2e/project-github-issues.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/spinner-live.spec.ts`<br>`apps/web/e2e/transcript-user-words.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#946](https://github.com/xiechimon/pacman/issues/946) 域施工·pages：pages.css 2058 行清零 + 本域 spec 重钉 | 通用面 | 已做 | `docs/verify/946/`<br>`apps/web/e2e/file-viewer.spec.ts`<br>`apps/web/e2e/project-empty-new-task.spec.ts`<br>`apps/web/e2e/project-files-local.spec.ts`<br>`apps/web/e2e/project-github-issues.spec.ts`<br>`apps/web/e2e/project-new-dir-browser.spec.ts`<br>`apps/web/e2e/project-new-fs-pick.spec.ts`<br>`apps/web/e2e/project-new-github.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/e2e/project-settings-dead-buttons.spec.ts`<br>`apps/web/e2e/project-settings-delete.spec.ts`<br>`apps/web/e2e/project-tasks-toolbar.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#947](https://github.com/xiechimon/pacman/issues/947) 域施工·secondary：secondary.css 850 行清零 + 手工 toggle→Switch | 通用面 | 已做 | `docs/verify/947/`<br>`apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/segmented-controls.spec.ts` |
| [#948](https://github.com/xiechimon/pacman/issues/948) 域施工·overlay/ 族：四件 CSS 1322 行清零 + new-task/more-menu/mention-picker shadcn 化 | 通用面 | 已做 | `docs/verify/948/`<br>`apps/web/e2e/attachment-strip.spec.ts`<br>`apps/web/e2e/attachment-title.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-esc.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/mention-picker-center.spec.ts`<br>`apps/web/e2e/newtask-project-persist.spec.ts`<br>`apps/web/e2e/newtask-project-select.spec.ts`<br>`apps/web/e2e/newtask-single-field.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/z-ladder.spec.ts`<br>`apps/web/test/segments-mention-nav.test.ts` |
| [#949](https://github.com/xiechimon/pacman/issues/949) 域施工·overlays/ 族：overlays.css 541 行清零 + search-panel chip×3 退役 | 通用面 | 已做 | `docs/verify/949/`<br>`apps/web/e2e/avatar-dicebear.spec.ts`<br>`apps/web/e2e/chip-assign.spec.ts`<br>`apps/web/e2e/chip-hotzone.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/e2e/detail-esc.spec.ts`<br>`apps/web/e2e/escape-wiring.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/search-close-flash.spec.ts`<br>`apps/web/e2e/search-focus.spec.ts`<br>`apps/web/e2e/search-result-rows.spec.ts`<br>`apps/web/e2e/sidebar-search-offboard.spec.ts`<br>`integration/test/m7-branch-dialog-e2e.test.ts` |
| [#950](https://github.com/xiechimon/pacman/issues/950) 域施工·chief：chief.css 1621 行清零（开工先重侦察，装不下即拆票） | 通用面 | 已做 | `docs/verify/950/`<br>`apps/web/e2e/agent-identity-chip.spec.ts`<br>`apps/web/e2e/attachment-strip.spec.ts`<br>`apps/web/e2e/chief-composer-tools.spec.ts`<br>`apps/web/e2e/chief-drawer-model.spec.ts`<br>`apps/web/e2e/chief-drawer-slash.spec.ts`<br>`apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/chief-settings.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/chip-assign.spec.ts`<br>`apps/web/e2e/composer-wire-reject.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/detail-3pane.spec.ts`<br>`apps/web/e2e/detail-narrow.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/notify-click.spec.ts`<br>`apps/web/e2e/shadcn-primitives.spec.ts`<br>`apps/web/e2e/z-ladder.spec.ts`<br>`apps/web/test/chief-identity.test.ts` |
| [#951](https://github.com/xiechimon/pacman/issues/951) 域施工·detail-b：detail/overlays.css 794 行清零（detail 域收尾，域内串行） | 通用面 | 已做 | `docs/verify/951/`<br>`apps/web/e2e/avatar-dicebear.spec.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/branch-button.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/merge-reject.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/review-reject.spec.ts`<br>`integration/test/m5-web-e2e.test.ts`<br>`integration/test/m7-branch-dialog-e2e.test.ts` |
| [#952](https://github.com/xiechimon/pacman/issues/952) 散件收尾：routes/components 残余清零 + ui/ 目录终删 + toggle 删槽 + spec-22 撞号处置 | 通用面 | 已做 | `docs/verify/952/`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/e2e/agent-delete.spec.ts`<br>`apps/web/e2e/branch-button.spec.ts`<br>`apps/web/e2e/checkbox-unified.spec.ts`<br>`apps/web/e2e/chief-settings.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/machine-add-dialog.spec.ts`<br>`apps/web/e2e/merge-reject.spec.ts`<br>`apps/web/e2e/provider-add-dialog.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/review-reject.spec.ts`<br>`apps/web/e2e/skills-write.spec.ts`<br>`apps/web/test/ui-reuse-inventory.test.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#953](https://github.com/xiechimon/pacman/issues/953) sealed 封版：全量 e2e + 探针整体重钉封版 + t-0909 退役 + #908 关图核账 | 通用面 | 已做 | `docs/verify/953/`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/merge-reject.spec.ts`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/review-reject.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#966](https://github.com/xiechimon/pacman/issues/966) CI flake（第二次命中）：runner-local.test.ts:289「失败方式 3」5s vitest 默认超时 | 通用面 | 已做 | `docs/verify/966/`<br>`apps/daemon/test/runner-create-tag.test.ts`<br>`apps/daemon/test/runner-cred-fallback.test.ts`<br>`apps/daemon/test/runner-local.test.ts` |
| [#983](https://github.com/xiechimon/pacman/issues/983) 手写件与适配层判决表：8 个本地文件逐个定替换、适配改写或退役 | 通用面 | 已做 | `apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/shadcn-primitives.spec.ts` |
| [#984](https://github.com/xiechimon/pacman/issues/984) chief 聊天面差距侦察：现状对话流 vs registry chat 原语族 | 通用面 | 已做 | `apps/web/e2e/chief-stream-markdown.spec.ts` |
| [#986](https://github.com/xiechimon/pacman/issues/986) e2e 与视觉探针受影响面盘点：官方几何下钉点会动多少 | 通用面 | 已做 | `apps/web/e2e/reject-chain.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#987](https://github.com/xiechimon/pacman/issues/987) token 架构收敛映射：现行槽全集 vs 官方主题变量集，逐槽判死留 | 通用面 | 已做 | `apps/web/e2e/accent-typo.spec.ts` |
| [#988](https://github.com/xiechimon/pacman/issues/988) 色调重选实审定版：候选色板 × 官方默认几何 × 代表页原型 | 通用面 | 已做 | `docs/verify/988/` |
| [#1002](https://github.com/xiechimon/pacman/issues/1002) 批次 0a：色板落地——#988 定版分支 cherry-pick + 槽位收敛 + 色值 e2e 整批重钉 | 通用面 | 已做 | `docs/verify/1002/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/e2e/spec-brief-card.spec.ts` |
| [#1004](https://github.com/xiechimon/pacman/issues/1004) 波 1 L1：board/sidebar 域原型 + 施工一体车道（8398） | 通用面 | 已做 | `docs/verify/1004/`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/shadcn-primitives.spec.ts` |
| [#1005](https://github.com/xiechimon/pacman/issues/1005) 波 1 L2：resources+secondary 域原型 + 施工一体车道（8399） | 通用面 | 已做 | `docs/verify/1005/` |
| [#1006](https://github.com/xiechimon/pacman/issues/1006) 波 1 L3：detail-a+b 域原型 + 施工一体车道（道内串行，8400） | 通用面 | 已做 | `docs/verify/1006/`<br>`apps/web/e2e/reject-chain.spec.ts`<br>`apps/web/e2e/shadcn-primitives.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#1007](https://github.com/xiechimon/pacman/issues/1007) 波 1 L4：pages 域原型 + 施工一体车道（8401） | 通用面 | 已做 | `docs/verify/1007/`<br>`apps/web/e2e/overlay-focus.spec.ts` |
| [#1008](https://github.com/xiechimon/pacman/issues/1008) 波 1 L5：overlay+overlays 域原型 + 施工一体车道（floating-shell 退役承载，8402） | 通用面 | 已做 | `docs/verify/1008/`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/e2e/board-overflow.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts` |
| [#1009](https://github.com/xiechimon/pacman/issues/1009) 波 1 L6：chief 族原型 + 施工一体车道（A0→A1→A2→B 四段串行，8403） | 通用面 | 已做 | `docs/verify/1009/`<br>`apps/web/e2e/agent-identity-chip.spec.ts`<br>`apps/web/e2e/board-docked-reflow.spec.ts`<br>`apps/web/e2e/chat-type-measure.spec.ts`<br>`apps/web/e2e/chief-draft-persist.spec.ts`<br>`apps/web/e2e/chief-fab.spec.ts`<br>`apps/web/e2e/chief-minimize-scroll.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/hotkeys.spec.ts`<br>`apps/web/e2e/notify-click.spec.ts`<br>`apps/web/e2e/page-scroll.spec.ts`<br>`apps/web/e2e/spec-flow.spec.ts`<br>`apps/web/test/chief-segments.test.ts` |
| [#1010](https://github.com/xiechimon/pacman/issues/1010) 波 2：select.tsx 手写件退役 | 通用面 | 已做 | `docs/verify/1010/`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/schedules-live.spec.ts`<br>`integration/test/m5-web-e2e.test.ts` |
| [#1011](https://github.com/xiechimon/pacman/issues/1011) 波 2：#883 model picker 焦点环再评（官方几何落地后） | 通用面 | 已做 | `docs/verify/1011/` |
| [#1012](https://github.com/xiechimon/pacman/issues/1012) 波 2：sealed 封版——全量 e2e + 探针封版 + #980 关图核账 | 通用面 | 已做 | `docs/verify/1012/` |
| [#1013](https://github.com/xiechimon/pacman/issues/1013) 波 0（docs-only）：延迟入账——ADR 0009 D3② 修订、品牌槽位闭合、docs/spec 余册标注 | 通用面 | 未验证 | [未验证] |
| [#1030](https://github.com/xiechimon/pacman/issues/1030) web+server: 给本地仓库项目开 Files tab（推翻 spec 12 的 out-of-scope） | 通用面 | 已做 | `docs/verify/1030/`<br>`apps/server/test/project-local.test.ts`<br>`apps/web/e2e/project-files-local.spec.ts` |
| [#1031](https://github.com/xiechimon/pacman/issues/1031) web: /app/account 两个控件点不动（改名未接线 + 通知开关单向空操作） | 通用面 | 已做 | `docs/verify/1031/`<br>`apps/server/test/user-patch.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/account-controls.spec.ts`<br>`apps/web/e2e/account-team-cleanse.spec.ts`<br>`apps/web/e2e/notify-click.spec.ts`<br>`apps/web/test/notify-pref.test.ts` |
| [#1032](https://github.com/xiechimon/pacman/issues/1032) web: 总管设置-记忆无法下滑（容器缺 overflow-y-auto），同类 6 处页面一并收口 | 通用面 | 已做 | `docs/verify/1032/`<br>`apps/web/e2e/page-scroll.spec.ts` |
| [#1033](https://github.com/xiechimon/pacman/issues/1033) web: 主管聊天巨幅头像（#950 退役 chief.css 留下的死类名 → 头像无尺寸约束） | 通用面 | 已做 | `docs/verify/1033/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts` |
| [#1034](https://github.com/xiechimon/pacman/issues/1034) web: 聊天思考行不截断（w-fit + nowrap 撑成整段文本宽；那个 … 是 JS 切的不是 CSS） | 通用面 | 已做 | `docs/verify/1034/`<br>`apps/web/e2e/chief-stream-markdown.spec.ts`<br>`apps/web/e2e/thinking-row-truncate.spec.ts` |
| [#1035](https://github.com/xiechimon/pacman/issues/1035) web: 110% 缩放看板不自适应（280px 列地板在窄视口接管；按 data-chief-open 劈开） | 通用面 | 已做 | `docs/verify/1035/`<br>`apps/web/e2e/board-docked-reflow.spec.ts`<br>`apps/web/e2e/board-zoom-fit.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts` |
| [#1036](https://github.com/xiechimon/pacman/issues/1036) web: 扫全仓 #950 退役 chief.css 留下的死类名（零命中类名 → 布局静默塌掉） | 通用面 | 已做 | `docs/verify/1036/` |
| [#1037](https://github.com/xiechimon/pacman/issues/1037) web: 新建定时「部分按钮点不动」（fixture 面哑按钮 + live 面假行 + 对话框无上限） | 通用面 | 已做 | `docs/verify/1037/`<br>`apps/web/e2e/dead-buttons.spec.ts`<br>`apps/web/e2e/dialog-viewport.spec.ts`<br>`apps/web/e2e/fixture-mode-chip.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/schedules-live.spec.ts` |
| [#1039](https://github.com/xiechimon/pacman/issues/1039) chore: verify-pacman 的「Last updated」单行链是合并冲突磁铁（一夜 6 次手工解冲突） | 通用面 | 已做 | `docs/verify/1039/` |
| [#1048](https://github.com/xiechimon/pacman/issues/1048) web: 令牌弹层不说令牌从哪来（纯信息缺口，只补指引） | 通用面 | 已做 | `docs/verify/1048/`<br>`apps/web/e2e/token-gate.spec.ts` |
| [#1049](https://github.com/xiechimon/pacman/issues/1049) chief: 结构化问答通道（ask_user 升级 + 阻塞语义 + 界面问答卡 + 两后端映射） | 通用面 | 已做 | `docs/verify/1049/`<br>`apps/daemon/test/ask-channel.test.ts`<br>`apps/server/test/chief-questions.test.ts`<br>`apps/server/test/wire.test.ts`<br>`integration/test/chief-ask-user.test.ts` |
| [#1055](https://github.com/xiechimon/pacman/issues/1055) web: 品牌墨被当文字色用了 25 处（「有的紫有的黑」的根因；正典只许它做 spot 强调） | 通用面 | 已做 | `docs/verify/1055/` |
| [#1067](https://github.com/xiechimon/pacman/issues/1067) chief: 停靠载体改 inert/opacity——让「最小化后滚动位置保留」成为可达（Multica 形态） | 通用面 | 已做 | `docs/verify/1067/`<br>`apps/web/e2e/chief-minimize-scroll.spec.ts`<br>`apps/web/e2e/chief-panel.spec.ts`<br>`apps/web/e2e/chief-toggle-flash.spec.ts` |
| [#1079](https://github.com/xiechimon/pacman/issues/1079) ci: PR 模板收成单正本（七节·标题精简）+ 验收节 + 失败路径加严 | 通用面 | 已做 | `docs/verify/1079/` |
| [#1084](https://github.com/xiechimon/pacman/issues/1084) web: select.tsx 退役（#1010）打坏 main——schedules-live e2e 仍在点旧的手写 select | 通用面 | 已做 | `docs/verify/1084/`<br>`apps/web/e2e/schedules-live.spec.ts` |
| [#1091](https://github.com/xiechimon/pacman/issues/1091) web: harden boot-time storage reads against unavailable localStorage | 通用面 | 已做 | `docs/verify/1091/`<br>`apps/web/e2e/storage-unavailable.spec.ts` |
| [#1094](https://github.com/xiechimon/pacman/issues/1094) web: 总管主题切换器列表无高度上限——长列表冲出抽屉，尾部条目点不到 | 通用面 | 已做 | `docs/verify/1094/`<br>`apps/web/e2e/chief-thread-switcher-scroll.spec.ts` |
| [#1095](https://github.com/xiechimon/pacman/issues/1095) web: model picker 行焦点环被 listbox 裁剪 + 两面行内缩不统一（#883 重切） | 通用面 | 已做 | `docs/verify/1095/` |
| [#1097](https://github.com/xiechimon/pacman/issues/1097) web+server: 项目 Files 面不区分文件夹，点文件夹必「文件加载失败」 | 通用面 | 已做 | `docs/verify/1097/`<br>`apps/server/test/project-local.test.ts`<br>`apps/web/e2e/project-commit-detail.spec.ts`<br>`apps/web/e2e/project-files-tree.spec.ts` |
| [#1102](https://github.com/xiechimon/pacman/issues/1102) web+server: 项目「历史」列表加提交详情面（点一行看该提交的 diff） | 通用面 | 已做 | `docs/verify/1102/`<br>`apps/server/test/git-hosting.test.ts`<br>`apps/server/test/project-local.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/project-commit-detail.spec.ts` |
| [#1104](https://github.com/xiechimon/pacman/issues/1104) run_builds 无指派 build 静默卡死：chief 入口 400 打回，其他入口步 Fail 落 errorMessage | 通用面 | 已做 | `docs/verify/1104/`<br>`apps/server/test/machine-concurrency.test.ts`<br>`apps/server/test/rework-plan-fallback.test.ts`<br>`apps/server/test/unassigned-build.test.ts` |
| [#1106](https://github.com/xiechimon/pacman/issues/1106) server: 派发管线技能注入——目录粗分发 + description 细触发注入任务 brief | 通用面 | 已做 | `docs/verify/1106/`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/server/test/skill-inject-claim.test.ts`<br>`apps/web/e2e/skill-inject.spec.ts`<br>`apps/web/test/injected-skills-row.test.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`integration/test/skills-routing-e2e.test.ts`<br>`packages/shared/test/skill-inject.test.ts`<br>`packages/shared/test/skill-injection-check.test.ts` |
| [#1110](https://github.com/xiechimon/pacman/issues/1110) pr: 全局 /pr 技能模板与仓 PR 模板不一致，每条 lane 都要手改一次 body（今天三连） | 通用面 | 已做 | `docs/verify/1110/` |
| [#1112](https://github.com/xiechimon/pacman/issues/1112) hooks: 禁词钩子按子串扫 staged 内容，被 base64 误伤（drawio svg 回退层含 TODO） | 通用面 | 已做 | `docs/verify/1112/` |
| [#1113](https://github.com/xiechimon/pacman/issues/1113) e2e: chief-thread-switcher-scroll 用 toBe 钉浮点宽度，亚像素必飘 | 通用面 | 已做 | `docs/verify/1113/`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/chief-thread-switcher-scroll.spec.ts` |
| [#1114](https://github.com/xiechimon/pacman/issues/1114) e2e: board-dnd 拖拽 tracer 在 mouse-up 之前采样，时序竞态 | 通用面 | 已做 | `docs/verify/1114/`<br>`apps/web/e2e/board-dnd.spec.ts` |
| [#1116](https://github.com/xiechimon/pacman/issues/1116) skills: 目录 50 条上限把一半技能静默丢掉（本机 99 个只有 50 个进得去 agent） | 通用面 | 已做 | `docs/verify/1116/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/skills-catalog.test.ts`<br>`apps/server/test/machine-wire.test.ts` |
| [#1121](https://github.com/xiechimon/pacman/issues/1121) chore: repo hygiene — ignore tool-local dirs, retire orphan evidence/, add docs index | 通用面 | 已做 | `docs/verify/1121/` |
| [#1123](https://github.com/xiechimon/pacman/issues/1123) docs(adr): record the evidence-storage permanence decision | 通用面 | 已做 | `docs/verify/1123/` |
| [#1126](https://github.com/xiechimon/pacman/issues/1126) web: extract chief-drawer message-row renderers into chief-message-rows.tsx | 通用面 | 已做 | `docs/verify/1126/` |
| [#1127](https://github.com/xiechimon/pacman/issues/1127) web: extract todo-detail-page composer-wiring and actions hooks | 通用面 | 已做 | `docs/verify/1127/` |
| [#1129](https://github.com/xiechimon/pacman/issues/1129) docs: assess docs/research/ (36M) — index, archive, or leave | 通用面 | 已做 | `docs/verify/1129/` |
| [#1151](https://github.com/xiechimon/pacman/issues/1151) ops: server DB 定时备份（mea cron + scp dmit）与恢复演练 | 通用面 | 已做 | `docs/verify/1151/` |
| [#1156](https://github.com/xiechimon/pacman/issues/1156) web: agent 详情页头像缺少定尺 class 被裁（SeededAvatar 漏传 size-16）+ e2e 只钉存在不钉几何 | 通用面 | 已做 | `docs/verify/1156/`<br>`apps/web/e2e/agent-detail.spec.ts` |
| [#1157](https://github.com/xiechimon/pacman/issues/1157) web: ResourceShell 返回键是裸 <a> 而非 <Link>，点返回整个 SPA 重新加载（15 个面同吃） | 通用面 | 已做 | `docs/verify/1157/`<br>`apps/web/e2e/resource-back-spa.spec.ts`<br>`apps/web/e2e/title-band-clicks.spec.ts` |
| [#1166](https://github.com/xiechimon/pacman/issues/1166) verify-pacman: drive.mjs api-key + search probes use retired class selectors (stale since the per-face migration) | 通用面 | 已做 | `docs/verify/1166/` |
| [#1169](https://github.com/xiechimon/pacman/issues/1169) agent.skills 拆字段：「默认携带」与「授权白名单」分家，修复新建 agent 出生即全拒 | 通用面 | 已做 | `docs/verify/1169/`<br>`apps/daemon/test/machine-step-exec.test.ts`<br>`apps/daemon/test/runner-team-skills.test.ts`<br>`apps/server/test/agent-skills-split-backfill.test.ts`<br>`apps/server/test/legacy-export.test.ts`<br>`apps/server/test/m4a-chief-loop.test.ts`<br>`apps/server/test/machine-concurrency-backfill.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`apps/server/test/skill-inject-claim.test.ts`<br>`apps/server/test/skill-injection-check.test.ts`<br>`apps/server/test/skill-write.test.ts`<br>`apps/server/test/skills-local.test.ts`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/project-settings-identity.spec.ts`<br>`apps/web/e2e/project-settings-local-path.spec.ts`<br>`integration/test/skills-inject-e2e.test.ts`<br>`integration/test/skills-routing-e2e.test.ts`<br>`packages/shared/test/records.test.ts`<br>`packages/shared/test/skill-injection-check.test.ts` |
| [#1170](https://github.com/xiechimon/pacman/issues/1170) 技能导入通道：server 支持本地路径与 GitHub URL 导入 + refresh 重拉 | 通用面 | 已做 | `docs/verify/1170/`<br>`apps/server/test/skill-import.test.ts`<br>`apps/web/e2e/skill-import.spec.ts` |
| [#1174](https://github.com/xiechimon/pacman/issues/1174) web: 项目设置页补删除入口（端点与 mutation 已存在，纯接线） | 通用面 | 已做 | `docs/verify/1174/`<br>`apps/web/e2e/project-settings-delete.spec.ts` |
| [#1181](https://github.com/xiechimon/pacman/issues/1181) verify-pacman: drive-hotkeys / drive-newtask-key 仍等退役的 .search-panel（#1166 同款欠账） | 通用面 | 已做 | `docs/verify/1181/` |
| [#1185](https://github.com/xiechimon/pacman/issues/1185) skills 导入通道（#1170 后续）：证据 result.json 的 ok 类型与计数不符 + import 部分态窗口待定夺 | 通用面 | 已做 | `docs/verify/1185/`<br>`apps/server/test/skill-import.test.ts` |
| [#1192](https://github.com/xiechimon/pacman/issues/1192) CI：lint warning 清存量 27 条 + 钉只降不升上限 | 通用面 | 已做 | `docs/verify/1192/` |
| [#1193](https://github.com/xiechimon/pacman/issues/1193) 修正 en 词典「创建标签」错译为 Create tags | 通用面 | 已做 | `docs/verify/1193/` |
| [#1194](https://github.com/xiechimon/pacman/issues/1194) 修复 docs/spec/09 关联节两处死链（补一级 ../） | 通用面 | 已做 | `docs/verify/1194/` |
| [#1197](https://github.com/xiechimon/pacman/issues/1197) 修复 documents.ts diff 增删行统计误杀 ++/-- 前缀行 | 通用面 | 已做 | `docs/verify/1197/` |
| [#1211](https://github.com/xiechimon/pacman/issues/1211) local-repo builds mutate the user's main checkout: conv branch fast-forwarded into local main, process files left tracked | 通用面 | 已做 | `docs/verify/1211/`<br>`apps/daemon/test/local-executor.test.ts`<br>`apps/daemon/test/runner-local.test.ts`<br>`apps/daemon/test/workspace-local-unreachable.test.ts`<br>`integration/test/g2t2-local-lifecycle.test.ts` |
| [#1216](https://github.com/xiechimon/pacman/issues/1216) web: board UI reliability trio — save-and-start doesn't start, rerun from failed unresponsive, failed card detail renders blank | 通用面 | 已做 | `docs/verify/1216/`<br>`integration/test/board-trio-e2e.test.ts` |
| [#1217](https://github.com/xiechimon/pacman/issues/1217) server: guard against a second PR for a todo whose first PR is already merged | 通用面 | 已做 | `apps/daemon/test/runner-branch-drift.test.ts`<br>`apps/server/test/machine-wire.test.ts`<br>`apps/server/test/pr-reconcile.test.ts`<br>`apps/server/test/second-pr-guard.test.ts`<br>`integration/test/done-dialog-e2e.test.ts`<br>`packages/shared/test/work-branch-note.test.ts` |
| [#1219](https://github.com/xiechimon/pacman/issues/1219) server: cancelled/stuck queued builds block scheduling — cancel returns 409 queued→queued and chief run_builds fails | 通用面 | 已做 | `apps/server/test/queued-cancel-release.test.ts` |
| [#1242](https://github.com/xiechimon/pacman/issues/1242) server,web: project identity is immutable — support rename and local→github kind conversion; PATCH silently no-ops every field except localPath | 通用面 | 已做 | `docs/verify/1242/`<br>`apps/server/test/project-dual-source.test.ts`<br>`apps/server/test/project-identity.test.ts`<br>`apps/web/e2e/project-settings-identity.spec.ts`<br>`apps/web/e2e/project-settings-local-path.spec.ts` |
| [#1243](https://github.com/xiechimon/pacman/issues/1243) web: agent description 长文本在两处渲染面溢出（团队卡固定高溢出卡盒、详情页值槽 flex-none 撑破行宽） | 通用面 | 已做 | `docs/verify/1243/`<br>`apps/server/test/agent-desc-limit.test.ts`<br>`apps/web/e2e/agent-desc-overflow.spec.ts` |
| [#1244](https://github.com/xiechimon/pacman/issues/1244) web: registry 原语 focus 皮肤压过 #388 全局环律（outline-none 在 utilities 层杀死 base 层 canon，退役灰环 ring-3/50 复活成双边框观感） | 通用面 | 已做 | `docs/verify/1244/`<br>`apps/web/e2e/dialog-ring-room.spec.ts`<br>`apps/web/e2e/overlay-focus.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts`<br>`apps/web/e2e/registry-focus-ring.spec.ts` |
| [#1245](https://github.com/xiechimon/pacman/issues/1245) web: user-menu floating 双皮肤——registry Popover Popup 自带皮肤定宽 w-72 套 legacy 面板 w-56，露空框 | 通用面 | 已做 | `docs/verify/1245/`<br>`apps/web/e2e/user-menu-trigger.spec.ts` |
| [#1246](https://github.com/xiechimon/pacman/issues/1246) web: team chart 单子节点时括号列塌成悬浮短横线、连接线断口（组织图只按 ≥2 子设计） | 通用面 | 已做 | `docs/verify/1246/` |
| [#1247](https://github.com/xiechimon/pacman/issues/1247) web: 已完成列按完成时间倒序 + 待处理卡可拖入已完成（确认 dialog 兜底） | 通用面 | 已做 | `docs/verify/1247/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/server/test/manual-drop-matrix.test.ts`<br>`apps/server/test/persona-split-verify.test.ts`<br>`apps/server/test/stop-and-done-1247.test.ts`<br>`apps/server/test/wire.test.ts`<br>`apps/web/e2e/board-dnd.spec.ts`<br>`apps/web/test/columns.test.ts`<br>`apps/web/test/dnd.test.ts`<br>`packages/shared/test/vocabulary.test.ts` |
| [#1250](https://github.com/xiechimon/pacman/issues/1250) server,shared,web(1248): layer-1 role-agent pipeline — four step kinds, four assignment slots, persona seeding, chief split_todo | 通用面 | 已做 | `docs/verify/1250/`<br>`apps/daemon/test/verify-verdict.test.ts`<br>`apps/server/test/persona-split-verify.test.ts`<br>`apps/web/e2e/persona-verify.spec.ts`<br>`packages/shared/test/chief-tools.test.ts`<br>`packages/shared/test/persona.test.ts`<br>`packages/shared/test/verify-prompt.test.ts` |
| [#1255](https://github.com/xiechimon/pacman/issues/1255) web: 看板任务列表滚动位置在查看详情返回后丢失 | 通用面 | 已做 | `docs/verify/1255/`<br>`apps/web/e2e/board-scroll-restore.spec.ts` |
| [#1256](https://github.com/xiechimon/pacman/issues/1256) server,chief: 禁止任何自动合并 PR 的路径，合并只由人触发 | 通用面 | 已做 | `docs/verify/1256/`<br>`apps/server/test/chief-dispatch.test.ts`<br>`apps/server/test/mcp-face.test.ts`<br>`integration/test/m4b-watch-wake-e2e.test.ts` |
| [#1258](https://github.com/xiechimon/pacman/issues/1258) web: 失败构建的「查看原始错误」「排查指南」两处不可点 | 通用面 | 已做 | `docs/verify/1258/`<br>`apps/web/e2e/dead-buttons.spec.ts` |
| [#1263](https://github.com/xiechimon/pacman/issues/1263) 看板卡面对齐 deepseek-harness 对话框观感 | 通用面 | 已做 | `docs/verify/1263/` |
| [#1267](https://github.com/xiechimon/pacman/issues/1267) web: 全局手势/开关收进单一状态机（⌘J 二次闪的结构根因） | 通用面 | 已做 | `docs/verify/1267/`<br>`apps/web/e2e/chief-toggle-flash.spec.ts`<br>`apps/web/test/gesture-machine.test.ts` |
| [#1268](https://github.com/xiechimon/pacman/issues/1268) 详情页对齐 deepseek-harness 对话框观感（composer/气泡/发送钮） | 通用面 | 已做 | `docs/verify/1268/` |
| [#1277](https://github.com/xiechimon/pacman/issues/1277) server: 分支漂移交付改硬失败（#1275 的并集面收敛到 Multica 语义） | 通用面 | 已做 | `docs/verify/1277/`<br>`apps/server/test/artifact-gate.test.ts` |
| [#1279](https://github.com/xiechimon/pacman/issues/1279) restart 组合行漏过 classifyUserText：失败重启轮的 prompt 渲染成用户气泡 | 通用面 | 已做 | `docs/verify/1279/`<br>`packages/shared/test/restart-prompt.test.ts` |
| [#1284](https://github.com/xiechimon/pacman/issues/1284) sweepAbandonedBuildSteps 不覆盖 verify 步，陈旧认领永不释放（#50 实锤） | 通用面 | 已做 | `docs/verify/1284/`<br>`apps/server/test/build-abandoned-sweep.test.ts` |
| [#1287](https://github.com/xiechimon/pacman/issues/1287) 模型上报显示冗余：settings 别名裸上报 + 解析槽重复行，选择器应显真名并去重 | 通用面 | 已做 | `packages/shared/test/model-source.test.ts` |
| [#1288](https://github.com/xiechimon/pacman/issues/1288) 模型选择面：上游全量目录 + 活性状态（死模型置灰、活模型放行） | 通用面 | 已做 | `docs/verify/1288/`<br>`apps/web/e2e/agent-create-model.spec.ts`<br>`apps/web/test/model-options.test.ts`<br>`packages/shared/test/task-failure.test.ts` |
| [#1300](https://github.com/xiechimon/pacman/issues/1300) web: #1295 回归——agent 设置卡右侧 select/开关列左偏错位 | 通用面 | 已做 | `docs/verify/1300/`<br>`packages/shared/test/verify-prompt.test.ts` |
| [#1301](https://github.com/xiechimon/pacman/issues/1301) web: 模型下拉宽度不足，长模型 id 右侧裁切 | 通用面 | 已做 | `docs/verify/1301/`<br>`apps/web/e2e/agent-model-width.spec.ts` |
| [#1302](https://github.com/xiechimon/pacman/issues/1302) web: agent 思考强度改下拉框可变更（PATCH 面已支持） | 通用面 | 已做 | `docs/verify/1302/` |
| [#1324](https://github.com/xiechimon/pacman/issues/1324) e2e tag-chip height reads 19.99999237060547 instead of 20 | 通用面 | 已做 | `docs/verify/1324/` |
| [#1331](https://github.com/xiechimon/pacman/issues/1331) web: board-scroll-restore e2e missed scrollTop by 1px (601 vs 600) | 通用面 | 已做 | `docs/verify/1331/`<br>`apps/web/e2e/board-scroll-restore.spec.ts` |
| [#1335](https://github.com/xiechimon/pacman/issues/1335) ci: pr-evidence marks the injected Cursor badge png URLs as not-embedded | 通用面 | 已做 | `docs/verify/1335/` |
| [#1396](https://github.com/xiechimon/pacman/issues/1396) web: Paper 改版暗色一轮（先出 mockup，定稿后改 :root） | 通用面 | 已做 | `docs/verify/1396/`<br>`apps/web/e2e/color-freeze.spec.ts`<br>`apps/web/e2e/elevation-ladder.spec.ts`<br>`apps/web/e2e/project-new-repo.spec.ts` |
| [#1397](https://github.com/xiechimon/pacman/issues/1397) web: 项目页 Paper 页面（任务 / 文件两个 tab） | 通用面 | 已做 | `docs/verify/1397/`<br>`apps/web/e2e/paper-project-page.spec.ts` |
| [#1400](https://github.com/xiechimon/pacman/issues/1400) web: 待处理 means two things (fresh-task chip vs needs-you board column) | 通用面 | 已做 | `docs/verify/1400/`<br>`apps/web/e2e/agent-detail.spec.ts`<br>`apps/web/e2e/phase-chip-words.spec.ts`<br>`apps/web/e2e/queued-action.spec.ts` |
| [#1401](https://github.com/xiechimon/pacman/issues/1401) docs: 自举闭环 P0 裁决落盘（ADR 0021 自治合并 + spec 28 + 各期开票） | 通用面 | 已做 | `docs/verify/1401/` |
| [#1403](https://github.com/xiechimon/pacman/issues/1403) server: 自举闭环 P2 GitHub PR 面 + 合并对账（merged 回推 done、BEHIND/DIRTY、按 head SHA 读 checks） | 通用面 | 在跑 | `docs/verify/1403/`<br>`apps/server/test/chief-auto-confirm.test.ts`<br>`apps/server/test/chief-watch.test.ts`<br>`apps/server/test/ci-loop.test.ts`<br>`apps/server/test/gate-actor.test.ts`<br>`apps/server/test/github-repo-dot-segments.test.ts`<br>`apps/server/test/issue-fence.test.ts`<br>`apps/server/test/pr-reconcile.test.ts` |
| [#1407](https://github.com/xiechimon/pacman/issues/1407) skills,server: 自举闭环 P6 纠错回路与园丁（correct skill、纠错票触发、每周园丁定时任务） | 通用面 | 在跑 | `packages/shared/test/ticket-dedupe.test.ts` |
| [#1409](https://github.com/xiechimon/pacman/issues/1409) ops: 自举闭环 P8 毕业（shadow 十张零误放 → 演练仓五条负对照 → 本仓 autonomous）（待宿主） | 通用面 | 待开 | [未验证] |
| [#1416](https://github.com/xiechimon/pacman/issues/1416) web: 可点击的资源行把设置卡的分隔线盖成透明 | 通用面 | 已做 | `docs/verify/1416/` |
| [#1423](https://github.com/xiechimon/pacman/issues/1423) web: a queued task shows an enabled 开始 button that does nothing | 通用面 | 已做 | `docs/verify/1423/`<br>`apps/web/e2e/queued-action.spec.ts` |
| [#1427](https://github.com/xiechimon/pacman/issues/1427) web: three e2e specs fail for timing or browser-version reasons, not product bugs | 通用面 | 已做 | `docs/verify/1427/`<br>`apps/web/e2e/accent-typo.spec.ts`<br>`apps/web/e2e/registry-focus-ring.spec.ts`<br>`apps/web/e2e/segmented-controls.spec.ts` |
| [#1428](https://github.com/xiechimon/pacman/issues/1428) web: 阴影收成三档梯 e1/e2/e3（环内置）+ 暗色专用顶部高光 --top | 通用面 | 已做 | `docs/verify/1428/`<br>`apps/web/e2e/elevation-ladder.spec.ts`<br>`apps/web/e2e/visual-polish.spec.ts` |
| [#1430](https://github.com/xiechimon/pacman/issues/1430) web: theme-color / manifest / boot-skeleton 首帧颜色对齐 Paper token | 通用面 | 已做 | `docs/verify/1430/`<br>`apps/web/e2e/theme-color-meta.spec.ts`<br>`apps/web/test/pwa.test.ts` |
| [#1446](https://github.com/xiechimon/pacman/issues/1446) web: a queued task can be stopped or closed from its detail page | 通用面 | 已做 | `docs/verify/1446/`<br>`apps/web/e2e/detail-queued-exit.spec.ts` |
| [#1448](https://github.com/xiechimon/pacman/issues/1448) web: e2e specs share pressUntil instead of private hotkey retry loops | 通用面 | 已做 | `docs/verify/1448/` |
| [#1455](https://github.com/xiechimon/pacman/issues/1455) scripts: e2e-affected runs the full e2e suite when only an apps/web unit test changes | 通用面 | 已做 | `docs/verify/1455/` |
| [#1459](https://github.com/xiechimon/pacman/issues/1459) server: webhook 的 pacman 触发不核打标人，与 D5 不一致 | 通用面 | 已做 | `docs/verify/1459/`<br>`apps/server/test/github-reads.test.ts`<br>`apps/server/test/issue-intake.test.ts`<br>`apps/server/test/webhook.test.ts` |
| [#1463](https://github.com/xiechimon/pacman/issues/1463) e2e-affected: an e2e helper change selects the specs that use it, not the full suite | 通用面 | 已做 | `docs/verify/1463/` |
| [#1466](https://github.com/xiechimon/pacman/issues/1466) server,shared: githubRepo 接受 . 与 ..（GitHub 请求路径可被改写），requireProjectRow 不核团队 | 通用面 | 已做 | `docs/verify/1466/`<br>`apps/daemon/test/github-probe.test.ts`<br>`apps/server/test/github-reads.test.ts`<br>`apps/server/test/github-repo-dot-segments.test.ts`<br>`apps/server/test/pr-reconcile.test.ts`<br>`apps/server/test/project-team-guard.test.ts`<br>`apps/server/test/team-ownership-1470.test.ts`<br>`apps/server/test/team-ownership-1497.test.ts`<br>`apps/server/test/webhook.test.ts`<br>`packages/shared/test/github-repo-ref.test.ts` |
| [#1470](https://github.com/xiechimon/pacman/issues/1470) Multi-team ownership checks left after #1466: MCP run_builds and schedule_todo, conversation, usage, save_memory, clone URLs | 通用面 | 已做 | `docs/verify/1470/`<br>`apps/server/test/m4b-memory.test.ts`<br>`apps/server/test/team-ownership-1470.test.ts`<br>`apps/server/test/team-ownership-1497.test.ts` |
| [#1486](https://github.com/xiechimon/pacman/issues/1486) server: a started card moved back to todo by PATCH or reopen_todos keeps its builds and flags; reset clears them | 通用面 | 已做 | `docs/verify/1486/`<br>`apps/server/test/close-stops-active-steps.test.ts`<br>`apps/server/test/manual-drop-matrix.test.ts`<br>`apps/server/test/patch-todo-reset-gate.test.ts` |
| [#1487](https://github.com/xiechimon/pacman/issues/1487) server: a merge step that finishes after its card is closed lands on a hosted repo with no trace | 通用面 | 已做 | `docs/verify/1487/`<br>`apps/server/test/m3b-machine-git.test.ts` |
| [#1494](https://github.com/xiechimon/pacman/issues/1494) server: worker 步注入的 agent 记忆不按项目过滤，跨项目串用 | 通用面 | 已做 | `docs/verify/1494/`<br>`apps/server/test/m4b-memory.test.ts`<br>`integration/test/m4b-memory-e2e.test.ts` |
| [#1527](https://github.com/xiechimon/pacman/issues/1527) 功能地图：生成物移出 spec 编号序列、CI 加 --check、每日刷新 | 通用面 | 在跑 | `docs/verify/1527/` |

## 3. 没锚与挂不上的行（后续要补的活）

### 3.1 `[未验证]` 行

这些行没有 `docs/verify/<票号>/` 目录，CI 测试面也没有文件引用该票号——功能声称来自 spec 册，但没有可指过去的验证锚。补锚 = 补 verify 证据或补测试引用。

| 票 | 功能 | 引用它的 spec 册 |
|---|---|---|
| [#46](https://github.com/xiechimon/pacman/issues/46) | 实验：Chief 黑盒行为观察（plan 拆分/驳回回路/memory 写入/双 Agent/通知矩阵） | `docs/spec/01-stack-v2.md`<br>`docs/spec/02-架构平价.md` |
| [#56](https://github.com/xiechimon/pacman/issues/56) | Web: 详情基面 — dhead/phase 映射/流元素（r7 23/16/17 捕获组） | `docs/spec/03-ROADMAP.md` |
| [#57](https://github.com/xiechimon/pacman/issues/57) | Web: 详情深层 — 执行中/审核/完成 + 文档分栏（r7 26/27/36/38） | `docs/spec/03-ROADMAP.md` |
| [#64](https://github.com/xiechimon/pacman/issues/64) | 研究：r8 集中补拍 — 动态面像素基线（驳回/失败/复用/运行历史/AI 审核） | `docs/spec/04-验收口径.md` |
| [#81](https://github.com/xiechimon/pacman/issues/81) | M4a Chief 编排：remoteTools relay + 措辞→spec + 驳回 v2 + 双 Agent 分派 | `docs/spec/02-架构平价.md` |
| [#326](https://github.com/xiechimon/pacman/issues/326) | M7-W5.2 AI 审核 findings + blocking 自动修订回路（#312 子票） | `docs/spec/10-M7-验收报告.md` |
| [#980](https://github.com/xiechimon/pacman/issues/980) | Map: 组件形态对齐 shadcn 官网——registry 同源 + 禁手写闸 + 色调重选（每域原型先行） | `docs/spec/11-模型服务与机器本地化.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md`<br>`docs/spec/27-消费点形状与品牌墨台账.md` |
| [#37](https://github.com/xiechimon/pacman/issues/37) | 研究：协议面与 executor 行为观察（API/WS 词表、MCP、tds start、BYOK/OAuth 面） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#41](https://github.com/xiechimon/pacman/issues/41) | 设计：架构平价（编排/executor/MCP/密钥/通知） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#82](https://github.com/xiechimon/pacman/issues/82) | M4b 编排深面：memory 写路径 + MCP 双面 + watch/wake 三触发 | `docs/spec/02-架构平价.md`<br>`docs/spec/04-验收口径.md` |
| [#262](https://github.com/xiechimon/pacman/issues/262) | task: cli 包改名 @xiechimon/pacman-cli + publishConfig(W2) | `docs/spec/06-开源与分化.md` |
| [#266](https://github.com/xiechimon/pacman/issues/266) | task: 首发执行 0.1.0——干净环境全链实测 + publish(W2) | `docs/spec/06-开源与分化.md` |
| [#350](https://github.com/xiechimon/pacman/issues/350) | 模型服务/机器页「按钮不可点」复报 = 行可点感误导（实测无遮挡） | `docs/spec/12-新建项目本地仓库与GitHub认证选仓.md` |
| [#435](https://github.com/xiechimon/pacman/issues/435) | #412 执行：值正本并流 + tokens.css 降别名 + 死 token 清理 + 一次性视觉重钉 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md` |
| [#518](https://github.com/xiechimon/pacman/issues/518) | 研究：pacman 与 Multica runtime 模型的能力差距盘点 | `docs/spec/18-定位与差异化.md` |
| [#521](https://github.com/xiechimon/pacman/issues/521) | 任务：按主张与实测重排 backlog 并出执行票 | `docs/spec/18-定位与差异化.md` |
| [#913](https://github.com/xiechimon/pacman/issues/913) | 批次表 v2：逐域拆批、验收模板 v2 与并行车道编排 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md` |
| [#1405](https://github.com/xiechimon/pacman/issues/1405) | server: 自举闭环 P4 自治合并执行器（mergePolicy、sha 绑定合并、急停、熔断、日上限） | `docs/spec/28-自举闭环-自写自合.md` |
| [#1408](https://github.com/xiechimon/pacman/issues/1408) | ops: 自举闭环 P7 长期宿主自部署与回滚（待宿主） | `docs/spec/28-自举闭环-自写自合.md` |
| [#35](https://github.com/xiechimon/pacman/issues/35) | 研究：todos.dev 公开站全量盘点（页面/文案/设计 token/PWA/定价边界） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#36](https://github.com/xiechimon/pacman/issues/36) | 研究：登录后 workspace UI 全量盘点（屏幕×状态×组件清单+截图） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#38](https://github.com/xiechimon/pacman/issues/38) | 研究：地基对比（craft-agents-oss / pi SDK / Claude Agent SDK / 自研基线） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#39](https://github.com/xiechimon/pacman/issues/39) | 锁定：地基选型终拍（库化路线具体化） | `docs/spec/00-地基决议.md` |
| [#40](https://github.com/xiechimon/pacman/issues/40) | 决议：领域模型与术语表（CONTEXT.md） | `docs/spec/00-地基决议.md`<br>`docs/spec/02-架构平价.md` |
| [#43](https://github.com/xiechimon/pacman/issues/43) | 设计：技术栈锁定 v2 | `docs/spec/00-地基决议.md`<br>`docs/spec/01-stack-v2.md`<br>`docs/spec/02-架构平价.md`<br>`docs/spec/27-消费点形状与品牌墨台账.md`<br>`docs/spec/素材替换计划.md` |
| [#45](https://github.com/xiechimon/pacman/issues/45) | 设计：构建顺序、spec 出版格式与地图收尾（ROADMAP） | `docs/spec/00-地基决议.md`<br>`docs/spec/01-stack-v2.md`<br>`docs/spec/02-架构平价.md`<br>`docs/spec/03-ROADMAP.md`<br>`docs/spec/04-验收口径.md`<br>`docs/spec/05-M6-验收报告.md` |
| [#52](https://github.com/xiechimon/pacman/issues/52) | Web: 双屏像素实现 — apps/web 看板+详情（fixture 数据）+ r7 对拍 harness | `docs/spec/03-ROADMAP.md` |
| [#53](https://github.com/xiechimon/pacman/issues/53) | Web: 骨架 — monorepo + token/主题/字体/图标 + 对拍 harness + CI | `docs/spec/01-stack-v2.md`<br>`docs/spec/03-ROADMAP.md`<br>`docs/spec/04-验收口径.md` |
| [#72](https://github.com/xiechimon/pacman/issues/72) | Web: Chief 面板静态面（drawer/线程/设置 4 tab） | `docs/spec/04-验收口径.md` |
| [#104](https://github.com/xiechimon/pacman/issues/104) | 升级窗口：TypeScript 5.9.3 → 7.0.2（工具链兼容面核实 + 全量回归） | `docs/spec/01-stack-v2.md`<br>`docs/spec/05-M6-验收报告.md` |
| [#105](https://github.com/xiechimon/pacman/issues/105) | 升级窗口：react-router 7.18.4 → 8.4.0（library mode 回归 + 路由形状保真） | `docs/spec/01-stack-v2.md`<br>`docs/spec/05-M6-验收报告.md` |
| [#106](https://github.com/xiechimon/pacman/issues/106) | 升级窗口：Tailwind CSS 3.4.19 → 4.x（dark 反相变体等价实现 + 全矩阵重验） | `docs/spec/01-stack-v2.md`<br>`docs/spec/05-M6-验收报告.md` |
| [#107](https://github.com/xiechimon/pacman/issues/107) | 升级窗口：pi 0.85.1 → 0.86.0（D6 首个窗口：Breaking 段阅读 + AgentBackend 缝回归） | `docs/spec/00-地基决议.md`<br>`docs/spec/01-stack-v2.md`<br>`docs/spec/05-M6-验收报告.md` |
| [#151](https://github.com/xiechimon/pacman/issues/151) | web: 看板列折叠——六列列头钮收起/展开（收起态形态需原站补拍或 §8 设计裁决） | `docs/spec/素材替换计划.md` |
| [#172](https://github.com/xiechimon/pacman/issues/172) | Map: 弹层族收口——剩余死钮接线与 local-first 裁决出账 | `docs/spec/05-M6-验收报告.md` |
| [#174](https://github.com/xiechimon/pacman/issues/174) | task: MCP 添加弹窗——mcp-servers 页 res-add 死钮接线 | `docs/spec/05-M6-验收报告.md` |
| [#194](https://github.com/xiechimon/pacman/issues/194) | task: e2e spec inline import 家族清扫——top-level import 合规 | `docs/spec/05-M6-验收报告.md` |
| [#204](https://github.com/xiechimon/pacman/issues/204) | task: chief 设置面压缩模型启用——下拉接 providers 真值（静态化翻回） | `docs/spec/05-M6-验收报告.md` |
| [#221](https://github.com/xiechimon/pacman/issues/221) | task: 弹窗样式族整族抽取——六弹窗 CSS 收 shared 层(#199 裁决) | `docs/spec/05-M6-验收报告.md` |
| [#229](https://github.com/xiechimon/pacman/issues/229) | task: parity 矩阵补弹层族 open 态行——r8 基线门禁化(M6 Q3) | `docs/spec/05-M6-验收报告.md` |
| [#230](https://github.com/xiechimon/pacman/issues/230) | task: provider/agent/mcp 三族 POST body schema 上收 shared(M6 Q4b) | `docs/spec/05-M6-验收报告.md` |
| [#232](https://github.com/xiechimon/pacman/issues/232) | task: M6 功能平价终验——全口径重跑 + 05 册终版(Q1 裁决 A) | `docs/spec/05-M6-验收报告.md` |
| [#235](https://github.com/xiechimon/pacman/issues/235) | task: skills GitHub 扫描钮接线——scan 端点消费(#223 后票) | `docs/spec/05-M6-验收报告.md`<br>`docs/spec/08-M7-功能闭环.md` |
| [#261](https://github.com/xiechimon/pacman/issues/261) | task: server bundle 管线 + 主包整形——@xiechimon/pacman 可发布(W2) | `docs/spec/06-开源与分化.md` |
| [#263](https://github.com/xiechimon/pacman/issues/263) | task: npm 首发 wizard 人肉引导脚本(W2) | `docs/spec/06-开源与分化.md` |
| [#264](https://github.com/xiechimon/pacman/issues/264) | task: pack 冒烟 + CI job——tarball 裸 node 起服务(W2) | `docs/spec/19-测试分层与受影响面.md` |
| [#290](https://github.com/xiechimon/pacman/issues/290) | spec: streamdown 引入评估——只评估不实装(W4) | `docs/spec/07-streamdown-评估.md` |
| [#303](https://github.com/xiechimon/pacman/issues/303) | M7-W1 总账票：四方对账 + 附件/提及规格补采 + 后端能力盘点 | `docs/spec/03-ROADMAP.md`<br>`docs/spec/08-M7-功能闭环.md`<br>`docs/spec/10-M7-验收报告.md` |
| [#365](https://github.com/xiechimon/pacman/issues/365) | 资源面本地化：skills 与 MCP 只读本地 / spec: docs/spec/13 | `docs/spec/13-资源面本地化.md`<br>`docs/spec/14-skills执行面注入.md` |
| [#412](https://github.com/xiechimon/pacman/issues/412) | token 管道架构：tokens.css × shadcn 变量规约合流 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#418](https://github.com/xiechimon/pacman/issues/418) | 弹层行为契约对照：shadcn Dialog × 仓内 OverlayMount 家族 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#419](https://github.com/xiechimon/pacman/issues/419) | mention-picker 悬空 token 修复（迁前必修） | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#420](https://github.com/xiechimon/pacman/issues/420) | 弹层族迁移设计：11 壳的 shadcn 化与行为契约保留 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#421](https://github.com/xiechimon/pacman/issues/421) | 批次表与每片验收标准（铺开蓝图核心件） | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#422](https://github.com/xiechimon/pacman/issues/422) | 第一片真域选定与迁移面（resources vs secondary） | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#430](https://github.com/xiechimon/pacman/issues/430) | 弹层行为契约对照（Base UI 代数） | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#515](https://github.com/xiechimon/pacman/issues/515) | Map: pacman 自我定位——真闭环、参考实现纪律与两轴取舍 | `docs/spec/18-定位与差异化.md` |
| [#516](https://github.com/xiechimon/pacman/issues/516) | 决策：pacman 凭什么存在——对抗性论证（含最强反驳「不如直接用 Multica」） | `docs/spec/18-定位与差异化.md` |
| [#520](https://github.com/xiechimon/pacman/issues/520) | 决策：定位陈述的载体与内容（docs/spec/16 + ADR） | `docs/spec/18-定位与差异化.md` |
| [#561](https://github.com/xiechimon/pacman/issues/561) | web: board/notify-banner.tsx 切 components/ui/Button（#414 试点片收口；#519 真闭环试点任务） | `docs/spec/16-shadcn全站铺开批次表与验收口径.md` |
| [#782](https://github.com/xiechimon/pacman/issues/782) | web: 换肤 Herdr 紫（米色纸面 + 暖黑底，只换色不动几何） | `docs/spec/base-ui-theme.md` |
| [#813](https://github.com/xiechimon/pacman/issues/813) | Base UI 主题迁移地图（V2 + Herdr 紫）：目的地、已定事项与剩余雾区 | `docs/spec/22-色彩与几何token-scale正本表.md` |
| [#908](https://github.com/xiechimon/pacman/issues/908) | Map: 全站 UI 换代——全量 shadcn 化 + 色相重选 + 几何重设计（像素纪律退役） | `docs/spec/06-开源与分化.md`<br>`docs/spec/11-模型服务与机器本地化.md`<br>`docs/spec/16-shadcn全站铺开批次表与验收口径.md`<br>`docs/spec/18-定位与差异化.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md` |
| [#909](https://github.com/xiechimon/pacman/issues/909) | 全站视觉方向重选：候选色板 × 双版原型，用户审后定版 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md` |
| [#912](https://github.com/xiechimon/pacman/issues/912) | 几何与色彩 token scale 正本表：从定版原型提炼逐域施工正本 | `docs/spec/16-shadcn全站铺开批次表与验收口径.md`<br>`docs/spec/22-色彩与几何token-scale正本表.md` |
| [#1013](https://github.com/xiechimon/pacman/issues/1013) | 波 0（docs-only）：延迟入账——ADR 0009 D3② 修订、品牌槽位闭合、docs/spec 余册标注 | `docs/spec/06-开源与分化.md`<br>`docs/spec/11-模型服务与机器本地化.md`<br>`docs/spec/18-定位与差异化.md` |
| [#1409](https://github.com/xiechimon/pacman/issues/1409) | ops: 自举闭环 P8 毕业（shadow 十张零误放 → 演练仓五条负对照 → 本仓 autonomous）（待宿主） | `docs/spec/28-自举闭环-自写自合.md` |

### 3.2 被引用的 PR（不生成行）

行集口径 = issue（§0.1）。这些 PR 号被三源引用到，实现在对应 issue 行下。

| PR | 标题 | 状态 | 引用来源 |
|---|---|---|---|
| [#101](https://github.com/xiechimon/pacman/pull/101) | daemon(80): M3b daemon 深面 — worktree 契约 + step 三类 + merge 202（单机生命周期实跑） | closed | 测试 ×3 |
| [#102](https://github.com/xiechimon/pacman/pull/102) | server(81): M4a Chief 编排 — remoteTools relay + 措辞→spec + 驳回 v2 + 双 Agent 分派（#81） | closed | 测试 ×1 |
| [#108](https://github.com/xiechimon/pacman/pull/108) | web(83): M5 汇合 — fixture 切真 API + live streaming 真 SSE + E2E 主时序全链（含 M6 终验） | closed | spec ×1 |
| [#115](https://github.com/xiechimon/pacman/pull/115) | deps(107): pi 0.85.1 → 0.86.0——首个 D6 升级窗口（Breaking 三条全缝外） | closed | spec ×1 |
| [#117](https://github.com/xiechimon/pacman/pull/117) | chore(104): TypeScript 5.9.3→7.0.2 全线抬升 —— 工具链共存核实 + i18n 门 TS7 scanner 改写 | closed | spec ×1 |
| [#118](https://github.com/xiechimon/pacman/pull/118) | deps(105): react-router 7.18.4 → 8.4.0——library mode 形态保持，v8 Breaking 全缝外 + 01 册 §4.1 pin 回写（#105） | closed | spec ×1 |
| [#119](https://github.com/xiechimon/pacman/pull/119) | deps(106): Tailwind CSS 3.4.19 → 4.3.3（dark 反相变体等价 + @theme token 迁移 + 全矩阵重验） | closed | spec ×1 |
| [#205](https://github.com/xiechimon/pacman/pull/205) | web(194): e2e spec 家族 inline import 整族清扫 | closed | 测试 ×1 |
| [#210](https://github.com/xiechimon/pacman/pull/210) | server(203): chief 压缩模型长槽——compactionModel 可空 JSON 列 + PATCH 第三槽 | closed | 测试 ×1 |
| [#233](https://github.com/xiechimon/pacman/pull/233) | server(223): GitHub 出站 fetch 薄桥 + POST /api/skills/scan 扫描发现半 | closed | spec ×2 |
| [#237](https://github.com/xiechimon/pacman/pull/237) | web(225): docpane「显示完整文件」钮接线 | closed | spec ×1 |
| [#239](https://github.com/xiechimon/pacman/pull/239) | parity(229): 弹层族 open 态 22 行门禁化(M6 Q3)——8 弹窗 11 面 light+dark | closed | 测试 ×1 |
| [#313](https://github.com/xiechimon/pacman/pull/313) | web(304): 两处语音钮出账——08 册 C5 语音功能不做,不留死钮 | closed | spec ×1 |
| [#314](https://github.com/xiechimon/pacman/pull/314) | web(307): 档 4 外链型四件 wontfix 出账——keys-docs/res-doclink/两处头像更换移除渲染 | closed | spec ×1 |
| [#316](https://github.com/xiechimon/pacman/pull/316) | web(306): M7-W2 菜单桩清零——六处按处置二分律落终态 | closed | spec ×1 |
| [#317](https://github.com/xiechimon/pacman/pull/317) | web(305): M7-W2 档 1 两处断点接线——空态新建钮 NewTaskDialog 同构 + 选择仓库 repo 选择面 | closed | spec ×1 |
| [#321](https://github.com/xiechimon/pacman/pull/321) | M7-W1 总账：四方对账正账 + 附件/提及规格补采 + 后端能力盘点 (#303) | closed | spec ×1 |
| [#322](https://github.com/xiechimon/pacman/pull/322) | server(320): 失败面发送 = 带反馈重启——composer failed 相位发送语义接真(前端 + server 垂直切片) | closed | spec ×1 |
| [#323](https://github.com/xiechimon/pacman/pull/323) | web+server(309): 标签垂直切片——新建任务对话框标签 UI + server 写路径 + fresh 详情 meta 区 chip | closed | spec ×1 |
| [#324](https://github.com/xiechimon/pacman/pull/324) | web(318): M7-W2 桩群校准五处接真——更多菜单完成/关闭 + 开始任务 dialog 统一面 + 查看方案 + 任务行导航 + 未保存闸 | closed | spec ×1 |
| [#325](https://github.com/xiechimon/pacman/pull/325) | M7(#308): composer 停止钮全链——确认弹层/正在停止…/已取消/gate 回落,stop 端点+wire+daemon 分流+discard rewind 一票切穿 | closed | spec ×1 |
| [#327](https://github.com/xiechimon/pacman/pull/327) | web(311): mention picker + token serialization | closed | spec ×1 |
| [#328](https://github.com/xiechimon/pacman/pull/328) | branch-sync(319): 分支对话框接真 + 全链 sync | closed | spec ×1 |
| [#329](https://github.com/xiechimon/pacman/pull/329) | web(312): AI 审核发起模态 + 审核步入队 + 审核中态 | closed | spec ×1 |
| [#331](https://github.com/xiechimon/pacman/pull/331) | M7-W5 附件：composer + 新建任务全链（#310） | closed | spec ×1 |
| [#332](https://github.com/xiechimon/pacman/pull/332) | shared/server/daemon/web(330): AI 审核第二片——真 findings 数据流 + blocking 自动修订回路 | closed | spec ×1 |
| [#337](https://github.com/xiechimon/pacman/pull/337) | docs(spec): DESIGN.md:114 服从 tokens.css spacing ladder 决策（#333） | closed | spec ×1 |
| [#339](https://github.com/xiechimon/pacman/pull/339) | web(334): popover 圆角 token 化——--radius-popover 单源化（#334） | closed | spec ×1 |
| [#340](https://github.com/xiechimon/pacman/pull/340) | web(335): 收编 overlay-btn×5 + chief-gate-btn 到 ui/button 原语（A6 覆盖 A3 决议） | closed | spec ×1 |
| [#342](https://github.com/xiechimon/pacman/pull/342) | chore(parity): 摘除像素对拍工具 parity/ 与全部引用 | closed | spec ×1 |
| [#401](https://github.com/xiechimon/pacman/pull/401) | feat(389): 快捷键组——N 开新建任务(含角标) + Space 呼出总管(焦点入抽屉) | closed | 测试 ×1 |
| [#416](https://github.com/xiechimon/pacman/pull/416) | web(414): 主界面 shadcn 化试点——B 美学 + 组件层进仓 + 四列对账 | closed | 测试 ×1 |
| [#427](https://github.com/xiechimon/pacman/pull/427) | web(419): mention-picker 悬空 token 重接仓内单源 | closed | spec ×1 |
| [#474](https://github.com/xiechimon/pacman/pull/474) | web(426): B2 热身——token-gate + machine-authorize 两份散件 CSS 退役，切仓内 shadcn Card（B 配方） | closed | spec ×1 |
| [#507](https://github.com/xiechimon/pacman/pull/507) | web(503): 机器行 runtime 开关换成官方品牌 mark；并发上限 maxConcurrent 连概念摘除 | closed | 测试 ×2 |
| [#524](https://github.com/xiechimon/pacman/pull/524) | docs(517): 研究——Multica runtime 模型全解（含 14 条文档/源码差异） | closed | spec ×1 |
| [#526](https://github.com/xiechimon/pacman/pull/526) | docs(518): 研究——pacman 与 Multica runtime 模型的能力差距盘点（25 条，四栏 + 本图范围判定） | closed | spec ×1 |
| [#532](https://github.com/xiechimon/pacman/pull/532) | XMON-11: 把 #409 迁移面底账 migration-surface.md 并入 main | closed | spec ×1 |
| [#534](https://github.com/xiechimon/pacman/pull/534) | XMON-13: B2 收尾——token-gate / machine-authorize 切 components/ui Button + Input | closed | spec ×1 |
| [#535](https://github.com/xiechimon/pacman/pull/535) | XMON-14: 补 shadcn 三原语落点——avatar / tag-chip / kbd 三件落位 + 21 处消费面切换 | closed | spec ×1 |
| [#536](https://github.com/xiechimon/pacman/pull/536) | XMON-15: Agent 详情「进行中」列表——载荷形状按原件钉死，接界面 + 空态 | closed | spec ×1 |
| [#547](https://github.com/xiechimon/pacman/pull/547) | web(xmon-28): B3 · agent 详情页与模型选择器裸 button 切 components/ui/Button | closed | spec ×1 |
| [#573](https://github.com/xiechimon/pacman/pull/573) | server(XMON-77/84): Agent 权限六开关 + 合并/推送执法 + 推送分支默认开 | closed | 测试 ×1 |
| [#574](https://github.com/xiechimon/pacman/pull/574) | web(XMON-22): 弹层内容族切 shadcn — 9 裸钮收口 + 残余逐处声明 | closed | 测试 ×2 |
| [#576](https://github.com/xiechimon/pacman/pull/576) | server(XMON-77/84): Agent 权限六开关 + 合并/推送执法 + 推送分支默认开 | closed | 测试 ×2 |
| [#617](https://github.com/xiechimon/pacman/pull/617) | web(t-0024): 模型槽两级选择器——先运行时/服务商、再它名下的模型 | closed | spec ×1 |
| [#635](https://github.com/xiechimon/pacman/pull/635) | fix(web): close the chief conversation failure loop with sonner toasts | closed | 测试 ×1 |
| [#649](https://github.com/xiechimon/pacman/pull/649) | server+shared: add chief models read tool so agent model ids are no longer guesses | closed | 测试 ×1 |
| [#677](https://github.com/xiechimon/pacman/pull/677) | web(656): wire tw-animate-css so the shadcn enter/exit motion actually runs | closed | 测试 ×1 |
| [#678](https://github.com/xiechimon/pacman/pull/678) | fix(web): render todo mentions as chips — add todo: to the mention scheme regex | closed | 测试 ×2 |
| [#687](https://github.com/xiechimon/pacman/pull/687) | machine dispatch closure: pin machines from task entry surfaces, enabledRuntimes claim gate, offline-pin wait | closed | spec ×1 |
| [#711](https://github.com/xiechimon/pacman/pull/711) | fix(daemon): activity-reset the stream body arm and name the guard that fires (#699) | closed | spec ×1 |
| [#713](https://github.com/xiechimon/pacman/pull/713) | fix(daemon): review verdict extraction must survive trailing tool calls (#700, B-C13) | closed | spec ×1 |
| [#716](https://github.com/xiechimon/pacman/pull/716) | fix(server): failed review no longer locks the merge path of a done build (#702) | closed | spec ×1 |
| [#719](https://github.com/xiechimon/pacman/pull/719) | fix(server,daemon): gate step completion on real artifacts — no plan, no confirm; no changes, no review (#703) | closed | spec ×1、测试 ×1 |
| [#723](https://github.com/xiechimon/pacman/pull/723) | web(656): retire the overlay-mount registry, shrink motion.css to the retained faces | closed |  |
| [#735](https://github.com/xiechimon/pacman/pull/735) | fix(daemon): stamp daemon.log lines with wall-clock and signal names | closed | 测试 ×1 |
| [#736](https://github.com/xiechimon/pacman/pull/736) | daemon,server: make image attachments visible to the worker agent (real pixels, not base64 text) | closed | spec ×1 |
| [#767](https://github.com/xiechimon/pacman/pull/767) | fix(web): route SSE-driven invalidations through a convergence seam | closed | 测试 ×1 |
| [#888](https://github.com/xiechimon/pacman/pull/888) | docs(readme): show the app icon above the title, both languages | closed | spec ×1、测试 ×4 |
| [#928](https://github.com/xiechimon/pacman/pull/928) | docs: vector app icon at the README header, both language pages | closed | spec ×1 |
| [#959](https://github.com/xiechimon/pacman/pull/959) | server(958): keep the chief prompt byte-stable across turns | closed | spec ×1 |
| [#1023](https://github.com/xiechimon/pacman/pull/1023) | daemon(929,930): command gate on pi's tool_call seam, MCP bridge on native registerMcpServer | closed | 测试 ×1 |
| [#1040](https://github.com/xiechimon/pacman/pull/1040) | web(1033): rewire chief thinking/tool rows to the post-#950 primitives | closed | 测试 ×1 |
| [#1045](https://github.com/xiechimon/pacman/pull/1045) | web(1003): realign components/ui with registry base-nova and pin the segment-order contract | closed | spec ×2 |
| [#1053](https://github.com/xiechimon/pacman/pull/1053) | daemon,shared,web: claude 可用性事实源——探二进制与版本，providers 页四态 (#1050) | closed | 测试 ×1 |
| [#1057](https://github.com/xiechimon/pacman/pull/1057) | web(1005): align resources+secondary faces to registry defaults | closed | spec ×2 |
| [#1058](https://github.com/xiechimon/pacman/pull/1058) | web(1004): align board/sidebar to registry forms (prototype + construction 1-2) | closed | spec ×1 |
| [#1059](https://github.com/xiechimon/pacman/pull/1059) | web(1006): align the chip family and detail-a faces with the registry | closed | spec ×1 |
| [#1060](https://github.com/xiechimon/pacman/pull/1060) | web(1008): split-retire the floating-shell family into registry overlays | closed | spec ×1、测试 ×3 |
| [#1061](https://github.com/xiechimon/pacman/pull/1061) | web+integration+skill(1007): align the pages domain with registry base-nova (wave 1 L4) | closed | spec ×1 |
| [#1066](https://github.com/xiechimon/pacman/pull/1066) | web(1009): A1 - chief stream rides the registry chat primitives | closed | 测试 ×1 |
| [#1072](https://github.com/xiechimon/pacman/pull/1072) | web(1006): land the detail-b faces on the registry dialog shell | closed | spec ×1、测试 ×1 |
| [#1074](https://github.com/xiechimon/pacman/pull/1074) | web(1037): make every schedules control answer its click | closed | spec ×1 |
| [#1075](https://github.com/xiechimon/pacman/pull/1075) | web(1010): retire the handwritten select.tsx to the registry compound select | closed | spec ×1 |
| [#1105](https://github.com/xiechimon/pacman/pull/1105) | web(1101): paint diff row bg across the scroll width and add word-level highlight | closed | 测试 ×1 |
| [#1119](https://github.com/xiechimon/pacman/pull/1119) | web: slow the streaming-row Atom spinner to 1.8s and keep the 2:1 breathe ratio | closed |  |
| [#1146](https://github.com/xiechimon/pacman/pull/1146) | server(1136): machine-row staleness sweep — presence lastSeenAt + 150s threshold flips offline | closed | 测试 ×1 |
| [#1201](https://github.com/xiechimon/pacman/pull/1201) | web(1178): teach dead-class-gate the cva variant-lookup keys | closed | 测试 ×2 |
| [#1202](https://github.com/xiechimon/pacman/pull/1202) | verify(1181): migrate drive-hotkeys and drive-newtask-key to semantic search carriers | closed | 测试 ×2 |
| [#1205](https://github.com/xiechimon/pacman/pull/1205) | verify(1181): migrate retired search-panel selectors in drive-hotkeys / drive-newtask-key | closed | 测试 ×2 |
| [#1234](https://github.com/xiechimon/pacman/pull/1234) | web(1067): dock the chief drawer with inert/opacity so minimize keeps scroll | closed | 测试 ×1 |
| [#1275](https://github.com/xiechimon/pacman/pull/1275) | daemon,server,shared(1195): recognize branch-drifted deliveries instead of reporting zero-changes | closed | 测试 ×1 |
| [#1314](https://github.com/xiechimon/pacman/pull/1314) | fix(daemon): stop claude-code from inheriting global MCP | closed | 测试 ×1 |
| [#1330](https://github.com/xiechimon/pacman/pull/1330) | daemon(1316): resolve commit before git reset --hard | closed | 测试 ×1 |
| [#1342](https://github.com/xiechimon/pacman/pull/1342) | server(1241): recommend machine concurrency from machine capability | closed | 测试 ×1 |
| [#1346](https://github.com/xiechimon/pacman/pull/1346) | web(1342): stop the concurrency stepper from racing blur commits | closed | 测试 ×1 |
| [#1386](https://github.com/xiechimon/pacman/pull/1386) | web: Paper settings list for the account page and agent overview | closed | 测试 ×1 |
| [#1395](https://github.com/xiechimon/pacman/pull/1395) | chore: SessionStart hook for Claude Code cloud sessions | closed |  |
| [#1410](https://github.com/xiechimon/pacman/pull/1410) | docs(1401): ADR 0021 autonomous merge policy and spec 28 bootstrap plan | closed | spec ×1、测试 ×1 |
| [#1411](https://github.com/xiechimon/pacman/pull/1411) | verify(1402): vp.mjs single entry and drive registry | closed | spec ×1 |
| [#1414](https://github.com/xiechimon/pacman/pull/1414) | server(1403): reconcile review-phase PRs merged or closed on GitHub | closed | spec ×1、测试 ×2 |
| [#1420](https://github.com/xiechimon/pacman/pull/1420) | server(1404): merge gate S1, patch digest, D4 path classes, raw evidence links | closed | spec ×1、测试 ×1 |
| [#1421](https://github.com/xiechimon/pacman/pull/1421) | server(1404): merge gate S2, mergeReadiness and the blocker vocabulary | closed | spec ×1 |
| [#1438](https://github.com/xiechimon/pacman/pull/1438) | docs: run /security-review when a diff touches security-sensitive code | closed | 测试 ×1 |
| [#1450](https://github.com/xiechimon/pacman/pull/1450) | web(1448): e2e specs share pressUntil instead of private hotkey retry loops | closed | 测试 ×1 |
| [#1456](https://github.com/xiechimon/pacman/pull/1456) | Local test loop and a shared start rule: e2e-affected, canOrchestrate, container-safe daemon tests (#1455, #1457, #1458) | closed | 测试 ×2 |
| [#1461](https://github.com/xiechimon/pacman/pull/1461) | server(1406): issue intake poller for ready-for-agent issues, opt-in | closed | spec ×1、测试 ×2 |
| [#1467](https://github.com/xiechimon/pacman/pull/1467) | server(1406): chief and MCP GitHub read tools read GitHub | closed | spec ×1 |
| [#1469](https://github.com/xiechimon/pacman/pull/1469) | server(1404): merge gate S3, gate tables migration | closed | spec ×1 |
| [#1475](https://github.com/xiechimon/pacman/pull/1475) | shared(1406): GitHub issue text fenced as data; Implementer names the repo rules | closed | spec ×1、测试 ×1 |
| [#1476](https://github.com/xiechimon/pacman/pull/1476) | verify(1402): registry gate, drive lines in the feature maps, stack-state marks | closed | spec ×1 |
| [#1477](https://github.com/xiechimon/pacman/pull/1477) | server(1459): webhook pacman trigger follows D5 and the in-flight cap | closed | spec ×1、测试 ×1 |
| [#1479](https://github.com/xiechimon/pacman/pull/1479) | server(1404): merge gate S2 follow-up, compare and checks bound to the PR head | closed | spec ×1 |
| [#1480](https://github.com/xiechimon/pacman/pull/1480) | shared(1406): images inside the issue fence delivered; issue titles fenced in chief wakes | closed | spec ×1、测试 ×1 |
| [#1483](https://github.com/xiechimon/pacman/pull/1483) | daemon, server(1473): a released step is not run twice on one machine, and an old run's report is not applied | closed | 测试 ×1 |
| [#1496](https://github.com/xiechimon/pacman/pull/1496) | server(1406): intake and webhook follow-ups from pr-gate on #1461 and #1477 | closed | spec ×1、测试 ×1 |

### 3.3 解析不到的票号

这些号被三源引用到，但仓内不存在该 issue/PR（跨仓引用、笔误，或引用了被删除的票）。

（无。）

### 3.4 非 GitHub 票号的证据目录

`docs/verify/` 下这些目录名不是本仓 GitHub 票号（历史 tracker / 线程编号 / 变体目录），`gh issue list` 解析不到；证据本体在仓内可查。

| 目录 | 路径 |
|---|---|
| 1342-fix | `docs/verify/1342-fix/` |
| 1346-fix | `docs/verify/1346-fix/` |
| 756b | `docs/verify/756b/` |
| 929-930 | `docs/verify/929-930/` |
| XMON-104 | `docs/verify/XMON-104/` |
| XMON-115 | `docs/verify/XMON-115/` |
| XMON-117 | `docs/verify/XMON-117/` |
| XMON-19 | `docs/verify/XMON-19/` |
| XMON-22 | `docs/verify/XMON-22/` |
| XMON-23 | `docs/verify/XMON-23/` |
| XMON-24 | `docs/verify/XMON-24/` |
| XMON-25 | `docs/verify/XMON-25/` |
| XMON-39 | `docs/verify/XMON-39/` |
| XMON-40 | `docs/verify/XMON-40/` |
| XMON-69 | `docs/verify/XMON-69/` |
| XMON-72 | `docs/verify/XMON-72/` |
| XMON-74 | `docs/verify/XMON-74/` |
| XMON-79 | `docs/verify/XMON-79/` |
| XMON-87 | `docs/verify/XMON-87/` |
| XMON-89 | `docs/verify/XMON-89/` |
| app-icon | `docs/verify/app-icon/` |
| cn-type-scale | `docs/verify/cn-type-scale/` |
| composer-grow | `docs/verify/composer-grow/` |
| glass | `docs/verify/glass/` |
| live-agent-model-line | `docs/verify/live-agent-model-line/` |
| live-project-name | `docs/verify/live-project-name/` |
| old-daemon-text | `docs/verify/old-daemon-text/` |
| paper-board-sheet | `docs/verify/paper-board-sheet/` |
| paper-card | `docs/verify/paper-card/` |
| paper-detail | `docs/verify/paper-detail/` |
| paper-dialogs | `docs/verify/paper-dialogs/` |
| paper-icons-outlines | `docs/verify/paper-icons-outlines/` |
| paper-keys-schedules | `docs/verify/paper-keys-schedules/` |
| paper-outline-1px | `docs/verify/paper-outline-1px/` |
| paper-overlays | `docs/verify/paper-overlays/` |
| paper-patterns | `docs/verify/paper-patterns/` |
| paper-project-pages | `docs/verify/paper-project-pages/` |
| paper-resource-pages | `docs/verify/paper-resource-pages/` |
| paper-segmented | `docs/verify/paper-segmented/` |
| paper-settings-list | `docs/verify/paper-settings-list/` |
| paper-shell-merge | `docs/verify/paper-shell-merge/` |
| paper-sidebar | `docs/verify/paper-sidebar/` |
| paper-team-pages | `docs/verify/paper-team-pages/` |
| paper-tokens | `docs/verify/paper-tokens/` |
| paper-topbar | `docs/verify/paper-topbar/` |
| paper-type-ratchet | `docs/verify/paper-type-ratchet/` |
| pixel-brand-mark | `docs/verify/pixel-brand-mark/` |
| readme-icon | `docs/verify/readme-icon/` |
| search-project-line | `docs/verify/search-project-line/` |
| sheet-ring-on-top | `docs/verify/sheet-ring-on-top/` |
| sheet-ring-only | `docs/verify/sheet-ring-only/` |
| step-claim-tla | `docs/verify/step-claim-tla/` |
| t-0024 | `docs/verify/t-0024/` |
| t-0031 | `docs/verify/t-0031/` |
| t-0070 | `docs/verify/t-0070/` |
| t-0142 | `docs/verify/t-0142/` |
| todo-card | `docs/verify/todo-card/` |
| ui-cds-board | `docs/verify/ui-cds-board/` |
| ui-cds-composer | `docs/verify/ui-cds-composer/` |
| ui-cds-density | `docs/verify/ui-cds-density/` |
| ui-cds-dialogs | `docs/verify/ui-cds-dialogs/` |
| ui-cds-motion | `docs/verify/ui-cds-motion/` |
| ui-cds-motion-fix | `docs/verify/ui-cds-motion-fix/` |
| ui-cds-settings | `docs/verify/ui-cds-settings/` |
| ui-cds-sidebar | `docs/verify/ui-cds-sidebar/` |
| ui-cds-tokens | `docs/verify/ui-cds-tokens/` |
| ui-cds-transcript | `docs/verify/ui-cds-transcript/` |
| ui-cmdk | `docs/verify/ui-cmdk/` |
| ui-polish | `docs/verify/ui-polish/` |
| ui-remove-quick | `docs/verify/ui-remove-quick/` |
| ui-skeleton | `docs/verify/ui-skeleton/` |
| xmon-13 | `docs/verify/xmon-13/` |
| xmon-14 | `docs/verify/xmon-14/` |
| xmon-16 | `docs/verify/xmon-16/` |
| xmon-18 | `docs/verify/xmon-18/` |
| xmon-20 | `docs/verify/xmon-20/` |
