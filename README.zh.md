<div align="center">
  <img src="apps/web/public/logo.svg" alt="pacman 应用图标" width="128" height="128">
</div>

# pacman

自托管、开源的 **agent workspace**：一块任务看板——你写任务，AI agent 在你自己的机器上把它们做出来。

[English](./README.md) | 简体中文

## 是什么

你在看板上立一个任务，agent 领取后检出 worktree 与分支，把过程以对话流实时打回界面——方案卡、diff、工具调用全程可见。运行到审核关口暂停，由人决定合不合。

- **任务与阶段** — 看板 + 带序号的任务、标签、按周期自动重跑的定时。
- **Agent** — 配了模型、职责、技能、MCP 服务器、密钥与记忆的执行角色；每用户一个「总管」agent 负责分派。
- **机器** — 在任意主机跑 daemon 即登记为执行机；build 在其上受监督执行。机器是你的，规则也是你的。
- **模型服务** — api_key / OAuth（GitHub Copilot、OpenAI Codex）/ 自定义端点三协议接入。
- **仓库** — server 自托管 git 仓（API key 走 push/pull），或从 GitHub 接入。
- **全实时** — 看板与会话走 SSE 流、通知、按 build × 模型记账 token 用量。

## 为什么

- **以闸为核。**每一次运行都在两处为你停留——方案与 diff——且 AI 审核者能否决，而不只是评论。今天唯一做到这一点的开源、可自托管 agent workspace。
- **出身透明。** pacman 起步于对 todos.dev 公开界面的 clean-room 研究（见[渊源](#渊源)），现为自主产品；分化路线从真实使用中涌现，不抄任何人的 spec。

## 快速开始

环境要求：Node.js 22 或 24（LTS 线自带 better-sqlite3 预编译产物；其它版本可能回退源码编译，需要构建工具链）。

```sh
npx @xiechimon/pacman
```

一条命令：下载、启动、托管在 **http://127.0.0.1:8787/app**。首启在 `~/.pacman` 下自动建库 + 迁移 + seed 默认团队。

换端口：`PORT=9000 npx @xiechimon/pacman`。

### 让自己的机器跑 build

不起 daemon 也能用全部界面功能；要让 agent 真在某台机器上跑 build 时再登记。在执行机上：

```sh
npm i -g @xiechimon/pacman-cli
# 首次注册：网页 /app/api-keys 建 key（明文只显示一次），然后
pacman start --api-key <pacman_...> --team <teamId>
# 日常（凭据已存 ~/.pacman/machine.json）：
pacman start        # stop / restart / logs -f / status 同面
```

两个包都装 `pacman` 这个 bin：同机全局双装时后装的占名。干净的分工是——浏览机跑 server，执行机装 pacman-cli。

### 从源码开发

要求 Node.js >= 22.19、pnpm（可 `corepack enable`）。

```sh
pnpm install
pnpm start        # 构建 web UI 并由 server 同源托管
```

watch 模式开发栈，每进程一条：`pnpm dev:web`、`pnpm dev:server`、`pnpm dev:daemon`（`pnpm dev` 三进程一起跑）。

## 配置

server 环境变量（全部可选）：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PACMAN_TOKEN` | 未设 | 守护 `/api/*` 的 Bearer token。设 = 开鉴权（web 首访出 token 门页）；未设 = 关（默认）。两条 SSE stream 端点额外接受 `?token=`（EventSource 设不了 header）。绑非 localhost 接口时务必设。 |
| `PORT` | `8787` | HTTP 监听端口。 |
| `HOST` | 未设（全部接口） | HTTP 绑定地址。分体部署（server 在常开主机、daemon 在另一台机器用 `PACMAN_SERVER` 指过来）时设为该主机的局域网/内网地址，并同设 `PACMAN_TOKEN`。显式 `0.0.0.0`/`::` 且 `PACMAN_TOKEN` 未设 → 启动日志 WARN。 |
| `PACMAN_HOME` | `~/.pacman` | 数据根。server 状态在 `<PACMAN_HOME>/server/`（`server.db`、`secretbox.key`、托管裸仓）；daemon 的 `machine.json`、`daemon.log`、`workspaces/` 在根下。**备份 = 整目录拷走**——密文离了 keyfile 永久不可解，只拷 db 没用。 |
| `PACMAN_GITHUB_OAUTH_CLIENT_ID`<br>`PACMAN_GITHUB_OAUTH_CLIENT_SECRET` | 未设 | 自注册 GitHub OAuth App 的凭证对，开启 provider OAuth 登录。两件同设或同缺——只配一件 server 启动即报错，不静默。 |
| `PACMAN_WEB_DIR` | `apps/web/dist`（存在即托管） | SPA 静态托管根覆写；未设且无构建产物 = 纯 API 形态。 |
| `PACMAN_SKILLS_DIR` | `~/.agents/skills` | 技能根目录。每个含 `SKILL.md` 的一级子目录 = 一个技能（id = frontmatter `name`，缺省回落目录名）。每次请求现扫，不入库——加技能 = 往目录放文件夹，删技能 = 删文件夹。 |
| `PACMAN_ISSUE_INTAKE` | 未设（关） | GitHub issue 进料。`1`、`true` 或 `yes` 开，其余值一律关，默认关。开了之后 server 每 5 分钟从已连接 GitHub、且总管已绑定带模型 Agent 的团队的每个 GitHub 项目里，领带 `ready-for-agent` 标签的 open issue，导入成任务并开始编排。只领该标签最新一条 `labeled` 事件由仓库 triage、write、maintain 或 admin 权限用户亲手打上的 issue：经 GitHub App 打的标不算，即使 app 持有该用户的授权。这一条只认得出 GitHub App：用 `gh` 或个人访问令牌（PAT）以该用户身份打标的 agent 会话，看上去与该用户亲手打的一样，照领。别人打的、或打了又摘的也不领。每个项目同时至多 3 张不在已完成 / 已关闭的导入任务（失败的也算）。开启时已经打着标签的存量 issue 也会被领，按最旧先、受同一上限约束（每个项目每轮至多读 300 条带标签的 issue）——开之前先看清哪些 issue 打着标签。进料导入的任务以总管绑定的 Agent 为创建者，进料也只关这些任务：手工导入或 webhook 导入的任务从不被它关闭，总管没绑 Agent 的团队不关任何任务，总管换绑别的 Agent 之后，换绑前领的任务也不再由它关闭。这样的任务，server 见过它的 issue 处于 open、之后又看到它被 triage 及以上权限的用户关闭，才把任务关闭；server 第一次看到 issue 时它已关闭（例如重启后）、外部作者自己关掉的 issue、被人重新打开的任务都不动，审核中的任务、有 build 开出过 PR 的任务也不动，拆分后子任务还没全部完成或关闭的任务也不动。这些开出过 PR 的任务进料从不收尾：审核中的，等 [#1403](https://github.com/xiechimon/pacman/issues/1403) 的 PR 对账上线后由它收尾；其余相位的，留在原处，等人手动处理。导入后开始编排失败的，后面几轮重试，连同第一次至多 3 次（重启后不再重试），之后任务留在待开始等人处理。GitHub 读遇到限流时，该团队这一轮停读，等下一轮，日志写明限流解除的时刻。启动日志写明进料开没开。 |

daemon 环境变量（上述 CLI flag 的等价覆写）：`PACMAN_SERVER`（默认 `http://127.0.0.1:8787`）、`PACMAN_API_KEY`、`PACMAN_TEAM`、`PACMAN_WORKSPACES_DIR`（默认 `<PACMAN_HOME>/workspaces`）。

## 开发

```sh
pnpm dev:server   # API server 热重载，http://127.0.0.1:8787（首启建库 + 迁移 + seed）
pnpm dev:web      # vite dev server，http://localhost:5173，/api 与 /git proxy 到 8787
```

vite dev server 带 `strictPort`：撞端口即启动失败，不静默顺延到下一个空闲口。危险的是
顺延而不是撞端口本身——proxy 目标不变，顺延后的界面会去驱动持有该端口的别的栈。
覆写走 `PACMAN_DEV_WEB_PORT` / `PACMAN_DEV_SERVER_PORT`。

提交前三闸：

```sh
pnpm lint         # biome ci
pnpm typecheck    # 全包 tsc
pnpm test         # vitest
```

### 仓库结构

| 路径 | 内容 |
|---|---|
| `CONTEXT.md` | 领域模型与术语表（中文界面词 ↔ 英文原词 ↔ 内部名，canonical） |
| `apps/web` | Web UI（React + vite） |
| `apps/server` | server：Hono REST + SSE + SQLite（包名 `@xiechimon/pacman`，目录名 ≠ 包名） |
| `apps/daemon` | 执行机 daemon（包名 `@xiechimon/pacman-cli`，目录名 ≠ 包名） |
| `packages/shared` | 协议词表 / 记录形状 / 品牌槽单源（`@pacman/shared`） |
| `docs/spec/` | 实现正典 00–25 册（中文） |
| `docs/research/` | r1–r15 原站盘点与后续产品调研（历史档案） |
| `scripts/` | 构建期工具（含 `generate-icons.mjs`） |

## 第三方署名

- 头像字体 [Lorelei](https://www.figma.com/community/file/1198749693280469639) — © Lisa Wischofsky, CC0 1.0
- 字体 Inter / JetBrains Mono — SIL Open Font License 1.1
- 图标 [lucide](https://lucide.dev) — ISC License
- emoji 策展数据 [gitmoji](https://gitmoji.dev) — MIT License
- 执行引擎 [pi SDK](https://github.com/badlogic/pi-mono) — MIT License

完整义务表见 `docs/spec/素材替换计划.md` §4。

## 许可

Apache-2.0 — 见 [LICENSE](./LICENSE)。

## 渊源

pacman 起步于对 todos.dev 公开界面与协议的 clean-room 研究——一次 agent-workspace 设计探索。现为独立项目，有自己的路线图，不使用 todos.dev 的任何代码或素材。
