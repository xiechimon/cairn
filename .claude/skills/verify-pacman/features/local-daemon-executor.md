# local 项目 daemon 执行面(镜像 clone + conv 分支落地)

local 仓库项目的任务执行链(spec 12 G2-T2,#362):daemon 对用户本机 git 仓做硬链接镜像 clone 开 worktree,每步 commit 后 conv 分支 push 回用户仓库;merge 步在独立 worktree 里 `git merge origin/<default>` 后把 conv 分支 push 回用户仓库即落地(#1211:用户主检出的分支/reflog/工作树永不被 pacman 触碰,合并到默认分支由用户自取)。web 面 Files tab 已随 #1030 开闸(读面 + 降级,见 [project-files-local.md](./project-files-local.md));GitHub 形态执行凭证(per-step x-access-token)同票接线,消费面在 daemon git spawn。

## Sub-features

- `local-clone` — runner 对 `repo.kind==='local'` 开 worktree:cloneUrl = 用户仓库绝对路径,`git clone` 本地路径默认硬链接(近零成本);托管存储面(server reposDir)零写入。
- `local-push-back` — 每步收尾 conv 分支 `pacman/conv-<buildId>` push 回用户仓库 refs/heads(非 bare 收 push;不触用户当前分支)。
- `branch-landing` — merge 步 push 后用户仓库 refs/heads 的 conv 分支 tip = merge checkpoint(#1211 判据:用户 main HEAD/reflog/工作树零变化、status 干净;脏工作区不阻断——落地不读用户工作区)。
- `github-per-step-token` — github 项目 token 端点下发 `{username:'x-access-token', password:<connection token>}`;凭证只经 GIT_CONFIG_* env credential.helper 注入,fork+exec argv 全程无 token(PATH shim 捕获证明)。
- ~~`files-tab-disabled`~~ — #1030 已推翻:local 项目 Files tab 开闸,读面/降级配方迁 [project-files-local.md](./project-files-local.md)。

## How to get to it (user POV)

- 执行面:新建 local 项目(见 [local-repo-api.md](./local-repo-api.md))→ 建任务 → 开始构建(withPlan)→ 确认 → 执行 → 发起合并;观察用户仓库分支/HEAD/工作树。
- Files tab 面:进入 local 项目详情页 `/app/project/:id`(默认落 文件 tab)→ 文件浏览,配方见 [project-files-local.md](./project-files-local.md)。

## Driving it with 集成 E2E + fixture e2e

Preconditions: proxy env 全 unset(回环过代理 = 假阳性);本机有 `git`。

- daemon 执行面全链(真 server + 真 daemon + stub LLM + 真 git):`cd integration && env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*' npx vitest run test/g2t2-local-lifecycle.test.ts` → 2 测试(硬链接/推回/conv 分支落地 + 主检出 reflog/HEAD/status 零变化 + 脏工作区不阻断且用户工作区原样)。
- hosted 面不回归对照:`npx vitest run test/m3b-demo.test.ts`(runner 改动触碰共链,收尾必跑)。
- argv 凭证纪律 + workspace 落地面:`cd apps/daemon && npx vitest run test/local-executor.test.ts`(PATH shim 捕获 fork+exec 命令行)。
- server claim/token 接线:`cd apps/server && npx vitest run test/g2t2-executor-wire.test.ts`。
- Files tab 面(fixture e2e):`cd apps/web && npx playwright test e2e/project-files-local.spec.ts`(scenario `prj-local-files`;#1030 起开闸,旧 disabled 钉子退役)。
- live re-probe(隔离栈真 daemon 走 UI 建 local 项目全链)待补。

## Gotchas

- **用户仓库的交付面只有 refs/heads/pacman/ 分支**:plan/build/merge 每步都只 push conv 分支,用户 main 永不被 pacman 推进——验「用户仓库被改」看 `refs/heads/pacman/conv-<id>` 的 tip(merge 步后 = checkpointCommit),别看 HEAD/reflog(它们必须逐字不变,前后对拍 `git reflog main`)。
- 脏工作区不影响任何步收尾:落地只写 conv 分支 ref,不读用户工作区——用户未提交改动原样保留。
- 硬链接证据面(`nlink ≥ 2`)要求 clone 源与 workspacesRoot 同卷——测试道具都落 os.tmpdir();跨卷会静默退化为 copy。
- github 形态 token 下发前提是 github_connection 行在位(OAuth 面见 [github-oauth-picker.md](./github-oauth-picker.md));无行 = git 槽 null,私有仓失败原文浮在步 reason,不是 token 端点错。
- Files tab 读面 #1030 起开闸(server 直读 localPath 工作树):驱动配方与降级语义见 [project-files-local.md](./project-files-local.md),别再按「禁用占位」断言。
