<div align="center">
  <img src="apps/web/public/icon-512.png" alt="Cairn" width="64" height="64">
  <h1>Cairn</h1>

  <p>
    <a href="./README.md">English</a> ·
    <b>简体中文</b> ·
    <a href="https://cairn.xmon.me">官网</a> ·
    <a href="#快速开始">快速开始</a>
  </p>

  <p>
    <a href="https://github.com/xiechimon/cairn/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/xiechimon/cairn/ci.yml?branch=main&style=flat-square&label=CI"></a>
    <a href="https://www.npmjs.com/package/@xiechimon/cairn"><img alt="npm version" src="https://img.shields.io/npm/v/@xiechimon/cairn?style=flat-square&color=173a2f&label=npm"></a>
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-173a2f?style=flat-square">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-173a2f?style=flat-square">
    <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-SQLite-173a2f?style=flat-square">
  </p>

  <p><b>Cairn 是给写代码的人用的自托管个人助理：从写代码到你自己的事，你跟一个 Coordinator 说要做什么，agent 在你自己的机器上分 thread 隔离干活。</b></p>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="site/img/hero-dark.webp">
    <img alt="桌面端的 Cairn：Coordinator 对话，等你拍板的决定置顶，手机上打开着一个 thread" src="site/img/hero-light.webp" width="100%">
  </picture>

  <img alt="手机端的 Cairn：等你拍板的决定、一个 thread、项目主页和全部工作" src="site/img/phones.webp" width="100%">
</div>


- **Coordinator。** 你在任何设备上只跟一个 Coordinator 对话。它负责听、为每件活开一个 thread，并在同一个永不结束的对话里回报。
- **Thread。** 一件活对应一个 agent 会话：用你订阅的 Claude Code 或 Gemini CLI，或内置的 pi 运行时接任意模型服务。thread 从计划一路做到 PR，也可以在侧边对话里打开它直接插话。
- **只给你看需要你的事。** 首页置顶等你拍板的决定，并显示进行中的工作。只有需要人动手时才推送。
- **合并闸绑定证据。** agent 合并前，闸只认绑定到当前补丁摘要的审核结论，head 在结论之后变了就拒绝；这些规则用 TLA+ 做过模型检查。手动合并按钮目前只核对钉住的提交（见 spec 18 的 F1）。受保护路径仍然停下等你；AI 审核者能直接拦下合并，不只是留评论。
- **harness 经评测把关。** 每次构建记录基线提交和 harness 哈希，驳回写成结构化记录，改 Coordinator 调度 harness 的提交必须先过评测回归下限才能合入；提示词、技能、路由改动的配对试验采纳机制还在计划中。这里的「训练」指优化 harness，不微调模型。
- **跑在你自己的机器上。** 在任意主机上跑 daemon 就能登记成执行机。thread 会派到满足运行时、模型和工具要求的任意机器上，在独立的 git worktree 里干活；主机支持时也可以每个任务一个用完即弃的 Orb 容器（`CAIRN_EXECUTOR=orb`，目前需手动开启）。计划、diff、工具调用实时推回来。
- **项目。** 项目主页含项目说明、项目记忆、项目密钥和并发上限；人的消息永远插队。仓库可以由服务器自己托管，也可以接 GitHub。
- **自举闭环。** Cairn 自己领票、实现、审核、开 PR，正在用它自己开发它自己。
- **你自己的事（计划中）。** 邮件、日程、求职作为一个不挂仓库的项目来跑：agent 负责读、分类、起草；发邮件、投简历这类撤不回的动作，都等你点头。

## 适合谁

Cairn 是给一个人用的，不是给团队用的：你装一份自己用，别人想用就各自装一份。

适合你，如果你：

- 写代码，或者工作离不开代码，想让 agent 在后台干活，自己只拍板；
- 有一台能一直开着的机器（台式机、家里的服务器或 VPS），最好还有笔记本或手机随时跟进；
- 已经在付 Claude Code、Codex 或 Gemini 的订阅，或者有 API key，想接着用，不想再买一份算力；
- 希望代码、邮件和凭据都留在自己的机器上。

不太适合你，如果你想要：

