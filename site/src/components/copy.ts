export type Lang = 'zh' | 'en';

const repo = 'https://github.com/xiechimon/cairn';

export const links = {
  repo,
  discussions: `${repo}/discussions`,
  issues: `${repo}/issues`,
  security: `${repo}/blob/main/SECURITY.md`,
  license: `${repo}/blob/main/LICENSE`,
};

export const copy = {
  zh: {
    htmlLang: 'zh-CN',
    home: '/zh-cn/',
    docs: '/zh-cn/docs/intro/',
    install: '/zh-cn/docs/install/',
    firstTask: '/zh-cn/docs/first-task/',
    other: { href: '/', label: 'EN', name: 'English' },
    title: 'Cairn：写代码的人的私人助理，跑在你自己的机器上',
    description:
      'Cairn 是开源（Apache-2.0）、自托管的私人助理，给写代码的人用：在一个对话里说要做什么，agent 用你自己的机器和模型订阅去做。用 npx @xiechimon/cairn 安装。',
    nav: { docs: '文档', github: 'GitHub', theme: '切换深浅色' },
    h1: ['写代码的人的私人助理，', '跑在你自己的机器上'],
    lede: '在一个对话里说要做什么，agent 用你自己的订阅去做。',
    start: '开始上手',
    copy: '复制',
    copied: '已复制',
    heroAlt:
      'Cairn 桌面端：左边 Coordinator 对话里有两件事和它们开出的 thread，右边一个 thread 的报告停在等你决定；旁边是同一个对话在手机上',
    how: {
      title: '一句话进去，一个决定出来',
      lede: '你定要什么和架构，其余的交给 thread。',
      steps: [
        {
          title: '说一句要什么',
          img: 'ios-home',
          alt: '手机上的 Coordinator 对话：两个请求、它们开出的 thread，和一个带三个选项的问题',
        },
        {
          title: '它先研究，再动手',
          img: 'work',
          alt: '一个 thread 在干活：读了三份实现，改了一个文件，跑了测试',
        },
        {
          title: '你只定要你定的',
          img: 'report',
          alt: '一份 thread 报告，最后是“我已自行决定”和“需要你定的”',
        },
      ],
    },
    points: {
      title: '为什么是 Cairn',
      items: [
        {
          title: '用你自己的订阅',
          body: 'Claude Code、Codex，或任何服务商的 API key（包括 Google 的 Gemini）。Cairn 不转售算力。',
        },
        {
          title: '你的机器，你的数据',
          body: '每台机器跑一个 Runner，thread 直接在这台主机上各自的 git worktree 里干活。代码和凭证留在你自己的机器上。',
        },
        {
          title: '只把要你的事交给你',
          body: '首页置顶等你拍板的事；只有非你动手不可时才推送通知。',
        },
        {
          title: '撤不回的事，先问你',
          body: '比如删数据、付费、改凭证、对外发布。',
        },
        {
          title: '电脑上开始，手机上拍板',
          body: '同一个对话在手机上也能看、能回。通过 Tailscale 私有访问，不用把服务暴露到公网。',
        },
        {
          title: '你自己的事',
          tag: '规划中',
          body: '邮件、日程、求职作为一个没有仓库的项目：agent 读、整理、起草；发送和提交等你。',
        },
      ],
    },
    fit: {
      title: '适合谁',
      yesTitle: '适合你，如果你',
      yes: [
        '写代码，或者跟代码一起工作，想让 agent 在后台干活、自己只拍板；',
        '有一台能一直开着的机器：台式机、家里的服务器或 VPS，最好再有笔记本或手机跟进；',
        '已经在付 Claude Code 或 Codex 的订阅，或者有 API key，想接着用而不是再买一份算力；',
        '希望代码、邮件和凭证留在自己的机器上。',
      ],
      noTitle: '不适合你，如果你想要',
      no: [
        { text: '给团队共用的工具，有共享频道、角色和账单', alt: 'Amp Spaces', href: 'https://ampcode.com/docs/spaces' },
        { text: '只是更好用的界面，自己驱动 Claude Code 或 Codex', alt: 'T3 Code', href: 'https://github.com/pingdotgg/t3code' },
        { text: '把家安在聊天软件里的助理，比如 Telegram、WhatsApp', alt: 'OpenClaw', href: 'https://github.com/openclaw/openclaw' },
        { text: '托管服务，什么都不用装、不用维护', alt: null, href: null },
      ],
      altPrefix: '可以看看',
    },
    selling: {
      title: '“那你们卖什么？”',
      body: '什么都不卖。全部代码 Apache-2.0，没有功能分级；只有评测任务集里一个私有、轮换的留出子集不公开。没有托管的控制面，也不转售算力：Cairn 跑在你的机器上，用你的订阅。',
    },
    install: {
      title: '三步跑起来',
      lede: '需要 Node.js 22 或 24。下面是最短路径，每一步的细节都在文档里。',
      steps: [
        {
          title: '启动服务',
          body: '下载并在本机启动，打开 127.0.0.1:8787/app。数据放在 ~/.cairn。',
          code: 'npx @xiechimon/cairn',
        },
        {
          title: '连接一台 Runner',
          body: '在要干活的机器上装 CLI 并启动，按终端里给的链接在浏览器里批准这台机器。',
          code: 'npm i -g @xiechimon/cairn-cli\ncairn start',
        },
        {
          title: '接入模型，说第一件事',
          body: '在接入模型里选 ChatGPT 订阅，按设备码在浏览器登录；不用另装 Codex CLI。在确认设置里核对 Coordinator 模型（全新仅连接 ChatGPT 订阅时为 GPT-6.1 Sol，任务默认复用该模型并用 pi 执行），再建本地项目，说第一件事。也可用自己的 API key。',
          code: null,
        },
      ],
      more: '完整安装步骤',
      first: '第一个任务怎么跑',
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
    install: '/docs/install/',
    firstTask: '/docs/first-task/',
    other: { href: '/zh-cn/', label: '中文', name: '简体中文' },
    title: 'Cairn: a personal assistant for people who write code, on your own machines',
    description:
      'Cairn is an open-source (Apache-2.0), self-hosted personal assistant for people who write code. Say what you want in one conversation; agents do it on your own machines with your own model subscriptions. Install with npx @xiechimon/cairn.',
    nav: { docs: 'Docs', github: 'GitHub', theme: 'Toggle theme' },
    h1: ['A personal assistant for people who write code, ', 'on your own machines'],
    lede: 'Say what you want in one conversation; agents do it with your own subscriptions.',
    start: 'Get started',
    copy: 'Copy',
    copied: 'Copied',
    heroAlt:
      'Cairn on a desktop: the Coordinator conversation with two requests and the threads they started, a thread report waiting on a decision at the right, and the same conversation on a phone',
    how: {
      title: 'One sentence in, one decision out',
      lede: 'You decide what you want and the architecture. The thread does the rest.',
      steps: [
        {
          title: 'Say what you want',
          img: 'ios-home',
          alt: 'The Coordinator conversation on a phone: two requests, the threads they started and a question with three options',
        },
        {
          title: 'It researches, then builds',
          img: 'work',
          alt: 'A thread at work: it read three implementations, edited one file and ran the tests',
        },
        {
          title: 'You decide what is yours',
          img: 'report',
          alt: 'A thread report ending with Decided myself and Needs your decision',
        },
      ],
    },
    points: {
      title: 'Why Cairn',
      items: [
        {
          title: 'Your own subscriptions',
          body: "Claude Code, Codex, or an API key from any provider, Google's Gemini included. Cairn never resells compute.",
        },
        {
          title: 'Your machines, your data',
          body: 'Each machine runs a Runner. Threads work directly on that host in their own git worktree. Code and credentials stay on your machines.',
        },
        {
          title: 'Only what needs you',
          body: 'The home page pins the decisions waiting on you, and a push goes out only when you must act.',
        },
        {
          title: 'It asks before anything irreversible',
          body: 'For example: deleting data, paying, changing credentials, publishing.',
        },
        {
          title: 'Start at your desk, decide from your phone',
          body: 'Follow and answer the same conversation on your phone, over private Tailscale access instead of a public address.',
        },
        {
          title: 'Your own affairs',
          tag: 'Planned',
          body: 'Mail, calendar and job search as a project with no repository: agents read, sort and draft; sending and submitting wait for you.',
        },
      ],
    },
    fit: {
      title: 'Who it is for',
      yesTitle: 'It fits you if you',
      yes: [
        'write code, or work alongside code, and want agents to work in the background while you only make the calls;',
        'have a machine that can stay on, such as a desktop, a home server or a VPS, and ideally a laptop or a phone to follow along from;',
        'already pay for Claude Code or Codex, or have an API key, and want to keep using them rather than buy compute again;',
        'want your code, mail and credentials to stay on your own machines.',
      ],
      noTitle: 'It is not the right fit if you want',
      no: [
        { text: 'a tool a team shares, with shared channels, roles and billing', alt: 'Amp Spaces', href: 'https://ampcode.com/docs/spaces' },
        { text: 'only a better interface for driving Claude Code or Codex yourself', alt: 'T3 Code', href: 'https://github.com/pingdotgg/t3code' },
        { text: 'an assistant whose home is a chat app, such as Telegram or WhatsApp', alt: 'OpenClaw', href: 'https://github.com/openclaw/openclaw' },
        { text: 'a hosted service with nothing to install or keep running', alt: null, href: null },
      ],
      altPrefix: 'Try',
    },
    selling: {
      title: '“Wait, what are you selling?”',
      body: 'Nothing. All code is Apache-2.0 with no feature gating; only a private, rotating holdout subset of the eval task set stays unpublished. There is no hosted control plane and no resold compute: Cairn runs on your machines with your subscriptions.',
    },
    install: {
      title: 'Running in three steps',
      lede: 'Needs Node.js 22 or 24. This is the shortest path; the docs cover every step in detail.',
      steps: [
        {
          title: 'Start the server',
          body: 'Downloads Cairn and serves it at 127.0.0.1:8787/app. Data lives in ~/.cairn.',
          code: 'npx @xiechimon/cairn',
        },
        {
          title: 'Connect a Runner',
          body: 'On the machine that should do the work, install the CLI and start it, then approve the machine at the link it prints.',
          code: 'npm i -g @xiechimon/cairn-cli\ncairn start',
        },
        {
          title: 'Connect a model, say the first thing',
          body: 'Choose ChatGPT subscription in Connect models and sign in with its device code; no Codex CLI is needed. Confirm the Coordinator model (GPT-6.1 Sol for a fresh ChatGPT-only setup; tasks use it by default through pi), then create a local project and ask for your first change. Your own API key works too.',
          code: null,
        },
      ],
      more: 'Full install guide',
      first: 'Run your first task',
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
