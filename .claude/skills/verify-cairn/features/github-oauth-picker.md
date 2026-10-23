# GitHub 连接认证 + repo picker(新建项目)

用户在新建项目表单选「GitHub 仓库」:未认证 → 「认证 GitHub」钮走 OAuth(同页签跳 GitHub 授权页,callback 302 回本页自动开 picker);已认证 → picker 触发钮开锚定弹层(搜索 / 仓库行单选回填 owner/repo 与项目名 / 断开钮);三种降级(公开仓免认证 / 组织仓不在列表 / OAuth 未配置)都经「手动输入 owner/repo」链接切回现状 input(isGithubRepoRef 提交闸不变)。#361(spec 12 G2-T4);连接数据面(schema/DAO/repos 代理)见 [local-repo-api.md](./local-repo-api.md)。

## Sub-features

- `auth-face` — 未认证选「GitHub 仓库」= 认证钮 + 手动兜底链接;live 点认证 = POST github/oauth/authorize → 同页签跳授权页;OAuth env 未配 = authorize 400 原文落内联错误行。
- `connection-status` — `GET /api/teams/{id}/github/connection`:未连接 `{connected:false}` 恰形;已连接 `{connected:true,login,scope}`(无 token 位,02 §8)。
- `disconnect` — `DELETE` 同路径:删行幂等(缺行 204);UI = picker 头部「断开连接」钮 → 回未认证面。
- `picker` — 已认证面:触发钮开弹层,搜索框本地过滤 full_name(数据 = `GET /api/github/repos` 单页 100 条),行单选 → 回填 owner/repo + 项目名(回填律:名称空或等于上次回填值才覆盖)。
- `manual-fallback` — 手动链接 → owner/repo input(现状面);合法 ref + 名称 → 创建钮放开 → 提交建 repoKind=github 项目(公开仓免认证全链)。
- `callback-landing` — callback 302 回 `/app/project/new?oauth=connected|error&reason=…&github=connection`:connected 自动开 picker;error reason 三译落内联行;读后清参不重放。(真 OAuth 回环需真 App 凭证 + 人环,见 Gotchas。)

## How to get to it (user POV)

- web:侧栏/项目页「新建项目」→ `/app/project/new` → 仓库行 → 「GitHub 仓库」。
- API:`GET|DELETE /api/teams/{id}/github/connection`、`POST /api/teams/{id}/github/oauth/authorize`、`GET /api/github/repos?q=`(T1 面)。
- 驱动(`vp.mjs list github-oauth-picker` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive github-oauth-picker oauth-and-manual-repo`:未认证态认证钮 + 手动兜底建 github 项目全链。

## Driving it with probe-github-oauth.mjs

Preconditions: `launch.mjs` 已起隔离栈(全新库);proxy env 全 unset;chromium 可用(仓库自带 @playwright/test)。

- 一键全链:`env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-cairn/scripts/probe-github-oauth.mjs` → 控制台逐条 PASS/FAIL + `evidence:<目录>`(result.json + responses.json + auth-face/error-face/created-project 截图)。
- authorize 双形自适应:OAuth env(`CAIRN_GITHUB_OAUTH_CLIENT_ID/SECRET`)未配 → 断 400 not-configured + UI 点认证落内联错误行;已配 → 断 200 授权 URL 形状(scope=read:user repo)且 UI 段跳过点认证(不跟跳真授权页)。
- 第二只眼:手动兜底建出的项目经 `GET /api/projects` 投影断 repoKind=github + githubRepo 原值。

## Gotchas

- **真 OAuth 回环不可自动化**:授权页 → callback → token 密封落行 → picker 列表这段需真 GitHub App 凭证 + 人环登录/2FA。进程内全链证明在 `apps/server/test/github-oauth.test.ts`(mock 上游 14 条:happy 落行 / GET /user 失败归 exchange / denied / state 过期 / 两族不串线 / token 永不进 wire);live probe 只验不需凭证的面,勿冒充全覆盖。
- callback 落点按 state kind 分支:connection 族 → `/app/project/new`,provider 族(#231)→ `/app/resources/providers`;state 不在册(kind 不可判)默认 providers 页。验落点用 server test,不要在 live 手造 state。
- picker 列表 live 有数据的前提 = github_connection 行有真 token(断开面验完即回未连接);无凭证栈上 `GET /api/github/repos` 只能验 404 面。
- fixture 面(scenario=github-picker)的行为钉在 `apps/web/e2e/project-new-github.spec.ts`(15 条),live probe 不重复。
- 8791/5273 常被别的 lane 占用——换 `VERIFY_PORT`/`VERIFY_WEB_PORT`,不杀。
