# 详情页 3-pane 结构与右 pane 视图(detail-right-pane,#366)

The detail route `/app/todo/:id` is a three-pane abutting layout: 240 sidebar | fluid thread column | 488 right pane. The right pane's head type select (the `方案▾`/`变更▾` family) switches between four views: the doc surface (DocPane plan/changes/diff) and three static sections, `分支与 PR` / `Token 用量` / `运行历史` (the #68 head-icon popovers became pane content and no longer open modals). Fresh phases (todo/queued/closed) render no right pane at all, and the 488 goes to the center column's task brief (XMON-55 P0 #563). detail-head keeps only the `更多` icon plus the phase primary button; the composer is the center column's only 12px rounded card.

## Sub-features

- `three-pane-geometry` 三栏贴合:240 | fluid(1440 视口 = 712)| 488,1px hairline 缝,无阴影。
- `head-single-icon` detail-head 图标组收缩为 更多 一颗(分支/token/history 三图标出账);更多菜单 popover(#66)行为不变,冻结锚随头部几何右移。
- `no-detail-tabs` 文档|聊天 tab 组在全部九个相位面不存在(PHASE_UI.tabs 字段删除)。
- `pane-view-select` 型选钮开 4 行 listbox(文档行 = 相位派生 方案/变更 + 三 section 行),行点击 = 切视图即关(lang-dropdown 律);无 build payload 的 todo 只列文档行(不留死行)。
- `doc-surface` DocPane plan/changes/diff 行为不变(版本 chip/对比菜单/显示完整文件);head 常渲(空态入 body),型选钮永可达。
- `branch-section` 分支与 PR section = 原 dialog 同步 tab 字段件共享(BranchSyncFields/SyncButton)+ PR 行并入尾部;live 判别式同 branch-sync.md。
- `token-section` Token 用量 section:总量/模型/四统计行静止渲染。
- `history-section` 运行历史 section:运行行(glyph + 当前 chip + meta);原 dialog footer 重跑 close-stub 出账(failed 相位头部主钮承载真动作)。
- `fresh-no-right-pane` fresh 相位右栏整栏不渲染(XMON-55 P0 #563:三 section 都要
  build 载荷,文档面在无 build 时也只是空占位);三栏几何改在 thread 面钉。
- `composer-sole-card` composer 16px 内衬锚中心列、12px 圆角 + recessed fill,是中心列唯一卡片;总管 FAB 贴中心列右下角、composer 在场时让位上移(#347 律保留)。
- `meta-machine-pin-note` 方案空态 meta 块机器行改派尾注(#1208):任务钉了机器(todo.machineId)而机器行值不同名(唯一现实来源 = run_builds 显式 machineId 改派;派发面 pin 是硬约束,别机领不到)→ 行尾 `（任务钉选 {machine}）` tertiary 尾注,换机在看板层不再静默。遵守(同名)与未钉 = 零噪声;钉机离线的等待标注「（等待机器上线）」是相邻独立尾注(#682)。驱动:drive-1208-machine-pin.mjs。

## How to get to it (user POV)

- 任意任务详情路由 `/app/todo/:id`(看板卡标题点击 / 搜索结果行 / 直接 URL)。
- 右 pane 视图切换:pane 头部型选钮(文档面显示 方案▾/变更▾,section 面显示 section 名▾)→ listbox 行点击。
- 驱动(`vp.mjs list detail-right-pane` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive detail-right-pane detail-css-live`:详情页三栏与右 pane 的 live CSS 面;另需真 daemon(见下文前置);另需 stub LLM。
  - 判 stale、不带 `--force` 拒跑的 case(拒跑时打印原因):`vp.mjs drive detail-right-pane detail-live-migration`(读的选择子已不在 apps/web/src);`vp.mjs drive detail-right-pane machine-pin`(建 agent 不带 machineId,ADR 0019 起 400);`vp.mjs drive detail-right-pane three-pane`(读的选择子已不在 apps/web/src)。

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` 起隔离栈,`doctor.mjs` 全 PASS。**不需要 daemon**——结构面与步执行无关(无 daemon 时 build 停 queued,足够驱动全部视图)。

- **跑法。** `node <skill>/scripts/drive-detail-pane.mjs`(自含 seed:API 直建 provider/agent/project/todo,验完 fresh 面再 POST build 验 thread 面)。
- **真值。** checks 全绿:fresh 面左中贴合 + 右栏不渲染 + 头部单图标、thread 面三栏几何(240/488/贴合)、tab 组非存在、4 行 listbox、分支 section live 判别式(`button[aria-haspopup=listbox]` picker + `getByLabel('同步目录')` + 分支名 conv-<buildId>;#951 起 .dlg-machine-picker/.dlg-dir--input 类钩退役)、全程 `.dlg` 模态零出现、API `todo.latestBuildId` + SQLite todo/build 行双真值;截图 01–06。
- **fixture 面**(r7-16/17b/23 等场景冻结面 + composer 卡片几何)归 apps/web e2e `detail-3pane.spec.ts`,不走本 harness。

## Gotchas

- 分支 section 的 live/fixture 判别式与 branch-sync.md 同坑:调用点漏传 buildId → 静默落回占位 UI,界面无报错。
- 无 daemon 时相位停 queued → composer 不渲染(PHASE_UI[queued].placeholder = null)——composer 几何钉在 fixture e2e,本探针不钉。
- worktree 车道跑法传 `VERIFY_REPO_ROOT`(栈起在 worktree 代码上);证据落盘与归档纪律见 SKILL.md。
- vite 的 `preview.proxy` 缺省继承 `server.proxy`:fixture e2e 跑无 scenario 参数的路由时,若本机 8787 有别的 lane 的 dev server,live 查询会打到它并污染空态断言(#366 实测 api-keys 空态被真密钥列表顶掉)。隔离法:`CAIRN_DEV_SERVER_PORT=<空端口>` 起 playwright,让 proxy 指空。
