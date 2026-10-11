# 12 · 新建项目支持本地仓库与 GitHub 认证选仓

> 上游参照 = todos.dev 现行 new-project 表单（2026-09-28 实测）。本 spec 锁 web 新建项目表单的终态、schema/executor/认证四条 seam、GitHub 绑定获取真实执行面、3 件死因及护栏。父 issue = #352；施工票 G2-T1..T4 在 #352 之下展开（blocking 边）。
>
> 上游参照 router URL = `/app/projects/new`。仓内路由别名 `PROJECTS_NEW_HREF` = `project-new-page` 模块导出路径。

## Problem Statement

新建项目表单现状：仓库选择器两形态——「新的 Todos 托管仓库」（hosted，未动表单的提交默认值）与「GitHub 仓库」（手动输入 owner/repo）。这造成四个用户痛点：

1. **没法建本地仓项目**：本地已有 git 仓库想接进 pacman 跑任务，目前无对应形态。
2. **GitHub 绑定没真实执行面**：任务跑在裸任务目录里，不在仓库里，commit 与回写全是 in-place，diff / push 不可达。
3. **OAuth 银弹未引入**：填 owner/repo 私人仓 / 加入 collaborator 都要先 fork 再粘，体验重。
4. **表单 chrome 与 input 原语收编不齐**：项目名输入框 focus-visible 是 UA 默认蓝，与仓内 indigo 描边 token 不一致。

## Solution

web 新建项目表单收敛为两可选条 + 一兜底：

- **GitHub 仓库**：OAuth 认证（复用 #231 web flow，加 `repo` scope）后从用户自己的仓库列表 picker 单选回填。
- **本地文件夹**：粘贴绝对路径（支持 `~` 展开），server fs 校验为 git 仓库、复制到 executor 的工作空间走镜像 clone。
- **不选任何项提交**：无 repo 普通项目（repoKind null，executor 裸任务目录退化形已端到端支持）。

补充终端语义：

- 删除「新的 Todos 托管仓库」web 入口（server REST 与 MCP create_project 仍接受 `kind: 'hosted'`，存量项目不受影响）。
- 名称自动回填：local = `basename(localPath)`；github = repo 名。仅当名称字段为空或仍等于上次回填值时覆盖（用户手改过则不动）。
- 输入框去默认蓝：与仓共享 input 原语同款 focus-visible（outline none + indigo 边框 + 1px ring）+ `-webkit-autofill` 覆盖。
- daemon 端 `kind === 'local'` 分支走硬链接镜像 clone + conv 分支 push 回用户仓库即落地（#1211：用户主检出的分支/工作树永不被 pacman 推进）；GitHub 绑定走 per-step `GIT_CONFIG_*` env credential.helper 注入（不进 argv / 不落盘），conv 分支 push 回远端。

## User Stories

1. 作为有本地 git 仓库的开发者，我在新建项目表单粘贴我的仓库绝对路径，pacman 验证是 git 仓库、自动把项目名填成路径 basename，然后我可以保存并立即开始构建。
2. 作为 GitHub 用户，我在新建项目表单点「GitHub 仓库」按钮，被引导走 OAuth 授权一次 GitHub App（加 `repo` scope），认证完成开一个搜索+列表 picker，单选我的某个仓库就回填 owner/repo 与项目名。
3. 作为测过 OAuth 但有人换电脑的开发者，我只要回到那台机器登录一次，回来重选 OAuth，再建项目流程无感。
4. 作为没有选中任何仓库的开发者，我提交后是个无 repo 项目（repoKind null），executor 跑在任务裸目录，符合 v1 默认形态。
5. 作为管理员，我不希望 web 表单可以创造任何新的「新的 Todos 托管仓库」项目；存量 hosted 项目继续可用。
6. 作为 UI 审阅者，我看新建项目表单的输入框（项目名、GitHub owner/repo、本地路径）focus-visible 高亮是仓内统一 indigo 描边，不再是 UA 默认蓝。
7. 作为开发者，我从 web 触发 OAuth 失败时，pacman 给我清楚的失败 reason（denied / state 过期 / 令牌交换失败）并保留手动输入 owner/repo 兜底入口，让我永远能完成 GitHub 绑定。
8. 作为开发者，我在本地仓库项目里改完文件提交 conv 分支，pacman 把 conv 分支 push 回我的原仓库（我的仓库多出 `pacman/conv-<id>` 分支）；我当前检出的分支与工作区永不被 pacman 触碰，把分支合进默认分支由我自己决定。
9. 作为开发者，我在 GitHub 绑定项目里改完文件提交 conv 分支，pacman 把 conv 分支 push 上 GitHub 远端，发起方凭证（OAuth 注入的 GitHub token）仅在该步骤使用，步收尾即清。
10. 作为安全审阅者，我看 github_connection 表里的 accessToken 走与 secrets 同款的 SecretBox AES-256-GCM 密封存储，never 落盘到 argv 与日志，never 离开 server 出站边界。
11. 作为多机部署的运维者，我看 server 对 local 路径校验降级为「不可见即跳过」（daemon 侧真实存在性兜底），避免误判挂掉新项目流。
12. 作为回归测试者，我看 verify-pacman feature map 先扩到位（GitHub OAuth + picker + local clone + local 落地），实现票消费的 web spec / integration locator / 视觉几何同步翻红转绿，证据进 review。

