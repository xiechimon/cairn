# 本地仓库项目与 GitHub 连接(server API 面)

用户把本机既有 git 仓库接进 cairn 建项目(spec 12 三形态之一),以及 GitHub 认证选仓的连接数据面。G2-T1(#359)落地 server 半:local 路径三态校验、github_connection 密封表、repo picker 代理端点。web 表单入口已随 G2-T3(#360)落地,UI 面验证走 [project-new-form.md](./project-new-form.md);OAuth 认证 + picker UI 面已随 G2-T4(#361)落地,见 [github-oauth-picker.md](./github-oauth-picker.md)——本条目只留 API 数据面。

## Sub-features

- `local-create` — `POST /api/projects {kind:'local', localPath}`:server 端 `~` 展开 + 存在性 + git 工作树判定,任一不过 400(reason code:not_found / not_git / not_absolute,#386);通过 201,record/DB 行带规范化 localPath。
- `hosted-compat` — 既有 `repoKind:'hosted'` 创建面不回归(bare repo provisioning + cloneUrl)。
- `repos-proxy` — `GET /api/github/repos?q=`:token 取自 github_connection(SecretBox 密文),未连接 404;连接后代理 GitHub `/user/repos`(连接写入面见 github-oauth-picker.md)。
- `connection-table` — github_connection 表形:teamId 单行、accessToken 只有 cipher 列位、无 plaintext token 列。

## How to get to it (user POV)

- API 直入:`curl -X POST http://127.0.0.1:<VERIFY_PORT>/api/projects -H 'content-type: application/json' -d '{"name":"x","kind":"local","localPath":"/abs/path/to/repo"}'`。
- web 新建项目表单「本地文件夹」条目:已落地(G2-T3/#360),驱动配方见 [project-new-form.md](./project-new-form.md)。
- 驱动(`vp.mjs list local-repo-api` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive local-repo-api local-repo-api`:local 项目 API 三态校验 + GitHub 未连接 404。

## Driving it with probe-local-repos.mjs

Preconditions: `launch.mjs` 已起隔离栈(全新库);proxy env 全 unset(回环过代理 = 502 假阳性);本机有 `git`。

- 一键全链:`env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/probe-local-repos.mjs` → 控制台 11 条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json)。
- 脚本自建道具(mkdtemp + `git init` + 空提交的真仓 / 非 git 目录),跑完自清理;三态断言 = 400+reason=not_found(不存在)/400+reason=not_git(非 git)/201(真仓,record.localPath = 原值)。
- 第二只眼:`responses.json` 收全部 HTTP 应答;SQLite 只读断言 project.localPath 列值 + `PRAGMA table_info('github_connection')` 列集恰为 teamId/login/accessTokenCipher/scope/createdAt。

## Gotchas

- **本条目 = server API 数据面**:web 表单面在 [project-new-form.md](./project-new-form.md)(G2-T3 已落地);OAuth+picker live 面在 [github-oauth-picker.md](./github-oauth-picker.md)(G2-T4 已落地);local clone 执行面(daemon)归 G2-T2——声称覆盖时点名所属面。
- `~` 展开走 server 进程 HOME——live probe 不改 HOME(集成测 `apps/server/test/project-local.test.ts` 以注入 homeDir/改 env 覆盖)。
- repos 代理「已连接」路径 live 验需要 github_connection 行;REST 写入面已随 G2-T4 落地(authorize → callback),但走通需真 GitHub App 凭证 + 人环授权,勿手工 INSERT 冒充(密封纪律的进程内证明在 `apps/server/test/github-connection.test.ts` 与 `github-oauth.test.ts`:密文列扫描 + Authorization 头唯一消费位 + token 永不进 wire 断言)。
- 8791/5273 常被别的 lane 占用——换 `VERIFY_PORT`/`VERIFY_WEB_PORT`,不杀。
