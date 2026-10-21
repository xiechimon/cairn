# 新建项目表单(web 面)

用户从侧栏「新建项目」进 `/app/project/new`,填项目名、选仓库形态(GitHub 仓库 / 本地文件夹 / 不选),创建项目并跳到项目页。G2-T3(#360)落地:菜单两行(hosted 行创建入口移除,未选 = 无 repo 普通项目)、名称自动回填(local = basename、github = repo 段,手改后不覆盖)、本地路径 400 红色错误行、输入框 focus-visible spot 系收编(吃 --focus-ring)。server 校验半见 [local-repo-api.md](./local-repo-api.md);OAuth picker 归 G2-T4,落地后回补本文件。

## Sub-features

- `menu-two-rows` — 仓库菜单恰两行「GitHub 仓库」「本地文件夹」;hosted 行创建入口消失(server REST/MCP 仍接受 hosted,存量项目不动)。
- `name-backfill` — local = `basename(localPath)`(容忍尾斜杠),github = 有效 `owner/repo` 的 repo 段;仅当名称为空或仍等于上次回填值时覆盖,手改后路径变化不再覆盖,清空后恢复。
- `face-swap` — 选态换输入面(github = owner/repo 输入,local = 绝对路径输入)+ swap 钮重开菜单;切形态时旧输入面退场。
- `submit-gates` — 名称空 / local 路径空 / github ref 非法(isGithubRepoRef 同源闸)= 创建钮 disabled。
- `local-error-row` — server 400 按 reason code 三态分类落红色错误行(not_found = 路径不存在 / not_git = 不是 git 仓库 / not_absolute = 需要绝对路径;无 code / 未分类原文直透,#386),阻止导航;编辑路径即撤陈旧错误。
- `focus-ring` — 项目名/GitHub/路径输入框 focus-visible = outline none + spot 系边框(吃 --focus-ring,暗 #cba6f7)+ 1px ring(共享 input 原语配方)+ `-webkit-autofill` 覆盖,非 UA 默认蓝。
- `create-chains` — 三条提交链落库:local(repoKind/localPath)、github(repoKind/githubRepo)、未选(repoKind NULL 无 repo 项目),成功导航 `/app/project/<id>`。

## How to get to it (user POV)

- 侧栏「新建项目」→ `/app/project/new`(live 面,URL 不带 `?scenario=`)。
- fixture 面交互链回归(菜单/回填/focus 计算样式/提交 body 桩断言)在 `apps/web/e2e/project-new-repo.spec.ts`,不走本 harness。
- 驱动(`vp.mjs list project-new-form` 列出全部 case 与 usage):
  - `node .claude/skills/verify-pacman/scripts/vp.mjs drive project-new-form new-form`:新建项目表单菜单、名称回填、三条创建链。

## Driving it with drive-project-new-form.mjs

Preconditions: `launch.mjs` 已起隔离栈(全新库;worktree 车道传 `VERIFY_REPO_ROOT`);proxy env 全 unset;本机有 `git`。

- 一键全链:`env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-project-new-form.mjs` → 控制台逐条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json + 6 张截图)。
- 脚本自建道具(mkdtemp + `git init` 空提交真仓 / 非 git 目录 / 不存在路径),跑完自清理。
- 用户动作 = 真点真填:开菜单选行、填路径看名称回填、手改名称验证不覆盖、点创建走导航;错误行用真 server 400(非桩)。
- 第二只眼:`GET /api/projects` record 真值(repoKind/localPath/githubRepo)+ SQLite 只读行(local 行与未选行 repoKind NULL);focus 面 = computed style(outline/border/box-shadow 对 `--focus-ring` 暗 rgb(203,166,247))+ 截图 `03-focus-ring-spot.png`。
- 关键截图:`01-menu-two-rows` / `02-backfill-local` / `03-focus-ring-spot`(AC「spot 系边框而非 UA 默认蓝」)/ `04-error-path-not-found` / `05-error-not-git` / `06-created-local-project`。

## Gotchas

- **`-webkit-autofill` 覆盖不可 live 驱动**(浏览器不暴露触发面)——凭 CSS 配方审查 + e2e 计算样式钉 focus 面;别声称 probe 验过 autofill。
- github 面是认证门控(#361):未认证时 `owner/repo` input 不存在,得先点「手动输入 owner/repo」兜底链接才露出——probe 每处填 github input 前都要先点该链接(选行 → 点链接 → 填),漏了就是 30s fill 超时;要点有多处,别只修第一处。
- 错误行分类吃 server 400 应答的结构化 `reason` code(词汇单源 = shared `PROJECT_LOCAL_ERROR_REASONS`,#386 起);消息文案不再是契约,server 随便改 error 文案不受影响——若 server 校验另抛新 code,web 按未分类降级原文直透,probe 会红提醒对齐。
- 未选形态提交 body 不带 `kind`/`repoKind`——record 里 repoKind 为 null/缺省都算过(`== null` 判定),别收紧成严格 undefined。
- vite dev 首载冷转换较慢,`gotoNew` 等待给到 20s;页面没起来先 doctor,别急着改断言。
- 8791/5273 常被别的 lane 占用——换 `VERIFY_PORT`/`VERIFY_WEB_PORT`,不杀。