## Implementation Decisions

### 模块改动清单（决策点，不含具体文件路径）

**shared**
- `PROJECT_REPO_KINDS` 词表新增 `'local'`；同源扩展至 projectRecordSchema + createProjectBodySchema 的 wire shape。
- 新 schema：project 表新 `localPath` nullable text 列。drizzle migration 一条；票面不写死编号，合并期按 main 尾部 + 1 编。

**server**
- `GET /api/github/repos?q=` 新增代理端点（lib/github.ts 缝内调用 GitHub `GET /user/repos`，附带 token 由 server 从 github_connection 取出），带 rate-limit 与过滤。
- `POST /api/projects` 校验扩展：`kind === 'local'` 时 `fs.existsSync` + is-git-repo（经 systemGitOps 缝），失败 400；多机部署 `[设计]` 降级为跳过。
- 新增表 `github_connection`（teamId unique、login、accessToken 经 SecretBox AES-256-GCM 密封、scope、createdAt）；DAO = 重认证=覆盖、断开=删行。
- OAuth web flow 复用 #231 族的 callback 路由，仅加 `repo` scope；state 区分 gitHubConnection vs existingUses。

**web**
- project-new-page 表单：菜单两行「GitHub 仓库」「本地文件夹」；删 hosted 行创建入口；名称回填：local=`basename(localPath)`、github=repo 名，仅当空或仍等于上次回填值时覆盖。
- 输入框 focus-visible 收编（与共享 input 原语同款）：outline none + indigo 边框 + 1px ring；`-webkit-autofill` 覆盖。
- picker 面板（搜索 + 仓库列表）；底部「手动输入 owner/repo」小链接切回现状 input（公开仓免认证 / 组织仓不在列表 / OAuth 未配置三种降级）。
- 错误原因（denied / state 过期 / 令牌交换失败）经 #243 三译落进 picker 头/内联错误行。

**daemon executor**
- runner 增 `kind === 'local'` 分支：`git clone <localPath>` → `workspacesRoot/<projectId>/repo`（本地 clone 走硬链接，近零成本）；worktree 契约零改动；conv 分支 push 回用户仓库。
- merge 步 = 在独立 worktree 里 `git merge origin/<default>` 后 conv 分支 push 回用户仓库 refs/heads（#1211：落地即分支交付，用户主检出的分支/reflog/工作树零变化；合并到默认分支由用户自取）。
- 应用面 `applyMergeLanding` 保持 hosted-only；本地落地面在 daemon 侧。
- GitHub 执行：server 从 `github_connection` 取 token，per-step 下发 `GitCredentials{username:'x-access-token', password:token}` 复用 `GIT_CONFIG_*` env credential.helper 注入缝（不进 argv、不落盘；步收尾即清）。
- daemon 对 `kind === 'github'` 开 worktree（https clone，契约零改动）；conv 分支 push 上 GitHub。
- v1 出局：Files tab 对 local 项目隐藏/禁用（附一行 disable 提示）；chief-tools/MCP create_project 不支持 local。【2026-10-08 #1030 推翻前半：Files tab 已开闸（读面 = server 直读 localPath 工作树，不可达走分类降级）】

**i18n**
- en/zh 同步新增/修改文案；按仓 i18n-coverage 闸走 PR。

