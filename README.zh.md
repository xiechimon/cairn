<div align="center">
  <img src="apps/web/public/icon-512.png" alt="Cairn" width="64" height="64">
  <h1>Cairn</h1>

  <p><b>给写代码的人用的自托管个人助理。</b></p>

  <p>
    <a href="https://cairn.xmon.me">官网</a> ·
    <a href="./docs/getting-started.md">文档</a> ·
    <a href="https://github.com/xiechimon/cairn/discussions">Discussions</a> ·
    <b>简体中文</b> | <a href="./README.md">English</a>
  </p>

  <p>
    <a href="https://github.com/xiechimon/cairn/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/xiechimon/cairn/ci.yml?branch=main&style=flat-square&label=CI"></a>
    <a href="https://www.npmjs.com/package/@xiechimon/cairn"><img alt="npm version" src="https://img.shields.io/npm/v/@xiechimon/cairn?style=flat-square&color=173a2f&label=npm"></a>
    <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-173a2f?style=flat-square">
    <img alt="Self-hosted" src="https://img.shields.io/badge/self--hosted-SQLite-173a2f?style=flat-square">
  </p>

  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/hero-zh-dark.webp">
    <img alt="MacBook 上装成网页 app 的 Cairn，开着一个 thread 的报告和 Coordinator 对话" src="docs/assets/readme/hero-zh-light.webp" width="100%">
  </picture>
</div>

从写代码到你自己的事，你跟一个 Coordinator 说要做什么。它在你自己的机器上为每件活开一个 thread，只有需要你拍板时才找你。在桌前开始的活，在手机上接着拍板。

## 你会得到什么

- **用你自己的订阅。** Claude Code、Codex，或任意服务商的 API key（包括 Google 的 Gemini）。Cairn 目前不转售算力。
- **先研究，再动手。** thread 改东西之前，先看几个强的开源项目是怎么解决的，细节自己定。
- **只在需要你时打扰。** 首页只置顶等你拍板的事，推送也只发需要你动手的事。
- **结果可信。** agent 合并前，合并闸只认绑定当前补丁的审核结论。撤不回的动作都等你点头。
- **你的机器，你的数据。** 每台机器跑一个 daemon，thread 直接在这台主机上各自的 git worktree 里干活。代码和凭据留在你自己的机器上。
- **你自己的事（计划中）。** 邮件、日程、求职作为一个不挂仓库的项目：agent 负责读、分类、起草；发出去、投出去都等你。

<table>
  <tr>
    <td width="33%"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/board-dark.png">
    <img alt="Mac 上的 Cairn 工作台：任务按待开始、执行中、待处理、已完成分列" src="docs/assets/readme/board-light.png" width="100%">
  </picture></td>
    <td width="33%"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/work-zh-dark.webp">
    <img alt="干活中的 thread：读了三个实现、改了一个文件、跑了测试" src="docs/assets/readme/work-zh-light.webp" width="100%">
  </picture></td>
    <td width="33%"><img src="docs/assets/readme/shot-merge.svg" alt="截图待补：PR 和合并闸的结论"></td>
  </tr>
  <tr>
    <td>说一句，在手机上拍板</td>
    <td>旁观或插话指挥 thread</td>
    <td>合并闸决定能不能合</td>
  </tr>
</table>

## 它自己查、自己定

需求和架构由你定，其余交给 thread：

1. **先看别人怎么做。** 找两三个强的开源实现，读源码而不是只看 README，再做比较。
2. **细节自己定。** 用哪个库、文件怎么放、怎么命名、怎么测，都由它决定，除非你的规则写了要先问。
3. **报告分两栏。** 每份报告最后都有「我已自行决定」，每一项附理由；还有「需要你定的」，最多三项，每项附选项、证据和推荐。

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/report-zh-dark.webp">
    <img alt="thread 报告最后的「我已自行决定」和「需要你定的」" src="docs/assets/readme/report-zh-light.webp" width="360">
  </picture>
</p>

## 看它干活

<img src="docs/assets/readme/demo-video.svg" alt="视频待补：约 90 秒，从手机上的一句需求到合并的 PR" width="100%">

## 安装