- 团队一起用的工具，有共享频道、角色和计费（看 [Amp Spaces](https://ampcode.com/docs/spaces) 或 [Multica](https://github.com/multica-ai/multica)）；
- 只是一个更好用的界面，自己来操作 Claude Code 或 Codex（看 [T3 Code](https://github.com/pingdotgg/t3code)）；
- 住在聊天软件里的助理，比如 Telegram、WhatsApp（看 [OpenClaw](https://github.com/openclaw/openclaw) 或 [Hermes Agent](https://github.com/NousResearch/hermes-agent)）；
- 不用安装、不用维护任何东西的托管服务。

## 作品

这里只放 agent 在 Cairn 里真实做出来的东西，每个都配录屏、PR 链接和能查到出处的数字。项目还在成型，下面先占位。

| | 作品 | 会展示什么 |
|---|---|---|
| 1 | 自举闭环 | Cairn 里的 agent 从领票、实现、审核到合并，自己完成一张 Cairn 的票。*筹备中。* |
| 2 | 从零做一个应用 | 给一句需求，agent 团队在你的机器上把一个完整应用做出来。*筹备中。* |
| 3 | harness 优化前后 | 同一组任务，改了提示词、技能和路由前后的评测对比。*筹备中。* |

## 功能

- **Coordinator** — 一个永不结束的对话：开 thread、回报结果。上下文自动压缩，记忆按项目分开。
- **Thread** — 一件活对应一个 agent 会话，从计划、测试、实现走到 PR。任何 thread 都能在侧边对话里打开，直接插话。
- **项目** — 项目主页，含项目说明、项目记忆、项目密钥和并发上限；人的消息永远插队。
- **定时任务** — 按周期重跑一个 thread。
- **机器与路由** — 用 daemon 登记执行机；路由规则为每一步选运行时、模型、工具和机器。
- **模型服务** — Claude Code 与 Gemini CLI 订阅、API key、OAuth（GitHub Copilot、OpenAI Codex）或自定义端点。
- **仓库** — server 自托管 git 仓（API key 走 push/pull），或从 GitHub 接入。
- **全实时** — 对话与 thread 走 SSE 流、Web Push、按 build × 模型记账 token 用量。

## 快速开始

环境要求：Node.js 22 或 24。一条命令下载、启动并托管在 **http://127.0.0.1:8787/app**；首启在 `~/.cairn` 下自动建库并 seed 默认团队。

```sh
npx @xiechimon/cairn
```

要让 agent 在自己的机器上干活，先登记一台机器；用 Docker 跑 server 也在同一篇：[docs/getting-started.md](./docs/getting-started.md)。

## 接下来读什么

| 文档 | 内容 |
|---|---|
| [docs/getting-started.md](./docs/getting-started.md) | 跑起 server、登记机器、Docker、公网部署、从源码构建 |
| [docs/configuration.md](./docs/configuration.md) | 全部 server 与 daemon 环境变量 |
| [docs/deploy/tailscale-mobile.md](./docs/deploy/tailscale-mobile.md) | 用 Tailscale 从手机私网访问（计划内嵌 tsnet，自动在局域网、tailnet 与可选 Funnel 间选路） |
| [CONTEXT.md](./CONTEXT.md) | 领域模型与术语表 |
| [docs/spec/](./docs/spec/) | 实现规范 |

## 仓库结构

| 路径 | 内容 |
|---|---|
| `CONTEXT.md` | 领域模型与术语表（中文界面词 ↔ 英文原词 ↔ 内部名，canonical） |
| `apps/web` | Web UI，React + vite（`@cairn/web`） |
| `apps/server` | server：Hono REST + SSE + SQLite（包名 `@xiechimon/cairn`，目录名 ≠ 包名） |
| `apps/daemon` | 执行机 daemon（包名 `@xiechimon/cairn-cli`，目录名 ≠ 包名） |
| `packages/shared` | 协议词表 / 记录形状 / 品牌槽单源（`@cairn/shared`） |
| `docs/spec/` | 实现正典 00–30 册 |
| `docs/research/` | r1–r15 原站盘点与后续产品调研（历史档案） |
| `scripts/` | 构建、CI 与运维工具 |

## 社区

提问、部署求助、"cairn 里怎么做 X" 请走 [GitHub Discussions](https://github.com/xiechimon/cairn/discussions)：**Q&A** 分类问问题，**Show and tell** 分类晒你搭出来的东西。缺陷和功能需求走 [issue 追踪](https://github.com/xiechimon/cairn/issues)，维护者打上标签后才有 agent 接手。安全报告两边都不走，见 [SECURITY.md](./SECURITY.md)。

团队第一支 PR 合并后，cairn 可以显示一张可关闭的卡片，指向一条预填好的讨论帖。卡片默认关闭，cairn 自己不会打开任何页面，也不会向任何地方发送内容：是否发帖由你决定。预填内容包含哪些字段写在 [docs/privacy.md](./docs/privacy.md)。

## 第三方署名

- 头像字体 [Lorelei](https://www.figma.com/community/file/1198749693280469639) — © Lisa Wischofsky, CC0 1.0
- 字体 Instrument Sans / Source Serif 4 / JetBrains Mono — SIL Open Font License 1.1
- 图标 [lucide](https://lucide.dev) — ISC License
- emoji 策展数据 [gitmoji](https://gitmoji.dev) — MIT License
- 执行引擎 [pi SDK](https://github.com/badlogic/pi-mono) — MIT License

## 许可

Apache-2.0 — 见 [LICENSE](./LICENSE)。全部代码开源、不做功能门控；只有私有轮换的评测任务 holdout 子集不公开。贡献采用 DCO 签名（`Signed-off-by`），不要求 CLA，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
