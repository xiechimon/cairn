export type Lang = 'zh' | 'en';

const repo = 'https://github.com/xiechimon/cairn';

export const links = {
  repo,
  releases: `${repo}/releases/latest`,
  discussions: `${repo}/discussions`,
  issues: `${repo}/issues`,
  eval: `${repo}/tree/main/eval`,
  security: `${repo}/blob/main/SECURITY.md`,
  license: `${repo}/blob/main/LICENSE`,
};

export const copy = {
  zh: {
    htmlLang: 'zh-CN',
    home: '/zh-cn/',
    docs: '/zh-cn/docs/intro/',
    installHref: '/zh-cn/docs/install/',
    firstTask: '/zh-cn/docs/first-task/',
    other: { href: '/', label: 'EN', name: 'English' },
    skipToContent: '跳到正文',
    navLabel: '主导航',
    footerNavLabel: '页脚导航',
    title: 'Cairn：从你身上学，也从自己的任务里学',
    description:
      'Cairn 是开源（Apache-2.0）的 Mac 个人开发助理桌面应用，也支持服务端自托管进阶部署：在一个对话里说清目标，agent 在你自己的电脑上用你现有的模型订阅独立查资料、改代码并验证，只在要拍板时找你。',
    nav: {
      docs: '文档',
      github: 'GitHub',
      theme: '切换深浅色',
      themeToDark: '切换到深色',
      themeToLight: '切换到浅色',
    },
    h1: ['从你身上学，', '也从自己的任务里学'],
    lede: 'Cairn 是会自己变好的个人 agent：你纠正过的事会变成它之后每个对话都带着的记忆；同一个错再犯，它会提议在你的仓库里加一道检查；失败的任务会把教训交给下一次重试。',
    proof: {
      label: '「变好」怎么量',
      cases: '个固定用例',
      kinds: { runtime: 'Coordinator 回合回放', lane: '真实编码任务', canary: '哨兵用例' },
      trials: (n: number) => `每轮评测共 ${n} 次试验`,
      source: '公开题目和评分代码在仓库 eval/ 目录',
      chart: '最新一轮分组得分',
      empty: '公开评测结果暂时不可用',
      latestRun: '最新每日评测',
      stale: '这不是今天的最新结果',
      details: '逐题结果',
      shortKinds: { lane: '真实编码', runtime: '回合回放', canary: '哨兵' },
      table: {
        case: '用例',
        kind: '类型',
        passed: '通过',
        status: '状态',
        model: '模型 / 执行器',
      },
      status: {
        pass: '通过',
        partial: '部分通过',
        fail: '失败',
        incomplete: '未完成',
      },
    },
    start: '下载桌面应用',
    copy: '复制',
    copied: '已复制',
    heroAlt: 'Coordinator 对话与任务报告截图',
    how: {
      title: '说完目标就能离开电脑，关键决定才来找你',
      lede: '把背景交代清楚，剩下的调研、修改与验证在后台各自推进。',
      steps: [
        {
          title: '说清目标和标准',
          img: 'ios-home',
          alt: 'Coordinator 对话截图（手机）',
        },
        {
          title: '隔离副本里先查后改',
          img: 'work',
          alt: '任务执行过程截图',
        },
        {
          title: '只把要拍板的推给你',
          img: 'report',
          alt: '任务报告截图',
        },
      ],
    },
    points: {
      title: '为什么是 Cairn',
      items: [
        {
          title: '用你已经在付的订阅',
          body: '登录 ChatGPT / Codex、Claude Code 订阅，或任意服务商的 API key（含 Google Gemini）。不转售算力，不买第二份额度。',
        },
        {
          title: '代码和密钥留在本地',
          body: '每项任务都在你这台主机各自独立的 git worktree 副本里改代码、跑测试，源码与访问凭证不出你自己的机器。',
        },
        {
          title: '只在要你定夺时打断你',
          body: '常规实现自动按规范推进；遇到架构选择或待审批结果直接置顶到列表顶部，非你确认不可时才推送通知。',
        },
        {
          title: '撤不回的事，先停下来问你',
          body: '删数据、付款、改凭证、推送远端或对外发布前一律先征求明确同意，不越界操作。',
        },
        {
          title: '电脑派活，手机随时拍板',
          body: '同一个对话实时同步到手机端；通过 Tailscale 走加密私有访问，不用把服务端端口暴露到公网。',
        },
        {
          title: '个人事务也能托管',
          tag: '规划中',
          body: '邮件、日程与求职材料可建为无代码仓库的项目：agent 先读取、归类并起草，发送和提交仍由你点确认。',
        },
      ],
    },
    fit: {
      title: '适合谁',
      yesTitle: '适合你，如果你',
      yes: [
        '写代码或配合代码工作，希望把调研、改代码、跑测试交给后台，自己只负责拍板；',
        '手边有一台可常开的桌面端、家里的主机或 VPS，出门时偶尔用手机跟进结果；',
        '已经在付 ChatGPT / Claude Code 订阅或握有 API key，想接着用现有额度而不是再买一份云算力；',
        '在意源码、邮件和各类密钥必须留在自己的硬件上。',
      ],
      noTitle: '不适合你，如果你想要',
      no: [
        { text: '供多人协作的团队版，带共享频道、角色权限与统一账单', alt: 'Amp Spaces', href: 'https://ampcode.com/docs/spaces' },
        { text: '单纯给本地 CLI 换层更顺手的图形外壳、自己全程盯着敲每一步', alt: 'T3 Code', href: 'https://github.com/pingdotgg/t3code' },
        { text: '把入口完全安在 Telegram、WhatsApp 等聊天软件里的轻量机器人', alt: 'OpenClaw', href: 'https://github.com/openclaw/openclaw' },
        { text: '现阶段零安装、开箱即用的纯云端托管服务', alt: null, href: null },
      ],
      altPrefix: '可以看看',
    },
    selling: {
      title: '“那你们卖什么？”',
      body: '目前什么都不卖。全部代码基于 Apache-2.0 开源且无功能分级；仅评测题库中极小一部分私有轮换留出集不公开。当前不提供托管服务也不转售算力，后续计划推出省心官方托管版 Cairn Cloud，但自建运行始终免费且功能完整。',
    },
    install: {
      title: '下载应用，三分钟跑起第一件事',
      lede: 'macOS、Windows、Linux 桌面端已内置本地服务与执行器，打开安装包即可直接用，无需安装 Node.js 或敲命令行。无界面服务器也支持 npm 自建。',
      steps: [
        {
          title: '下载桌面应用（或跑命令行服务端）',
          body: '从 GitHub Releases 下载桌面端安装包（支持 macOS Apple Silicon / Intel、Windows、Linux），打开即自动启动并完成登录；无图形界面的服务器再用下面一行命令启动。',
          code: 'npx @xiechimon/cairn',
        },
        {
          title: '连接你现有的模型订阅',
          body: '打开应用进入「接入模型」，选 ChatGPT 订阅并用浏览器设备码登录（免配额外 Codex CLI），或接入 Claude Code 订阅与任意 API key，核对默认 Coordinator 模型。',
          code: null,
        },
        {
          title: '选定本机项目，派第一件真实任务',
          body: '选中硬盘上的本地代码目录，在主对话交代第一个小目标；如果还要把多台常开主机挂进同一个 Cairn，可在那台机器跑下面命令行节点。',
          code: 'npm i -g @xiechimon/cairn-cli\ncairn start',
        },
      ],
      more: '下载桌面应用',
      first: '完整安装与服务器文档',
    },
    footer: {
      tagline: 'Cairn 由 Cairn 自己开发。',
      docs: '文档',
      discussions: '讨论区',
      issues: '问题反馈',
      security: '安全',
      license: 'Apache-2.0',
    },
  },
  en: {
    htmlLang: 'en',
    home: '/',
    docs: '/docs/intro/',
    installHref: '/docs/install/',
    firstTask: '/docs/first-task/',
    other: { href: '/zh-cn/', label: '中文', name: '简体中文' },
    skipToContent: 'Skip to content',
    navLabel: 'Primary',
    footerNavLabel: 'Footer',
    title: 'Cairn: Learns from you, and from its own runs.',
    description:
      'Cairn is an open-source (Apache-2.0) Mac desktop app and personal coding assistant, with an advanced self-hosted server path. Describe what you want in one conversation; agents research, build, and verify on your own hardware with your own subscriptions.',
    nav: {
      docs: 'Docs',
      github: 'GitHub',
      theme: 'Toggle theme',
      themeToDark: 'Switch to dark theme',
      themeToLight: 'Switch to light theme',
    },
    h1: ['Learns from you, ', 'and from its own runs.'],
    lede: 'Cairn is a self-improving personal agent. What you correct becomes memory it brings to every later conversation; when a mistake repeats, it offers to add a check to your repo; a failed run hands its lessons to the retry.',
    proof: {
      label: 'How “better” is measured',
      cases: 'fixed cases',
      kinds: { runtime: 'Coordinator turns replayed', lane: 'real coding tasks', canary: 'canaries' },
      trials: (n: number) => `${n} trials per eval run`,
      source: 'Public tasks and scorers live in eval/',
      chart: 'Latest run by task type',
      empty: 'Public eval results are unavailable',
      latestRun: 'Latest daily eval',
      stale: 'This snapshot may be stale',
      details: 'Per-case results',
      shortKinds: { lane: 'Real coding', runtime: 'Runtime', canary: 'Canaries' },
      table: {
        case: 'Case',
        kind: 'Type',
        passed: 'Passed',
        status: 'Status',
        model: 'Model / executor',
      },
      status: {
        pass: 'Pass',
        partial: 'Partial',
        fail: 'Fail',
        incomplete: 'Incomplete',
      },
    },
    start: 'Download desktop app',
    copy: 'Copy',
    copied: 'Copied',
    heroAlt: 'Coordinator conversation and thread report screenshot',
    how: {
      title: 'Say what you want, step away, decide what matters',
      lede: 'Give clear context once; research, implementation, and verification run in parallel behind the scenes.',
      steps: [
        {
          title: 'Describe the goal',
          img: 'ios-home',
          alt: 'Coordinator conversation screenshot (mobile)',
        },
        {
          title: 'Research and build in isolation',
          img: 'work',
          alt: 'Thread work trace screenshot',
        },
        {
          title: 'Only real decisions reach you',
          img: 'report',
          alt: 'Thread report screenshot',
        },
      ],
    },
    points: {
      title: 'Why Cairn',
      items: [
        {
          title: 'Use the subscriptions you already pay for',
          body: 'Sign in with ChatGPT / Codex, Claude Code, or an API key from any provider (Google Gemini included). Cairn never resells compute.',
        },
        {
          title: 'Code and keys stay on your machines',
          body: 'Each task edits and verifies inside an isolated git worktree on your own host. Source code and credentials never leave your hardware.',
        },
        {
          title: 'Interruptions reserved for real choices',
          body: 'Routine engineering details follow repo conventions automatically; genuine architecture calls rise to the top of your inbox.',
        },
        {
          title: 'Nothing irreversible without approval',
          body: 'Deletes, payments, credential changes, and public pushes stop and wait for your explicit sign-off every time.',
        },
        {
          title: 'Start at your desk, decide from your phone',
          body: 'The same conversation stays live on mobile over private Tailscale access with no public ports exposed.',
        },
        {
          title: 'Non-code personal affairs too',
          tag: 'Planned',
          body: 'Track mail, scheduling, or job searches as projects without a git repo: agents sort and draft, while sending waits for you.',
        },
      ],
    },
    fit: {
      title: 'Who it is for',
      yesTitle: 'It fits you if you',
      yes: [
        'write or ship alongside code and want background execution while keeping final architecture calls;',
        'run an always-on Mac, desktop, home server, or VPS and want to check in from a laptop or phone;',
        'already subscribe to ChatGPT / Claude Code or keep API keys instead of paying another cloud markup;',
        'want source code, mail, and secrets stored strictly on your own machines.',
      ],
      noTitle: 'It is not the right fit if you want',
      no: [
        { text: 'a shared multiplayer team workspace with channels, roles, and pooled billing', alt: 'Amp Spaces', href: 'https://ampcode.com/docs/spaces' },
        { text: 'only a thin GUI wrapper where you micromanage every single CLI prompt', alt: 'T3 Code', href: 'https://github.com/pingdotgg/t3code' },
        { text: 'an assistant living entirely inside Telegram or WhatsApp chats', alt: 'OpenClaw', href: 'https://github.com/openclaw/openclaw' },
        { text: 'today, a zero-install hosted SaaS managed on vendor clouds', alt: null, href: null },
      ],
      altPrefix: 'Try',
    },
    selling: {
      title: '“Wait, what are you selling?”',
      body: 'Today, nothing. Everything is Apache-2.0 with zero feature gating; only a small rotating holdout slice of eval tasks remains private. A hosted option (Cairn Cloud) is planned for convenience later, while self-hosting stays complete and free forever.',
    },
    install: {
      title: 'Download the app, ship your first task in minutes',
      lede: 'The macOS, Windows, and Linux desktop apps bundle the local server and runner — no Node.js or terminal setup needed. Headless servers can still self-host via npm.',
      steps: [
        {
          title: 'Download the desktop app (or run headless)',
          body: 'Grab the native installer from GitHub Releases (macOS Apple Silicon / Intel, Windows, Linux) — opening the app starts the server and runner automatically. Use the command below only for headless servers:',
          code: 'npx @xiechimon/cairn',
        },
        {
          title: 'Connect your subscriptions',
          body: 'Open Connect models inside the app, authorize ChatGPT via browser device code (no external Codex CLI needed), link Claude Code, or add your own API key.',
          code: null,
        },
        {
          title: 'Pick a local project and ask away',
          body: 'Point Cairn at a folder on disk and describe your first goal. Attach extra always-on machines later with one CLI node:',
          code: 'npm i -g @xiechimon/cairn-cli\ncairn start',
        },
      ],
      more: 'Download desktop app',
      first: 'Install & server docs',
    },
    footer: {
      tagline: 'Cairn is built with Cairn.',
      docs: 'Docs',
      discussions: 'Discussions',
      issues: 'Issues',
      security: 'Security',
      license: 'Apache-2.0',
    },
  },
} as const;