**verify / e2e**
- verify-pacman feature map 扩 GitHub OAuth + picker + local clone + local 落地 + 路径校验各一条；G2-T1..T4 同步 web spec + integration locator + 视觉几何（钉扎四面）。

### 数据契约（票内可微调）

- `GET /api/github/repos?q=` → `{ repos: [{id, owner, name, full_name, private}] }`
- `POST /api/projects` body 新面：`{ kind: 'github'|'local'|'hosted', localPath?: string, githubRepo?: { owner, repo } }`；validation per above
- `github_connection` 表 schema = `{ teamId: recordId unique, login, accessTokenSecret: SecretBox ciphertext, scope: string, createdAt: epochMs }`

## Testing Decisions

测试侧重端到端，可验证可见行为，不校验实现细节。

- **daemon executor E2E**：
  - local 镜像 clone 走的硬链接数低于直 copy（合理阈值 由 OS fs 决定）
  - local 落地 happy path：conv 分支 push 回用户仓库 refs/heads、用户主检出 HEAD/reflog/工作树零变化（#1211）
  - 脏工作区（用户有未提交改动）→ push 照常成功、用户工作区原样
  - GitHub 执行：mock server 出 `/api/github/repos`；daemon per-step token 消费验证（捕获 fork+exec 命令行，断言无 token 在 argv）
- **web e2e**：
  - 未点 OAuth 直接点「GitHub 仓库」→ 显示「认证 GitHub」钮
  - OAuth callback 成功 → picker 面板打开
  - picker 单选 → 回填 owner/repo 与项目名
  - 手动兜底链接 → 切回现状 input，isGithubRepoRef 闸不变
  - local 路径粘贴 + basename 回填 + 提交
  - 输入框 focus 截图（视觉几何断言：indigo 边框而非 UA 蓝）
- **server 集成测**：localPath 校验三种（不存在/不是 git/是 git）；github_connection 增/覆盖/断开/repo 代理；OAuth callback reason 三译

## Out of Scope

- **PR/合并落地**：GitHub 项目构建完的 PR/合并 UI 归后票；本轮 done 语义 = conv 分支已 push 上 GitHub
- **Files tab 隐藏的完成 UI**：仅 disable + 一行文案，详细列表/编辑器响应式后续【#1030 已推翻：Files tab 开闸】
- **chief-tools / MCP create_project 支持 local**：v1 拒；待 spec 后续票
- **多机部署的 server 本地路径校验替代**：v1 降级为跳过；替代实现归后票【#1030 起读面侧已正面处理：不可达 = 404 + reason 分类降级（创建校验面仍单机假设）】
- **GitHub App 本身注册与配置指引**：env 槽 `config.githubOauth` 用户自配（已在 v0 配），本票前提「env 已配 App」

## Further Notes

### Premortem（三大死因 + 护栏）

- **落地写进用户主检出** → 护栏：落地 = conv 分支 push（`refs/heads/pacman/…`），pacman 对用户仓库的工作区与当前分支零写操作——主检出的分支/reflog/工作树永不被碰（#1211）
- **多机部署下 server 校验本地路径误判** → 护栏：单机假设票面 `[设计]` 标注；校验实现为「不可见即跳过」，执行面（daemon 侧）兜底报错
- **OAuth App scope/callback 与既有 GitHub Copilot provider OAuth 配置冲突** → 护栏：复用同 App 仅加 scope，callback 路由以 state 区分族；not-configured 错误族已存在；手动 owner/repo 兜底保证 GitHub 绑定永远可用

### 与 #347、#350 的关系

- #347（详情页发送钮被总管悬浮钮覆盖，已修）= 真实遮挡；本 spec 不沾。
- #350（providers/machines 行「按钮不可点」= 行可点感误导，wontfix）= 本 spec 与 spec 11 是姐妹文件，行可点感收编（A7 in spec 11）已合并进行动。

### 节奏

施工票 G2-T1..T4 在 #352 之下展开：
- G2-T1（shared + server schema/API）= 无阻塞、先建
- G2-T2（daemon executor）= blocked by G2-T1 + G2-T4（github 执行凭证依赖 connection 行有 token）
- G2-T3（web 表单）= blocked by G2-T1
- G2-T4（GitHub 认证 + picker）= blocked by G2-T1

Frontier 初始 `{G2-T1}`；T1 完开 `{T2, T3, T4}` 三并发。
