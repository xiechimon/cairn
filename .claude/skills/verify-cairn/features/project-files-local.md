# local 项目 Files tab(开闸读面 + 不可达降级)

#1030(2026-10-08 用户裁决)推翻 spec 12「Files tab 对 local 项目隐藏/禁用」的 out-of-scope:local 项目的 文件 tab 可用,读面 = server 直读行上 `localPath` 工作树(目录解析分支 `requireRepoReadDir`,git 读原语对裸库/工作树同形,无检出要求)。github 形态仍无本地读面(404,web 不发请求)。spec 12 相关行已标注被本票推翻。

## Sub-features

- `local-read-face` — 五读面(tree/file/files/branches/commits)对 `repoKind='local'` 放行:ref 缺省落 HEAD(工作树当前检出),commits 面落默认分支(`listBranches` 先行);hosted 形态维持 `ref=main`(种子提交恒 main)既有口径。web 侧 tree/commits/file 对 local 形态发请求,ref 不传。
- `branch-chip-echo` — 分支 chip 显示 tree 载荷的 ref 回显:hosted='main'、local='HEAD'(live);fixture 面 = `project.branch`(prj-local-files 钉 `trunk`,证 local 默认分支任意)。
- `unreachable-degradation` — localPath 失格(多机部署 server 看不见 / 目录已删 / 已非 git 仓)→ 404 + reason code(`not_found`/`not_git`,词表复用 #386 `PROJECT_LOCAL_ERROR_REASONS`);web 渲染「本地仓库当前无法读取。」主行 + reason 分译行,FilesPane 不渲染(不空树、无历史假面)。`repoKind='local'` 而 localPath 列空(行完整性破)→ 404 显式红无 reason。

## How to get to it (user POV)

- 建 local 项目(见 [local-repo-api.md](./local-repo-api.md))→ 项目页 文件 tab(默认落)→ 分支 chip + 文件行 + 查看器 + 历史 seg。
- 驱动(`vp.mjs list project-files-local` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive project-files-local local-files`:local 项目文件 tab、hosted 对照、删仓降级。

## Driving it with drive-1030-local-files.mjs

Preconditions: `launch.mjs` 已起隔离栈;proxy env 全 unset(回环过代理 = 502 假阳性);本机有 `git`。

- 一键三相位:`env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/drive-1030-local-files.mjs` → 控制台 20 条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json + 5 截图)。
- 相位 A:真 git 工作树仓(默认分支 `trunk` + README 标记行)→ REST 五读面真值 + 浏览器 Files tab 开闸/chip=HEAD/行→查看器/历史。
- 相位 B:hosted 对照零回归(bare repo push 真 README 后同页面链路,chip='main')。
- 相位 C:删仓目录 → reload 出降级文案 + FilesPane 不渲染 + API 404+reason。
- 脚本自建道具并自回收(mkdtemp 真仓/hosted clone);hosted push 走 REST 建的 git API key(Basic auth)。

## Gotchas

- **local 的 ref 不得硬编码 'main'**:local 仓默认分支任意(探针钉 `trunk`);web 对 local 传 undefined → server 落 HEAD,文件查看器 ref 同口径(漏改会 404 假红)。
- 不可达降级钉在 `treeQ.isError`(local 形态)上——fixture 面 live=false、tree query 恒 disabled,**e2e 钉不到降级面**,归本 probe 相位 C + server vitest(project-local.test.ts F2/F3/F4)。
- `requireRepoReadDir` 对 local 每次 `existsSync + isGitRepo` 预检:不做预检时 runGit spawn ENOENT 会直接 500(「不要 500」的机制根因)。
- fixture 面数据源 = `prj-local-files` scenario(`projectLocalFiles`,branch='trunk' + 自有 README/提交,不再复用 hosted 演示内容)。
- e2e 面 = `e2e/project-files-local.spec.ts`(4 条;旧 `project-files-local-disabled.spec.ts` 随票退役)。