**Mac 上**，从[最新发布](https://github.com/xiechimon/cairn/releases/latest)下载 Cairn for Mac：Apple 芯片选 `-arm64.dmg`，Intel 选 `-x64.dmg`。把 Cairn 拖进“应用程序”再打开。应用还没做公证，第一次打开会被 macOS 拦下：打开“系统设置”里的“隐私与安全性”，在 Cairn 旁边点**仍要打开**（macOS 14 及更早：在“应用程序”里右键 Cairn，选“打开”）。应用会在这台 Mac 上跑 Cairn 和一个执行机，并自动登录。

内置 Runner 自带 **pi**，可以用你的 Codex 订阅或服务商 API key 跑任务，不需要另装 pi 或 Codex CLI。Claude Code 是可选的独立运行时，不是安装前提。

**Linux 上**可以用下面的 npm 服务端和 Runner，也可以[从源码构建 Linux x64 桌面归档](./apps/desktop/README.md#linux-x64-archive)。目前没有公开提供的 Linux 桌面安装包或自动更新。归档需要图形会话和 Git；它和 Mac 应用一样会自带服务端、Runner 并自动登录本机。

**用 npm 跑服务端或增加 Runner**，需要 Node.js 22.19+（22 或 24 LTS）和 Git：

```sh
npx @xiechimon/cairn
```

这会在 **<http://127.0.0.1:8787/app>** 提供 Cairn，并在 `~/.cairn` 下建库。然后在每台要让 agent 干活的机器上：

```sh
npm i -g @xiechimon/cairn-cli
cairn start --server http://127.0.0.1:8787
```

它会打印一个链接；在打开着 Cairn 的浏览器里打开它，批准这台机器。执行机在别的机器上时，换成你 server 的地址。Linux 上如果想在注销或重启后保持常驻，见[上手指南](./docs/getting-started.md#keep-the-daemon-running-on-linux)。在 macOS 和 Windows 上用 npm 跑 server 时，浏览器暂时不能批准这台机器、也不能添加服务商，这些要用 owner token 来做，见[上手指南](./docs/getting-started.md#run-the-server)。

### 接上模型，拿到第一个结果

1. 在 **接入模型（Connect models）** 里选 **ChatGPT 订阅**。在浏览器打开页面给出的设备登录链接，登录你自己的 OpenAI 账户并输入设备码；保持 Cairn 打开，等授权完成。这是在 Cairn 内接入订阅，不用先执行 `codex login`。也可以添加自己的服务商 API key 或自定义端点。以后在 **设置 → 模型**（**服务商** 区域）管理连接。
2. 到 **确认设置（Confirm settings）**，核对 **Coordinator** 的模型（任务默认使用 Coordinator 的模型），再点 **确认并开始对话**。全新安装且只连接 ChatGPT 订阅时，显示 **GPT-6.1 Sol**，任务用 **pi** 执行。其他连接或已保存规则可能改变选择，以确认页为准，不存在所有安装都相同的默认模型。
3. 在 **设置 → 执行机** 确认有一台执行机在线（桌面应用会自动启动并批准内置执行机）。
4. 点 **新建项目 → 选择仓库 → 本地文件夹**，选 Runner 上一个已初始化的小 Git 仓库，无需连接 GitHub。比如说「把 README 标题改成 Hello，不推送、不合并」。打开 **任务** 查看改动和测试结果；完成后保留在任务分支，等你要求才合并。[首个任务步骤与一次性测试仓库](./site/src/content/docs/zh-cn/docs/first-task.mdx)。

如果要用可选的 Claude Code 任务，在各 Runner 安装 `claude`，并把 `claude setup-token` 得到的订阅令牌添加到 **设置 → 模型**；只在 CLI 登录并不等于给 Cairn 提供任务订阅。只有接入并启用 Devin 订阅后，Runner 才下载 Devin。更多见[模型连接说明](./site/src/content/docs/zh-cn/docs/models.mdx)。手机跟进见[用 Tailscale 私网访问](./docs/deploy/tailscale-mobile.md)。用 Docker 跑服务端以及从源码构建见[上手指南](./docs/getting-started.md)。

## 「等等，你们卖什么？」

目前什么都不卖。全部代码 Apache-2.0 开源，不做功能门控；只有私有轮换的评测任务 holdout 子集不公开。目前没有托管服务，也不转售算力：Cairn 跑在你的机器上，用你的订阅。

方向：计划推出官方付费托管服务 Cairn Cloud，现在还不能用。自托管保持免费、功能完整。

## 适合谁

Cairn 是给一个人用的，不是给团队用的：你装一份自己用，别人想用就各自装一份。

适合你，如果你：

- 写代码，或者工作离不开代码，想让 agent 在后台干活，自己只拍板；
- 有一台能一直开着的机器（台式机、家里的服务器或 VPS），最好还有笔记本或手机随时跟进；
- 已经在付 Claude Code 或 Codex 的订阅，或者有 API key，想接着用，不想再买一份算力；
- 希望代码、邮件和凭据都留在自己的机器上。

不太适合你，如果你想要：

- 团队一起用的工具，有共享频道、角色和计费（看 [Amp Spaces](https://ampcode.com/docs/spaces) 或 [Multica](https://github.com/multica-ai/multica)）；
- 只是一个更好用的界面，自己来操作 Claude Code 或 Codex（看 [T3 Code](https://github.com/pingdotgg/t3code)）；
- 把家安在聊天软件里的助理，比如 Telegram、WhatsApp（看 [OpenClaw](https://github.com/openclaw/openclaw) 或 [Hermes Agent](https://github.com/NousResearch/hermes-agent)）——cairn 把聊天软件当入口，不当住所；
- 现在就要一个不用安装、不用维护任何东西的托管服务。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/getting-started.md](./docs/getting-started.md) | 跑起 server、登记机器、Docker、公网部署、从源码构建 |
| [docs/configuration.md](./docs/configuration.md) | 全部 server 与 daemon 环境变量 |
| [docs/deploy/tailscale-mobile.md](./docs/deploy/tailscale-mobile.md) | 用 Tailscale 从手机私网访问 |
| [CONTEXT.md](./CONTEXT.md) | 领域模型与术语表 |
| [docs/spec/](./docs/spec/) | 实现规范 |

<details>
<summary>仓库结构</summary>

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

</details>

## 社区

提问、部署求助、"cairn 里怎么做 X" 请走 [GitHub Discussions](https://github.com/xiechimon/cairn/discussions)：**Q&A** 分类问问题，**Show and tell** 分类晒你搭出来的东西。缺陷和功能需求走 [issue 追踪](https://github.com/xiechimon/cairn/issues)，维护者打上标签后才有 agent 接手。安全报告两边都不走，见 [SECURITY.md](./SECURITY.md)。Cairn 正在用它自己开发它自己：里面的 agent 领 Cairn 自己的票、开 PR。

关于 Cairn 本地保存哪些数据，以及你配置的集成或可选服务会发送什么内容，见 [docs/privacy.md](./docs/privacy.md)。

## 致谢

Cairn 借鉴了下面这些产品：我们读过它们的源码或文档，也亲手用过。没有复制它们的代码；随 Cairn 一起分发的代码和素材列在「第三方署名」里。

- [Amp](https://ampcode.com)：thread、Spaces、跨机器的 runner，以及先看别人怎么做再决定。
- [T3 Code](https://github.com/pingdotgg/t3code)：从任何设备跟进工作，断线后干净地重连。
- [Multica](https://github.com/multica-ai/multica)：一台机器跑一个 agent CLI 的运行时模型。
- [todos.dev](https://todos.dev)：把计划和审核当成任务里的停靠点。
- [Claude Code](https://claude.com/product/claude-code)、[Codex](https://github.com/openai/codex) 和 [pi](https://github.com/badlogic/pi-mono)：thread 实际运行用的引擎。

## 第三方署名

- 头像字体 [Lorelei](https://www.figma.com/community/file/1198749693280469639) — © Lisa Wischofsky, CC0 1.0
- 字体 Instrument Sans / Source Serif 4 / JetBrains Mono — SIL Open Font License 1.1
- 图标 [lucide](https://lucide.dev) — ISC License
- emoji 策展数据 [gitmoji](https://gitmoji.dev) — MIT License
- 执行引擎 [pi SDK](https://github.com/badlogic/pi-mono) — MIT License

## 许可

Apache-2.0 — 见 [LICENSE](./LICENSE)。贡献采用 DCO 签名（`Signed-off-by`），不要求 CLA，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
