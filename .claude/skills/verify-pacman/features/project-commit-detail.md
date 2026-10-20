# 项目「历史」列表提交详情面(hosted + local 双形态)

#1102:项目页 文件|历史 分段的「历史」行自 #149 起是只读展示(静态 li),服务端只有
`GET /api/projects/{id}/commits` 列表端点——点一行什么也不发生。本票加提交详情面:
行变可点钮,右栏查看器位渲染该提交相对**第一父**的文件级 unified diff。与
[project-files-local.md](./project-files-local.md) / [project-files-drill.md](./project-files-drill.md)
同面同闸:`requireRepoReadDir` 单源目录解析(hosted bare / local 工作树),github 形态
与不可达 local 同族 404。

## Sub-features

- `commit-detail-endpoint` — `GET /api/projects/{id}/commits/{sha}`([推断] 路由,
  wire.test INFERRED_ROUTES 登记):载荷 = 列表行同款五字段(sha/shortSha/message/
  authorName/at,%x00 格式串与 readCommitHistory 同源)+ `files: DocumentDiffFile[]`
  (parseUnifiedDiff 输出,changes 面同族)。封套单源 shared
  projectCommitDetailResponseSchema。
- `first-parent-diff` — diff 口径 = `git show --patch --first-parent`:根提交(无父)=
  相对空树全文件新增;merge 提交 = 相对第一父(默认 combined diff 对干净 merge 恒空集,
  会把「有改动」演成「无改动」,2026-10-10 三形实测后弃用);空提交/纯二进制 =
  files=[] 定义态(parseUnifiedDiff 滤无 hunks 行)。
- `detail-viewer-reuse` — 右栏查看器按 seg 分面:历史 seg = 详情面(头带元信息 +
  关闭钮),文件 seg = 既有文件查看器零回归;diff 渲染复用 docpane `DiffFileBlock`
  (allowFullFile=false 摘全文钮——无全文数据源),不另写渲染。
- `commit-selection-key` — 选中态存 (projectId, sha) 对(fileSel/dirSel 同款纪律);
  sha 进 queryKey,切换提交换键分缓存;行选中载体 = aria-current(#910 裁定 3)。
- `detail-degradation` — 不可达 sha / 注入形 = 404(resolveCommitOr404 缝,rev-parse
  --verify --end-of-options);local 目录消失/非 git = 404 + reason(not_found/not_git),
  web 按 LOCAL_ERROR_REASON_COPY 分译「提交详情加载失败」+ 分译行,不 500 不空树;
  local 整仓不可达时 FilesPane 同闸不渲染(历史行无假面)。

## Drive (vp.mjs)

- `vp.mjs drive project-commit-detail commit-detail`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list project-commit-detail`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- hosted 项目(有提交)或 local 项目(localPath 可达)→ 项目页 文件 tab → 历史 seg →
  点提交行 → 右栏出元信息头 + 文件级 diff;点别的行切换;X 钮清选中。

## Driving it with drive-1102-commit-detail.mjs

Preconditions: `launch.mjs` 已起隔离栈;proxy env 全 unset;本机有 `git`。

- 一键三相位:`env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-1102-commit-detail.mjs` → 控制台 25 条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json + 6 截图)。
- 相位 H:hosted bare repo push 真提交链(种子 → README → side 分支 → main 侧
  another → --no-ff merge)→ REST 五判据 + 浏览器点行/切换/关闭全链。
- 相位 L:local 真仓(默认分支 trunk,根提交 + 二次提交)→ 根提交全文件新增双端钉。
- 相位 D:删 local 仓目录 → API 404+reason 与浏览器整 pane 人话降级。
- 脚本自建道具并自回收(mkdtemp 真仓/hosted clone);hosted push 走 REST 建的
  git API key(Basic auth)。

## Gotchas

- **merge 提交默认 combined diff 恒空集**:详情面必须 `--first-parent`,否则干净
  merge 的详情演成「没有可显示的改动」(假定义态)。server vitest 钉 merge 详情
  files == ['side.txt']。
- **React Query 切回已缓存 sha 零请求**:「切换不串」断言钉内容归属(文件行在/退场),
  不钉请求次数;e2e 首跑按请求序列断言假红一次后改集合判据。
- **stub 世界不供 tree 面时 local 形态整 pane 降级**:跨项目选中态测试的第二项目
  必须用 hosted,否则历史行根本不渲染(treeQ.isError 闸)。
- fixture 面行上 `files` 槽缺席键 = files:[](定义态),与种子空提交真值同形;行数据
  必带肉防死钮(fixture 面禁哑按钮纪律)。
