# 项目 Files 面目录下钻(hosted + local 双形态)

#1097:项目页 文件 tab 的树行消费 `projectTreeResponseSchema` 里一直存在但两端
都没用的 `entries[].type` / `entries[].path`——文件夹与文件同形同点击(点目录 =
拿目录名当文件路径读 → 「文件加载失败」),且路由层从未把 `path` query 接给
`readTree`(树永远只有顶层)。本票补齐下钻:路由透传 `path`(readTree/lsTree 零
改动,`isSafeRepoPath` 守卫原生在位)、行数据改 `{name,path,type}`、目录行
Folder 字形 + 点击下钻、面包屑回上层、选中键用完整路径。与
[project-files-local.md](./project-files-local.md) 同面:#1030 开 local 读面,
本票在两种可读形态上叠下钻。

## Sub-features

- `tree-path-passthrough` — `GET /api/projects/:id/tree?path=<dir>` 回该目录
  单层(entries 的 path 带全路径前缀、name 裸名),`path` 字段回显请求目录;
  缺省/空串 = 顶层。不存在目录 = 200 + 空 entries(git ls-tree 语义)。
  server 钉 = project-local.test.ts「tree 路由 path 参数透传(#1097)」P1-P5。
- `folder-vs-file-rows` — 目录行 `data-tree-entry="folder"` + Folder 字形、
  文件行 `data-tree-entry="file"` + FileTab 字形(非仅颜色区分);点目录行 =
  重发 `tree?path=`(**不发** `file?path=`——原始 bug 的反面钉),点文件行 =
  既有查看器链零回归。
- `breadcrumb-nav` — 仅子目录内渲染面包屑(顶层零视觉漂移):根段钮「根目录」
  + 各段钮(可点回中间层)+ 当前段 `aria-current="location"` 回显。显示走目录
  状态(切目录即时反馈);载荷 `path` 回显的契约由 server vitest 钉。
- `path-keyed-selection` — 选中态与 `file?path=` 都用完整路径:同名文件跨目录
  不串(回上层后旧目录的选中行不顶替 aria-current,预览保持最后选中的全路径)。
- `empty-and-loading-states` — 空目录(entries=[])→「此目录为空。」;当前目录键
  在途且无缓存数据 → 「加载中…」(空态不抢跑)。live 面造不出真空目录(git 不
  跟踪),这两态归 e2e W5/W6 + server P5,不在 live probe 演。

## How to get to it (user POV)

- hosted 项目(有提交)或 local 项目(行上 localPath 可达)→ 项目页 文件 tab →
  目录行点进去 → 面包屑回上层;文件行点开查看器。
- 驱动(`vp.mjs list project-files-drill` 列出全部 case 与 usage):
  - `node .claude/skills/verify-pacman/scripts/vp.mjs drive project-files-drill folder-drill`:文件 tab 目录下钻、面包屑回上层、查看器。

## Driving it with drive-1097-folder-drill.mjs

Preconditions: `launch.mjs` 已起隔离栈;proxy env 全 unset;本机有 `git`。

- 一键两相位:`env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-1097-folder-drill.mjs` → 控制台 20 条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json + 7 截图)。
- 相位 H:hosted bare repo push 嵌套真内容(根 README.md + docs/README.md 同名
  对照 + docs/setup.md + docs/guide/deep.md 三层)→ REST tree?path= 逐层 +
  浏览器下钻/面包屑/同名不串/深嵌套全链。
- 相位 L:local 真仓(默认分支 trunk)同套嵌套 → chip=HEAD 之上叠下钻 + 查看器。
- 脚本自建道具并自回收(mkdtemp 真仓/hosted clone);hosted push 走 REST 建的
  git API key(Basic auth)。

## Gotchas

- **stubBoot 的 projects 桩必须带 query**:web 打 `/api/projects?teamId=`,
  裸 `**/api/projects` pattern 不匹配 → 整页无项目行、文件行永不渲染(首跑
  7/7 全红的根因,e2e project-files-tree.spec 同款)。
- **面包屑不吃载荷回显**:切目录在途时 `treeQ.data` 是旧键数据,显示走目录状态;
  回显契约归 server vitest P1-P3。
- **live 造不出空目录**:git 不跟踪空目录,空/不存在目录同回 entries=[];空态与
  加载态的钉在 e2e W5/W6(stub 可控延迟)+ server P5。
- 目录行与文件行同挂 `.prj-file-row`(跨域定位别名,dead-buttons 等既有 spec
  的计数在 fixture 面无目录行,零漂移);区分载体 = `data-tree-entry`。
- e2e 面 = `e2e/project-files-tree.spec.ts`(W1-W7,stubBoot 承 board-dnd-live
  纪律);fixture 面无目录(string files 退化顶层 blob 行),下钻行为只在 live/
  stub 面可钉。
