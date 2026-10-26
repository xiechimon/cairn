// en fallback dictionary (issue #74, 01-stack-v2 S6): the workspace is
// zh-CN authoritative, so the zh source string is the key and this flat
// table is the only en layer — no framework, no namespaces. The official
// en workspace was never observed (r2 §11 Q19), so every value here is
// [设计]; domain nouns follow the CONTEXT.md canonical glossary (任务 Todo,
// 运行 Build, 方案 Plan, 总管 Chief, 定时 Schedule, 模型服务 Provider,
// 密钥 Secret, 机器 Machine, 技能 Skill, Token 用量 Token usage …).
// One zh key = one en value; where a word serves several surfaces (任务 as
// nav row and as popover section) the single best fit is noted inline.
// Discipline: zh renders never touch this file (translate() identity), so
// the e2e suite stays the zh regression gate; coverage of the en side
// is gated by test/i18n-coverage.test.ts.
//
// Fixture-carried chrome: a handful of system-generated labels (streaming
// status, plan-card title, chief thread chip, resource type/pill words)
// reach components through fixture records as capture-verbatim strings.
// They key by exact value here and render through t() like any chrome —
// user/agent content (todo titles, bubbles, docs) never enters the dict
// and falls back to the zh original, exactly like the real app would.

import { PROBE_TOOL_CALL_LABEL, PROBE_TOOL_PILLS } from '../fixtures/fixtures.js';

export const EN: Record<string, string> = {
  // —— shared chrome / sidebar (r2 §1.1) ——
  搜索: 'Search',
  // #351 看板更名工作台：'Workbench'（不用 'Workspace'，避撞 daemon workspaces 概念）
  工作台: 'Workbench',
  // Paper 顶栏等你处理摘要：数字单独着色，后接本串（「3 项等你处理」→「3 waiting on you」）
  项等你处理: 'waiting on you',
  没有等你处理的事: 'Nothing is waiting on you',
  定时: 'Schedules',
  需要我处理: 'Needs me',
  '{n} 台机器在线': '{n} machines online',
  '执行中 {n}': '{n} running',
  项目: 'Project', // sidebar group / search group / schedule-form field — one fit
  资源: 'Resources',
  新建项目: 'New project',
  新任务: 'New task', // sidebar action row (#389) — the dialog title stays 新建任务
  '新任务：接下来让 agent 做什么？': 'New task: What should the agent do next?',
  等你处理: 'Waiting on you',
  查看全部: 'View all',
  '上次查看后：{done} 个完成，{failed} 个新失败':
    '{done} completed, {failed} new failures since last visit',
  技能: 'Skills',
  密钥: 'Secrets',
  机器: 'Machines',
  模型服务: 'Providers',
  用量: 'Usage',
  收起侧边栏: 'Collapse sidebar',
  展开侧边栏: 'Expand sidebar',
  '收起{label}': 'Collapse {label}',
  '展开{label}': 'Expand {label}',
  总管: 'Chief',
  '{n} 个总管会话有未读': '{n} chief sessions have unread',
  条新消息: 'new messages',
  '思考中…': 'Thinking…',
  返回: 'Back',
  更多: 'More',
  关闭: 'Close',
  最小化: 'Minimize',
  滚动到最新: 'Scroll to latest',
  取消: 'Cancel',
  保存: 'Save',
  删除: 'Delete',
  今天: 'today',

  // —— board surface (r2 §4.1, r7 01/02; #351 6→4 列收敛) ——
  任务: 'Todo', // topbar +任务 button / search nav row / popover section
  待开始: 'To start',
  // 规划中 survives as the planning phase chip (detail header), not a column
  规划中: 'Planning',
  执行中: 'Running',
  已完成: 'Done',
  暂无: 'None',
  写下想做的事: 'Write down what you want done',
  还没有待开始的任务: 'Nothing waiting to start',
  没有在跑的任务: 'Nothing running',
  '最近 7 天还没有完成的任务': 'Nothing finished in the last 7 days',
  // Paper card footer (DESIGN.md 任务卡): needs-you state flag + action link
  待确认: 'Plan to confirm',
  确认计划: 'Confirm plan',
  待审阅: 'Ready for review',
  审阅: 'Review',
  待回复: 'Waiting on you',
  '最近 7 天': 'Last 7 days',
  回复: 'Reply',
  '分支与 PR': 'Branch & PR',
  方案: 'Plan',
  变更: 'Changes',
  // 看板顶部通知引导条 (issue #114): components consume the shared
  // NOTIFICATION_BANNER_COPY canon — these keys match its zh values
  // verbatim (i18n-coverage liveness via COMPUTED_KEYS)
  浏览器通知未开启: 'Browser notifications are off',
  '标签页切换到后台时，通过桌面通知提醒你。':
    'Get a desktop reminder when this tab is in the background.',
  开启: 'Turn on',

  // —— phase chips / actions / placeholders (phase.ts canon table) ——
  待处理: 'Pending',
  确认: 'Confirm',
  审核: 'Review',
  开始: 'Start',
  完成: 'Complete',
  重开: 'Reopen',
  '向 Agent 补充说明，执行过程中即可送达':
    'Add details for the Agent — delivered while the run is in progress',
  '请求修改…': 'Request changes…',
  // #701 审核关口人肉打回（更多菜单入口 + reject 弹层）
  请求修改: 'Request changes',
  '需要修改什么？打回后任务回到规划中，按反馈重新出方案。':
    'What needs to change? The task returns to planning and gets a fresh plan from your feedback.',
  '打回请求未送出，请重试。': 'The rejection was not sent. Try again.',

  // —— relative time (rel-time.ts; compact en forms avoid plural logic) ——
  刚刚: 'just now',
  '{n} 分钟前': '{n}m ago',
  '{n} 小时前': '{n}h ago',
  昨天: 'yesterday',
  '{n} 天前': '{n}d ago',

  // —— todo detail (r7 §3.3–§3.6) ——
  'Token 用量': 'Token usage',
  运行历史: 'Run history',
  打开方案: 'Open plan',
  添加附件: 'Add attachment',
  'AI 审核': 'AI review',
  审核中: 'Reviewing',
  'AI 审核进行中…': 'AI review in progress…',
  提及: 'Mention',
  停止: 'Stop',
  // #1250（ADR 0018 层 1）verify 步状态与 fan-out 面。
  验证中: 'Verifying',
  验证通过: 'Verification passed',
  验证未通过: 'Verification failed',
  // #731 `/` slash completion vocabulary (zh keys, en values).
  命令: 'Commands',
  '没有匹配"/{query}"的命令': 'No commands match "/{query}"',
  清空输入: 'Clear the input',
  已清空: 'Cleared',
  打开提及面板: 'Open the mention picker',
  '发起 AI 审核': 'Start an AI review',
  停止当前运行: 'Stop the current run',
  查看命令说明: 'Show command help',
  命令说明: 'Command help',
  '团队技能来自技能页面（共 {count} 个）': 'Team skills come from the Skills page ({count} total)',
  '停止当前这一轮？': 'Stop this round?',
  '停止排队？': 'Stop queueing?',
  '任务回到排队前的状态。': 'The task goes back to where it was before it was queued.',
  '丢弃本轮修改——方案和代码回到上一个版本':
    'Discard this round’s changes — plan and code revert to the previous version',
  '把任务重置回待开始？': 'Reset the task back to Todo?',
  确认重置: 'Confirm reset',
  '任务在你打开确认框后发生了变化，下面是最新状态，请重新确认。':
    'The task changed while this dialog was open — this is the latest state. Confirm again.',
  '以下内容将被清空，无法恢复：': 'The following will be cleared and cannot be recovered:',
  '中断运行中的构建（在线的执行机即时中断；离线机器的残留进程够不着）':
    'Interrupt the running build (online executors stop immediately; offline leftovers are out of reach)',
  清空对话记录: 'Clear the conversation',
  清空方案版本: 'Clear the plan versions',
  清空改动记录: 'Clear the change records',
  '保留：标题、需求说明、标签与人员指派。运行历史保留，可供审计。执行机工作区文件不受影响。':
    'Kept: title, spec, tags and assignment. Run history stays for audit. Executor workspace files are untouched.',
  '把任务标记为已完成？': 'Mark the task as done?',
  '先停止构建再标记完成？': 'Stop the build, then mark done?',
  确认完成: 'Confirm done',
  停止并完成: 'Stop and mark done',
  '正在停止…': 'Stopping…',
  已取消: 'Canceled',
  '必须先停止正在跑的构建，再标记完成。完成后 PR 不会自动合并。':
    'The running build must stop first, then the task is marked done. The PR will not merge on its own.',
  '确认后会停止构建，再把任务标为已完成': 'Confirm stops the build, then marks the task done.',
  '选择结局。标记完成不算合并；已取消不算成功交付。':
    'Choose an outcome. Done does not merge. Canceled does not count as success.',
  '确认完成：进入已完成列，计为成功': 'Confirm done: moves to Done and counts as success.',
  '已取消：进入已完成列并标「已取消」，不计为成功':
    'Canceled: moves to Done with a Canceled mark and does not count as success.',
  '已开出的 PR 保持原状，不会自动合并': 'An open PR stays as it is and will not merge on its own.',
  '关闭则卡片留在原列。需要合入变更时，请改用卡片上的完成按钮。':
    'Closing leaves the card where it is. To merge the changes, use the Done button on the card.',
  '停止并完成失败，请重试。': 'Could not stop and mark done. Try again.',
  发送: 'Send',
  '当前没有运行中的会话，消息未送出': 'No active run — the message was not delivered',
  '任务状态已变化，消息未送出': 'The task state changed — the message was not delivered',
  暂无方案: 'No plan yet',
  暂无可显示的变更: 'No changes to show',
  '· {n} 个文件改动': '· {n} files changed',
  全部展开: 'Expand all',
  全部收起: 'Collapse all',
  显示完整文件: 'Show full file',
  显示差异: 'Show diff',
  // #1101: capped fallback tooltip on oversized diff rows (word-diff.ts)
  '行过长，已退回整行高亮': 'Line too long — whole-line highlight only',
  '完成 {elapsed}': 'Done in {elapsed}',
  运行在: 'Running on',
  上: '', // tail of 运行在 <machine> 上 — the en template needs no tail
  由定时发起: 'Started by schedule',
  收起: 'Collapse',
  // #933: the collapsed tool group's identity label (transcript action row).
  工具过程: 'Tool process',
  尚无描述: 'No description yet',
  '{y}年{mo}月{d}日 {hh}:{mm} 创建': 'Created {monthShort} {d}, {y} {hh}:{mm}',

  // —— user-menu popover (r7 §3.5; 新功能/快捷键 行随 #163 隐去，键同删） ——
  帐号: 'Account',
  'API 密钥': 'API keys',
  外观: 'Appearance',
  浅色: 'Light',
  深色: 'Dark',
  密度: 'Density',
  舒适: 'Comfortable',
  紧凑: 'Compact',

  // —— account / agent settings list ——
  头像与名称: 'Avatar and name',
  编辑名称: 'Edit name',
  紧凑会缩小字号与行距: 'Compact uses smaller type and tighter rows',
  '任务需要你处理时，在系统通知中心提醒':
    'Notify you in the system notification center when a task needs you',

  // —— chip popover / plan dropdown (r7 19/20/29) ——
  任务分配: 'Task assignment',
  执行对话: 'Active run',
  未指派: 'Unassigned',
  编辑分配: 'Edit assignment',
  面板视图: 'Pane view',

  // —— ⌘K search panel (r7 05/05b, r2 §8.4) ——
  '搜索任务、项目、成员…': 'Search todos, projects, members…',
  前往: 'Go to',
  团队: 'Team',
  '没有与“{q}”匹配的结果': 'No results matching “{q}”',

  // —— schedules route (r3 §9, 02 §9.2) ——
  频率: 'Frequency',
  每小时: 'Hourly',
  每天: 'Daily',
  每周: 'Weekly',
  单次: 'Once',
  每小时运行: 'Runs hourly',
  每天运行: 'Runs daily',
  每周运行: 'Runs weekly',
  运行一次: 'Runs once',
  '{mo}月{d}日': '{monthShort} {d}',
  '下次 {day} {time}': 'Next {day} {time}',
  自动: 'Auto',
  新建定时: 'New schedule',
  日期: 'Date',
  时间: 'Time',
  时: 'Hour',
  分: 'Minute',
  '按你的本地时区运行（Asia/Shanghai）': 'Runs in your local time zone (Asia/Shanghai)',
  // #1037 fixture 模式自我声明 chip（api/provider.tsx）
  '示例数据（scenario {id}）': 'Sample data (scenario {id})',
  还没有定时任务: 'No schedules yet',
  '按周期或在指定时间自动重新运行任务。每一轮都会依据任务描述从头开始一次全新运行，到达确认或审核关口时暂停，交由负责人接手。':
    'Automatically rerun a task on a cycle or at a chosen time. Every round starts a fresh run from the task description, pausing at the confirm or review gate for the owner to pick up.',
  '也可以直接告诉总管某个任务要多久重跑一次，它会替你写好规则。':
    'You can also just tell the Chief how often a task should rerun, and it will write the rule for you.',

  // —— account route (r7 13) ——
  更换: 'Change',
  名称: 'Name',
  语言: 'Language',
  推送通知: 'Push notifications',
  // #1031: the switch is a preference; when it's on but the browser permission
  // is denied, the row explains why nothing will actually fire.
  '浏览器已拒绝通知权限，需到站点设置重新允许':
    'Notifications are blocked by the browser — re-allow them in site settings',

  // —— team route (r7 12) ——
  设置: 'Settings',
  '{n} 个成员': '{n} members',
  // team empty state, grid and chart (r2 §8.1 17c title)
  暂无成员: 'No members yet',
  '创建 Agent 后，它会出现在这里。': 'Create an agent and it shows up here.',
  ' · 默认': ' · Default',
  未设置职责: 'No role set',
  '创建 Agent': 'Create Agent',

  // —— api-keys route (r2 19, 02 §8 canon note) ——
  '尚无 API 密钥。': 'No API keys yet.',
  'API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的工作台。':
    'API keys connect machines from the command line and let MCP clients reach your workbench.',
  新建密钥: 'New key',
  复制: 'Copy',
  思考: 'Thinking',
  展开思考: 'Expand thinking',
  收起思考: 'Collapse thinking',
  '请立即复制密钥，它仅显示一次。': 'Copy the key now — it is shown only once.',

  // —— resources routes (r7 06–10, r2 §6) ——
  新建: 'New',
  'MCP 服务器': 'MCP Servers',
  添加机器: 'Add machine',
  自定义: 'Custom',
  '搜索技能...': 'Search skills...',
  排序: 'Sort',
  '尚无技能。': 'No skills yet.',
  // spec 13 + XMON-109（spec 13 回摆）技能面：双入口口径——本地目录或页面
  // 新建都会出现在这里（{dir} = SKILLS_DIR_DEFAULT）。
  '把包含 SKILL.md 的技能目录放进 {dir}，或新建一个技能，即会出现在这里。':
    'Drop a skill folder containing SKILL.md into {dir}, or create a new skill here, and it will show up in this list.',
  // XMON-114（spec 13 回摆）技能写面：新建/编辑弹窗与错误态。
  新建技能: 'New skill',
  编辑技能: 'Edit skill',
  'SKILL.md 正文': 'SKILL.md body',
  '这个技能做什么、什么时候用它。': 'What this skill does and when to reach for it.',
  '正在读取 SKILL.md…': 'Loading SKILL.md…',
  'frontmatter（name/description）由上方表单生成，这里只写正文。':
    'The frontmatter (name/description) is generated from the form above — only the body is written here.',
  'frontmatter（name/description）由上方表单生成；未在此编辑的文件保持原样。':
    'The frontmatter (name/description) is generated from the form above; files not edited here stay untouched.',
  '名称须以字母或数字开头，只能含字母、数字、点、横杠、下划线，最长 64 字符。':
    'The name must start with a letter or digit and may only contain letters, digits, dots, dashes and underscores (64 chars max).',
  '描述不要用引号整体包裹——写进 frontmatter 后引号会被剥去，与表单值不一致。':
    'Do not wrap the description in quotes — they are stripped when written to frontmatter and would no longer match the form value.',
  '内容超出单文件上限（{limit} KB）。': 'Content exceeds the per-file limit ({limit} KB).',
  '同名技能已存在——换个名称，或从列表打开它编辑。':
    'A skill with this name already exists — pick another name, or open the existing one from the list to edit it.',
  '该技能已不存在——可能刚被移动或删除。':
    'This skill no longer exists — it may have just been moved or deleted.',
  '内容未通过校验。': 'The content failed validation.',
  // #1170 技能导入弹窗（SkillImportDialog + 技能页 topbar 导入钮）。
  导入: 'Import',
  导入技能: 'Import skill',
  本地路径: 'Local path',
  'GitHub 地址': 'GitHub URL',
  'server 本机上的技能目录路径，目录里要有 SKILL.md。':
    'Path to a skill directory on the cairn server machine — it must contain a SKILL.md.',
  'GitHub 公共仓库或其中子目录的地址；导入后可用 refresh 重新拉取。':
    'Address of a public GitHub repository or a subdirectory of one; after importing you can refresh to re-pull it.',
  '两字段二选一：填其中一个，另一个留空。':
    'Fill in exactly one of the two fields and leave the other empty.',
  '同名技能已存在——先处理现有技能，再重新导入。':
    'A skill with this name already exists — resolve the existing one first, then import again.',
  '来源未通过校验。': 'The source failed validation.',
  '拉取来源失败——稍后重试。': 'Fetching the source failed — try again later.',
  '导入失败，请重试。': 'Import failed, please retry.',
  '尚无 MCP 服务器。': 'No MCP servers yet.',
  // spec 13/#368 本地 config 只读制：空态文案 = 配置指引（无添加钮）。
  '读取 server 本机 ~/.claude.json 的 mcpServers 段：在该文件添加配置并刷新，即出现在这里。MCP 服务器为 Agent 提供额外工具；授权在每个 Agent 的页面上单独进行。':
    'Reads the mcpServers section of ~/.claude.json on the cairn server machine — add entries there and refresh to see them here. MCP servers give Agents extra tools; authorization happens per Agent, on its own page.',
  '尚无密钥。': 'No secrets yet.',
  '团队密钥按 Agent 授权，在需要它的执行步中下发，不预置进任务 shell 环境。值只写不读：保存后只能覆盖或删除，无法再次查看。':
    'Team secrets are granted per Agent and released to the build steps that need them — never pre-set into the task shell environment. Values are write-only: once saved they can be overwritten or deleted, never viewed again.',
  添加密钥: 'Add secret',
  '也可以让总管添加：它会开一张安全输入卡填写值，值不会进入对话。':
    'The Chief can add them too: it opens a secure input card for the value, which never enters the conversation.',
  个文件: 'file(s)',
  描述: 'Description',

  // —— project routes (r2 07/24/24b/24c) ——
  文件: 'Files',
  历史: 'History',
  '尚无提交历史。': 'No commits yet.',
  // #1097 files-pane folder drill-down
  目录导航: 'Directory navigation',
  根目录: 'Root',
  '此目录为空。': 'This folder is empty.',
  '文件树读取失败。': 'Failed to read the file tree.',
  // #1102 commit detail pane
  请选择一个提交查看: 'Select a commit to view',
  提交详情加载失败: 'Failed to load the commit details',
  '该提交没有可显示的改动。': 'This commit has no changes to display.',
  关闭提交详情: 'Close commit details',
  '搜索任务…': 'Search todos…',
  搜索任务: 'Search todos',
  筛选: 'Filter',
  列表视图: 'List view',
  网格视图: 'Grid view',
  暂无内容: 'Nothing yet',
  '创建第一个任务以开始使用。': 'Create your first todo to get started.',
  默认项目: 'Default Project',
  // #446（ADR 0005 读向）项目页「从 GitHub issue 建任务」入口 + 选择弹层
  // （状态过滤 / 分页 / 三态行）。
  '从 GitHub issue 建任务': 'New task from GitHub issue',
  打开: 'Open',
  已关闭: 'Closed',
  'issue 列表加载失败': 'Failed to load issues',
  '这个状态下没有 issue': 'No issues in this state',
  上一页: 'Previous page',
  下一页: 'Next page',
  '第 {page} 页': 'Page {page}',
  // #452（ADR 0006 写向）详情页来源 issue 行：未建成 + 重试入口 / 回显
  // （号 + 状态 + 上游现值标题）/ 不一致中性提示（只提示不覆盖）。
  'GitHub issue 未建成': 'GitHub issue not created',
  '来源 issue': 'Source issue',
  与本地标题不一致: 'Differs from the local title',
  // #476（#473 决策候选 A + C 尾注）右栏方案空态任务元信息块：行 label
  // （机器复用侧栏键）+ 尾注引导句。#1259 机器行等待标注（归属机离线，
  // 步只等它上线不自动改派）。
  '分支 / PR': 'Branch / PR',
  模型: 'Model',
  创建时间: 'Created',
  方案产出后显示于此: 'The plan will appear here once produced',
  '（等待机器上线）': '(waiting for the machine to come online)',
  // #1259 创建 agent 三级级联的归属机槽（+ 无机器告警行）。
  归属机: 'Home machine',
  ' · 归属机 {machine}': ' · on {machine}',
  模型与归属机: 'Model & home machine',
  '跟随绑定 Agent：模型 {model} · 归属机 {machine}':
    'Follows the bound Agent: model {model} · home {machine}',
  '跟随绑定 Agent 的自身配置，在 Agent 的设置里调整。':
    "Follows the bound Agent's own configuration; adjust it in the Agent's settings.",

  未设归属机: 'no home machine',
  还没有接入机器: 'No machines connected yet',
  接入机器: 'Connect a machine',
  在线: 'Online',
  '无 runtime 开启': 'No runtimes enabled',
  '并发 {running}/{cap}': '{running}/{cap} concurrent',
  '迁移到…': 'Migrate to…',
  迁移到: 'Migrate to',
  整机迁移: 'Migrate all agents',
  状态: 'Status',
  '把归属这台机器的 agent 一起迁到另一台机器。':
    'Move every agent homed on this machine to another one.',
  删除机器: 'Delete machine',
  '先迁走归属这台机器的 {n} 个 agent 才能删除。':
    'Move the {n} agents homed on this machine first, then delete it.',
  '删除后，这台机器要重新注册才能再接任务。':
    'Once deleted, the machine has to enroll again before it takes work.',
  '确定删除这台机器？此操作不可撤销。': 'Delete this machine? This cannot be undone.',
  '尚无机器。': 'No machines yet.',
  '在要执行任务的机器上运行注册命令，它就会出现在这里。':
    'Run the enroll command on the machine that should run tasks and it appears here.',
  机器不存在或已移除: 'Machine missing or removed',
  '整机迁移失败，请重试。': 'Migration failed. Try again.',
  '删除机器失败，请重试。': 'Could not delete the machine. Try again.',
  '{n} 个 agent 未过校验留在原机': '{n} agents failed validation and stayed put',
  // 桌面通知标题（M5 SSE notification 事件面，02 §9.1 三事件；api/sse.ts
  // 纯函数位消费——非组件 t()，i18n-coverage 以本键位兑现 en 兜底）
  方案已就绪: 'Plan ready',
  构建待审核: 'Build awaiting review',
  // #1261 等额度族（桌面通知标题 + 卡芯片 + 横幅 + 详情行标签）。
  等额度: 'Waiting for quota',
  // #1493 降级链：桌面通知标题。
  已换备用模型: 'Switched to fallback model',
  '等额度：{lane} {kind}，{probe} 自动探测续跑':
    'Waiting for quota: {lane} {kind}, auto-probe at {probe}',
  '{lane} {kind}，{count} 个任务挂起等额度': '{lane} {kind}, {count} task(s) waiting for quota',
  '额度恢复后自动续跑；{probe} 自动探测':
    'Runs resume automatically once quota recovers; next probe at {probe}',
  '{count} 个任务因额度/限流挂起': '{count} task(s) suspended on quota/rate limits',
  '额度恢复后自动续跑，无需人工操作':
    'Runs resume automatically once quota recovers — no action needed',
  // #1261 标签 vars 值（kind 位的中英对译——vars 插值不查词典，单列键位）。
  额度空: 'out of quota',
  限流: 'rate limited',
  请选择一个文件查看: 'Select a file to view',
  // #202 文件查看器三态（loading / error / 不可预览）
  '加载中…': 'Loading…',
  文件加载失败: 'Failed to load file',
  二进制文件暂不支持预览: 'Binary files cannot be previewed',
  '可选。未设置时以首字母代替。': 'Optional. The initial is used when unset.',
  项目名称: 'Project name',
  仓库: 'Repo',
  选择仓库: 'Select repo',
  // #360（spec 12）repo 选择面两行：GitHub 仓库 / 本地文件夹（hosted 行
  // 创建入口移除；下方「Cairn 托管」= 存量 hosted 项目的设置面显示键，
  // 与本表无关，保留）。
  'GitHub 仓库': 'GitHub repo',
  本地文件夹: 'Local folder',
  创建项目: 'Create project',
  // #386 本地路径校验错误行：server 400 reason code 的三态分类文案（zh 键
  // 单源 = shared LOCAL_ERROR_REASON_COPY）；无 code / 未分类 reason 原文直
  // 透（不进词典）。
  路径不存在: 'Path not found',
  '不是 git 仓库': 'Not a git repository',
  需要绝对路径: 'Absolute path required',
  浏览: 'Browse',
  '此部署形态不支持系统对话框，请直接输入路径':
    'System folder dialog is unavailable in this deployment — type the path directly',
  已有一个选取对话框在进行中: 'A folder dialog is already open',
  无法打开系统文件夹对话框: 'Cannot open the system folder dialog',
  // #441 应用内目录浏览器（ADR 0003 D6 remote/headless 兜底）。
  浏览本地文件夹: 'Browse local folders',
  // #1152（ADR 0016）localPath 单机器形态常驻标注：真值在该机文件系统，
  // 不享受换机续跑；可丢性只属 githubRepo 形态。
  '单机器形态：这台机器损坏时进度随机器走。需要在任意机器上续跑，请用 GitHub 接入。':
    'Single-machine: progress dies with this machine. Use GitHub to resume from any machine.',
  显示隐藏文件: 'Show hidden files',
  没有子目录: 'No subfolders',
  子目录均已隐藏: 'All subfolders are hidden',
  选择: 'Select',
  'git 仓库': 'Git repository',
  '目录条目过多，只列出前 {n} 条': 'Too many entries — showing the first {n}',
  基本信息: 'Basic info',
  标签: 'Tags',
  'Cairn 托管': 'Cairn hosted',
  目标分支: 'Target branch',
  // #1213/ADR 0017 双执行源：github 形态项目的 localPath 同机加速位字段。
  本机加速路径: 'Local acceleration path',
  '绝对路径，留空即清除': 'Absolute path; empty to clear',
  // #1242 项目身份可变面：设置页名称/描述编辑 + local→github 转换卡。
  保存名称: 'Save name',
  保存描述: 'Save description',
  '描述保存失败，请重试。': 'Failed to save description. Try again.',
  保存仓库: 'Save repository',
  '仓库保存失败，请重试。': 'Failed to save repository. Try again.',
  // #1491 project settings: background autonomy gates card
  后台自动任务: 'Background tasks',
  允许后台自动开跑: 'Allow background runs',
  'issue 进料、园丁等后台任务开一轮前先过这道闸；下面的分钟数或预算填 0 = 关掉那一道。':
    'Issue intake, the gardener and other background tasks check these gates before each run; set a number to 0 to turn that gate off.',
  '有人在用时让路（分钟）': 'Yield while someone is active (minutes)',
  '同类任务冷却（分钟）': 'Cooldown between runs (minutes)',
  '每日预算（USD）': 'Daily budget (USD)',
  '今日已花（UTC）': 'Spent today (UTC)',
  读不到: 'Unavailable',
  保存后台自动任务设置: 'Save background task settings',
  'issue 进料': 'Issue intake',
  园丁: 'Gardener',
  自治合并: 'Auto-merge',
  还没判过: 'Not checked yet',
  最近一次放行: 'Last check: allowed',
  '最近一次被拦：': 'Last check blocked: ',
  未开启: 'turned off',
  '没有新提交，休眠中': 'no new commits, sleeping',
  在飞任务已满: 'in-flight limit reached',
  '有人正在用，让路': 'someone is active, yielding',
  冷却中: 'cooling down',
  今日预算已用完: "today's budget is used up",
  '花费读不到，先不跑': 'spend unreadable, holding off',
  '转换失败，请重试。': 'Conversion failed. Try again.',
  '转换为 GitHub 形态': 'Convert to GitHub form',
  '转换后以 GitHub 仓为唯一真值源，本机路径转为执行加速位；有在飞构建时不可转换。':
    'After conversion the GitHub repo becomes the single source of truth and the local path becomes an execution accelerator; conversion is blocked while builds are in flight.',
  'GitHub 仓库（owner/repo）': 'GitHub repository (owner/repo)',
  'GitHub 仓库格式应为 owner/repo。': 'GitHub repository must be in owner/repo form.',
  转换: 'Convert',
  危险操作: 'Danger zone',
  删除项目: 'Delete project',
  // #1174：删除卡文案列真级联（正本 = server services/projects.ts 清图序：
  // step/build → schedule → tag → todo → 托管 bare repo 磁盘面；技能不入库
  // 亦不按项目授权，不在级联）。
  '删除项目将级联删除其下所有任务、构建历史、定时任务、标签与托管仓库文件，此操作不可恢复。':
    'Deleting the project cascade-deletes all its tasks, build history, schedules, tags, and hosted repository files. This cannot be undone.',
  // #207 确认弹层(r2 24d): 标题镜像删除任务句,确认输入行 {name} = 项目名。
  '确定删除该项目？此操作不可撤销。': 'Delete this project? This cannot be undone.',
  '输入 {name} 以确认删除': 'Type {name} to confirm deletion.',

  // —— chief drawer / settings (r5 100–116) ——
  主题: 'Thread',
  新主题: 'New thread',
  总管设置: 'Chief settings',
  '请先为总管选择一个 Agent。': 'Choose an Agent for the Chief first.',
  选择一个主题开始: 'Pick a thread to start',
  '有什么可以帮你的？': 'How can I help?',
  '完成 {n}': 'Done in {n}',
  章程: 'Charter',
  记忆: 'Memory',
  记忆已更新: 'Memory updated',
  技能已更新: 'Skill updated',
  关注与提醒: 'Watches & reminders',
  未设置: 'Not set',
  // #854 收编 popover 后用户菜单面板的 aria-label（原 FloatingShell 壳无标签）
  用户菜单: 'User menu',
  '尚无章程。点击编辑，为总管添加常设指示。':
    'No charter yet. Click edit to give the Chief standing instructions.',
  编辑: 'Edit',
  '尚未选择 Agent。请先在「Agent」页选定 Agent，记忆将保存在该 Agent 上。':
    'No Agent selected yet. Pick an Agent on the "Agent" tab first; memories are saved on that Agent.',
  '暂无跟进事项。总管关注某个任务，或约定到点回头核实时，会按主题列在这里。':
    'Nothing being watched yet. When the Chief watches a todo, or promises to check back at a set time, it is listed here by thread.',
  // #811 关注 tab：无备注 wake 行的回退文案（有备注显示备注原文）。
  到点提醒: 'Scheduled check-in',
  // #182 设置面接线：选择总管 Agent dialog + 章程编辑弹窗；换绑二次确认
  // copy 走 shared CHIEF_REBIND_CONFIRM_COPY canon（<agent> 占位，显示层替换，
  // i18n-coverage COMPUTED_KEYS 登记）。
  '选择总管 Agent': "Choose the Chief's Agent",
  '搜索 Agent…': 'Search Agents…',
  '没有匹配的 Agent': 'No matching Agents',
  // #615 总管抽屉主模型闭环文案（模型行 aria + 覆盖 dialog 默认行/搜索/空态）。
  // #615 返工：恢复钮（参考站 live aria 正词）+ 过程折叠 + 确认层 + 工具行失败徽标。
  恢复到此处: 'Restore to here',
  '恢复到此处？该条之后的 {n} 条消息会移除，总管从这条重发开新回合。':
    'Restore to here? The {n} messages after it are removed and the Chief resends from this one as a fresh turn.',
  展开过程: 'Show process',
  收起过程: 'Hide process',
  // #822 在飞存在行展开面：行开关 aria + 正在调用的工具 + 空面 fallback。
  展开实时步骤: 'Show live steps',
  收起实时步骤: 'Hide live steps',
  '正在调用 {n}': 'Calling {n}',
  '等待 Agent 响应…': 'Waiting for the agent…',
  // #1257 板面挂起态：等机器 / 等额度 chip + 等额度 tooltip（下次尝试时刻）。
  // 等额度 chip 词复用 #1261 的同名键（上面等额度族）。
  等机器: 'Waiting for a machine',
  '下次尝试 {time}': 'Next attempt at {time}',
  '等额度：模型额度用尽，挂起等待恢复（下次尝试 {time}）':
    'Waiting for quota: model quota exhausted, suspended until it recovers (next attempt {time})',
  // #873 详情活行披露面：在跑步两行（步类 + 执行机器）；行开关 aria 复用
  // #822 的「展开/收起实时步骤」——同一手势两面同词。
  '本步：{n}': 'This step: {n}',
  '执行机器：{n}': 'Machine: {n}',
  // M7 #312 AI 审核模态文案（r8 §3.1 实测）：Agent 选择 + 关注点 textarea +
  // 提交按钮。dialog 选 Agent 走 dlg-form-* family 共用层,文案独立。
  '选择审核 Agent': 'Choose review Agent',
  '希望 Agent 审核时重点关注什么？（可选）':
    'What do you want the Agent to focus on during review? (optional)',
  开始审核: 'Start review',
  // #1250（ADR 0018 层 1）review fan-out 三视角（ReviewDialog 勾选行）。
  三视角并行审: 'Run the three review perspectives in parallel',
  'CodeReviewer · SecurityAuditor · TestEngineer 各审一轮，三份结论并行落会话':
    'CodeReviewer · SecurityAuditor · TestEngineer each review once; three verdicts land in the conversation in parallel',
  开始三视角审核: 'Start three-perspective review',
  // #509 审核选人独立性提示：默认值优先跨厂商；无跨厂商可选时出声。两档措辞
  // ——确证同源 vs 无法判定（未配置厂商 = 没有比对基准），都不静默。
  本次审核与产出同源: 'This review shares a vendor with the producing step',
  无法判定审核独立性: 'Cannot determine review independence',
  '审核人与产出该方案的 Agent 来自同一模型厂商，不构成独立复核。':
    'The reviewer and the Agent that produced this plan use the same model vendor; this is not an independent review.',
  '产出该方案的 Agent 或所选审核人未配置模型厂商，缺少比对基准，不构成独立复核。':
    'Neither the producing Agent nor the selected reviewer has a model vendor configured, so there is nothing to compare against; this is not an independent review.',
  // M7 #330 AI 审核消息渲染（r8 §3.1 真 findings 上线）：结论先行 + 编号 findings
  // + 严重度后缀（(blocking)/(suggestion)/(info)）+ 方案引用块 + 修复建议。
  // 服务端消息 kind = REVIEW_VERDICT_KIND（shared/message.ts 双端单源），
  // findings 形态 = reviewVerdictSchema（shared/review.ts）。
  审核结论: 'Review conclusion',
  // #700：verdict 提取失败行——daemon findingsError 原因上浮，审核面以
  // danger 色 tag 与「审核未返回结论」兜底（旧 daemon 无信号）相区分。
  判定提取失败: 'Verdict extraction failed',
  '(blocking)': '(blocking)',
  '(suggestion)': '(suggestion)',
  '(info)': '(info)',
  '建议：': 'Suggestion: ',
  '建议：{body}': 'Suggestion: {body}',
  '更换总管的 agent？总管的记忆保存在其运行所用的 Agent 上。切换至 <agent> 后，记忆将变为 <agent> 的记忆，当前记忆不会迁移。':
    "Switch the Chief's Agent? The Chief's memory lives on the Agent it runs on. After switching to <agent>, the memory becomes <agent>'s — the current memory is not migrated.",
  编辑章程: 'Edit charter',
  保存章程: 'Save charter',
  '长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…':
    'Long-term instructions: model routing rules (which model for which work), priorities, preferences…',
  // #209 编辑分配接线：chip-popover「编辑分配」→ agent 选择弹层（#182 家族
  // 形态复用）；弹层内容 r2 C.18 从未捕获，文案 [设计]，<agent> 占位显示层
  // 替换。
  '选择执行 Agent': 'Choose the executing Agent',
  '更换执行 Agent？后续运行将改由 <agent> 执行。':
    'Change the executing Agent? Future runs will be executed by <agent>.',

  // —— chrome carried inside fixture records (exact-value keys; user and
  // agent content is deliberately absent — it falls back to the zh
  // original like any real user data would) ——
  '准备工作区...': 'Preparing workspace...',
  '处理中...': 'Working on it...',
  '执行中...': 'Running...',
  // #1108 queue rows (pending steps waiting for a machine) + machines page
  // concurrency face.
  '排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）':
    'Queued: waiting for {machine} ({running}/{cap} running, {ahead} ahead)',
  '排队中：等空闲机器（前面 {ahead} 个）': 'Queued: waiting for a free machine ({ahead} ahead)',
  // #1251 visible pending reasons (queue blocked face): missing capability =
  // the fix, offline = waiting.
  '排队中：没有机器满足能力要求（缺 {missing}）——装齐后下一拍心跳即解锁（前面 {ahead} 个）':
    'Queued: no machine meets the capability requirements (missing {missing}) — installs unlock it on the next heartbeat ({ahead} ahead)',
  '排队中：等 {machine} 上线（前面 {ahead} 个）':
    'Queued: waiting for {machine} to come online ({ahead} ahead)',
  '排队中：等机器上线（前面 {ahead} 个）':
    'Queued: waiting for a machine to come online ({ahead} ahead)',
  '执行中 {n}/{cap}': 'Running {n}/{cap}',
  // #1251 machines page capability annotation (daemon-reported inventory).
  能力清单未上报: 'Capabilities not reported',
  'MCP {n} · 本机技能 {m}': 'MCP {n} · local skills {m}',
  'MCP {n} · 技能 {m}': 'MCP {n} · skills {m}',
  手动: 'Manual',
  推荐: 'Recommended',
  估算: 'Estimate',
  核数: 'Cores',
  总内存: 'Total memory',
  负载: 'Load',
  '未收到能力指纹，按保守默认 {n} 估算':
    'No capability fingerprint received; estimated at the conservative default of {n}',
  恢复推荐: 'Reset to recommended',
  并发上限: 'Concurrency limit',
  '可选 {min}–{max}（按内存）': 'Range {min}–{max} (by memory)',
  '可选 {min}–{max}（默认档位）': 'Range {min}–{max} (default)',
  '推荐 {n}': 'Recommended {n}',
  '当前值 {n} 超出可选范围': 'Current value {n} is outside the range',
  减少并发上限: 'Decrease concurrency limit',
  增加并发上限: 'Increase concurrency limit',
  '并发上限 {n}': 'Concurrency limit {n}',
  '并发上限 {n}，{source}': 'Concurrency limit {n}, {source}',
  // #905 activity phases (live row labels) + the freshness disclosure line.
  '正在连接模型...': 'Connecting to the model...',
  '模型思考中...': 'Model is thinking...',
  '模型输出中...': 'Model is responding...',
  '正在执行工具：{n}': 'Running tool: {n}',
  '自动重试中（第 {n} 轮）...': 'Auto-retrying (attempt {n})...',
  '正在压缩上下文...': 'Compacting context...',
  '等待模型响应...': 'Waiting for the model...',
  '最近信号：{n}s 前': 'Last signal {n}s ago',
  // #918 skill facts: live-panel entries (read / denied) + the detail summary.
  '▶ skill: {n}': '▶ skill: {n}',
  '✕ skill: {n}（已挡下）': '✕ skill: {n} (blocked)',
  '技能：{n}': 'Skills: {n}',
  '挡下：{n}': 'Blocked: {n}',
  // #1106 dispatch skill injection: detail-face lookup row (reasons ride as
  // server data, not t() keys — same law as note #634).
  '注入技能：': 'Injected skills: ',
  '未注入技能（任务文本未命中任何技能）': 'No skills injected (task text matched none)',
  // #1288：模型活性标注——dead 模型置灰 +「已下架」（不隐藏）。
  已下架: 'Delisted',
  [PROBE_TOOL_CALL_LABEL]: `Calling tool: ${PROBE_TOOL_PILLS[1]}`,
  '方案 · v1': 'Plan · v1',
  'Xmon Dai 发起了合并': 'Xmon Dai started a merge',
  '🎉 任务已完成': '🎉 Todo completed',
  '运行在 ': 'Running on ',
  '远程（HTTP）': 'Remote (HTTP)',
  '2 天前': '2d ago',
  // —— overlay dialogs (issues #66 / #68) ——
  新建任务: 'New task',
  '我想要的结果：': 'The outcome I want:',
  '现在的情况：': 'Where things stand now:',
  '需要保留或避免：': 'What must be kept or avoided:',
  '我会这样确认完成：': 'How I will confirm this is done:',
  '我希望收到：': 'What I expect to receive:',
  保存并开始: 'Save and start',
  删除任务: 'Delete todo',
  '确定删除该任务？此操作不可撤销。': 'Delete this todo? This cannot be undone.',
  // #306 sched-card 菜单删除确认（DeleteConfirm 家族泛化随加）。
  删除定时: 'Delete schedule',
  '确定删除该定时？此操作不可撤销。': 'Delete this schedule? This cannot be undone.',
  // XMON-19/B2 删除 Agent：三串 = 原版产线 bundle 的 en 语料原文
  // （agent_modal.remove / remove_title / remove_confirm），非回译。
  '删除 Agent': 'Delete agent',
  '删除 Agent？': 'Delete agent?',
  '将「{name}」移出团队？该 Agent 进行中的任务将被停止。':
    'Remove "{name}" from this team? Active tasks for this agent will be stopped.',
  复制链接: 'Copy link',
  完成任务: 'Complete todo',
  将改动合并到默认分支: 'Merge the changes into the default branch',
  // #1313：已上报且文件集为空时完成弹层不提供合并勾选。
  '本轮没有文件改动，完成不会合并分支。':
    'This round has no file changes. Completing will not merge the branch.',
  '信息卡的产出是报告附件，不进合并。':
    'An info card delivers a report attachment and is never merged.',
  // XMON-89 合并被拒的可见化：前置缺项行（{tools} = 1~2 个开关名的顿号串；
  // 开关名本身是 shared AGENT_TOOL_SWITCHES 的 zh 值域词，locate 后仍按 zh
  // 出现——与权限 tab 的开关行一致，不另开一份 en 词表）＋ 5xx/网络失败的
  // 固定兜底句（4xx 的 server 原文不翻译：它逐字点名拒因，翻一遍反而对不
  // 上）。#1236：完成弹层的勾选分流反馈四串（合并委派回执 / 不合并完成回
  // 执 / 目标缺位报错 / 不合并腿兜底句）＋ failed 卡勾选锁定行。
  '缺少「{tools}」授权，无法合并。请在该 Agent 的权限里开启。':
    'Missing the "{tools}" permission, so this merge cannot go through. Turn it on in the agent’s permissions.',
  '合并请求未送出，请重试。': 'The merge request was not sent. Try again.',
  '完成请求未送出，请重试。': 'The completion request was not sent. Try again.',
  '任务数据未就绪，完成请求未送出。请刷新页面后重试。':
    'Todo data is not ready, so the request was not sent. Refresh the page and try again.',
  '已发起合并，合并完成后任务进入已完成。':
    'Merge started. The todo moves to done once the merge completes.',
  '任务已完成，改动保留在会话分支。':
    'Todo completed. The changes stay on the conversation branch.',
  '失败任务只能经合并完成，不能跳过合并。':
    'A failed todo can only be completed through the merge; merging cannot be skipped.',
  输入: 'Input',
  输出: 'Output',
  缓存读取: 'Cache read',
  缓存写入: 'Cache write',
  缓存命中率: 'Cache hit rate',
  花费: 'Cost',
  '输入（含缓存写入）': 'Input (incl. cache write)',
  '无价格来源：模型未声明费率，或该运行未上报费用':
    'No price source: the model declares no rates, or the run reported no cost',
  当前: 'Current',
  重跑: 'Rerun',
  构建分支: 'Build branch',
  目标提交: 'Target commit',
  同步到机器: 'Sync to machine',
  目标机器: 'Target machine',
  同步目录: 'Sync directory',
  强制同步: 'Force sync',
  '丢弃代码修改并删除非忽略的未跟踪文件；保留忽略内容。仅本次生效。':
    'Discards code changes and removes non-ignored untracked files; ignored content is kept. This sync only.',
  同步: 'Sync',
  未创建: 'Not created',
  // #319 分支对话框「同步到机器」结果卡四态 + 机器选择占位
  选择机器: 'Choose a machine',
  暂无在线机器: 'No online machines',
  等待中: 'Pending',
  '正在同步…': 'Syncing…',
  已同步: 'Synced',
  同步失败: 'Sync failed',
  // run-history rows: fixture-carried chrome (exact-value keys)
  '第 1 次运行': 'Run 1',
  '第 2 次运行': 'Run 2',
  '第 3 次运行': 'Run 3',
  '第 4 次运行': 'Run 4',
  '12 分钟前 · 38.3k tokens': '12m ago · 38.3k tokens',
  '6 小时前 · 66.1k tokens': '6h ago · 66.1k tokens',
  '3 天前 · Cancelled': '3d ago · Cancelled',
  '3 天前': '3d ago',
  '4 天前 · Machine offline': '4d ago · Machine offline',
  '2 天前 · 41.7k tokens': '2d ago · 41.7k tokens',
  '帮我组建 Agent 团队': 'Help me build an Agent team',
  帮我创建一个新项目: 'Help me create a new project',
  总结一下我所有项目现在的进展: 'Summarize the progress of all my projects',
  '查一下这个月的 token 用量': "Check this month's token usage",

  // —— #75 deep dynamic states: reject loop / failed / reuse plan ——
  由总管发起: 'Started by Chief',
  '运行在 {m} 上': 'Running on {m}',
  上一版本: 'Previous version',
  '与其他版本对比…': 'Compare with other versions…',
  '回到与 base 对比': 'Back to comparison with base',
  复用方案: 'Reuse plan',
  选择接下来如何使用这个方案: 'Choose how to use this plan next',
  查看方案: 'View plan',
  // #1258 失败行原始错误弹窗面
  查看原始错误: 'View raw error',
  原始错误: 'Raw error',
  // #1285 失败行指引按分类分族
  '请将其重新上线，或重新运行任务以改派其他机器。':
    'Reconnect the machine, or rerun the task to assign another machine.',
  '模型额度已用尽，请等待额度恢复后重试。':
    'Model quota exhausted — wait for it to recover, then retry.',
  '请求被限流，请稍后重试。': 'Rate limited — retry later.',
  '运行失败，请查看原始错误排查原因后重试。':
    'Run failed — check the raw error to diagnose the cause, then retry.',
  直接执行: 'Run directly',
  重试: 'Retry',
  失败: 'Failed',
  默认: 'Default',
  开始任务: 'Start task',
  // XMON-55 P0 / #640: the hint that rides the 开始 button on the fresh brief
  // —— 开始入口不再选机器/Agent，改为直发总管编排回合后派发。
  '点开始后由总管编排派发，Agent 在你的机器上跑':
    'The chief orchestrates and dispatches after you start — the agent runs on your machine',
  // #170 create-agent dialog family
  '创建 agent': 'Create agent',
  '输入 Agent 名称': 'Enter an agent name',
  尚未配置模型服务商: 'No model provider configured yet',
  配置服务商: 'Configure providers',
  创建: 'Create',
  // W4 #287 API key 新建表单弹窗（r3 §6 权限位 [推断]）
  '名称（可选）': 'Name (optional)',
  '如：笔记本、CI 机器': 'e.g. laptop, CI runner',
  'Git 读写（托管仓库 push/pull）': 'Git read/write (hosted repo push/pull)',
  'MCP 访问（MCP 客户端接入）': 'MCP access (MCP client connections)',
  工具权限位: 'Tool grants',
  // #636 起 zh「全选」归筛选面板的全选行（en 'Select all'）；本面快捷键换
  // 「授予全部」避开同形碰撞——zh 源串即 key，两个语义域必须分叉。
  授予全部: 'Grant all',
  清空: 'Clear all',
  读: 'Read',
  写: 'Write',
  // wayfinder #173 add-secret dialog family (r2 §242 verbatim fields)
  '名称（环境变量名）': 'Name (environment variable name)',
  '描述（可选）': 'Description (optional)',
  值: 'Value',
  该密钥的用途: 'What this secret is for',
  粘贴密钥的值: 'Paste the secret value',
  '值将加密存储，保存后无法再次查看。':
    'The value is stored encrypted and cannot be viewed again after saving.',
  // wayfinder #178 project tasks toolbar (filter/sort menus, match-empty line)
  全部: 'All',
  进行中: 'In progress',
  最近更新: 'Recently updated',
  标题: 'Title',
  没有匹配的任务: 'No matching tasks',
  // wayfinder #175 add-provider dialog family (field authority = shared
  // createProviderBodySchema / r3 §2; protocol tab labels stay English
  // verbatim, never translated)
  添加模型服务: 'Add provider',
  '服务商 ID': 'Provider ID',
  '例如 my-relay': 'e.g. my-relay',
  'API 协议': 'API protocol',
  无密钥网关可留空: 'Leave empty for keyless gateways',
  '以 Authorization: Bearer 请求头发送 API 密钥':
    'Send the API key as an Authorization: Bearer header',
  '密钥将加密存储，保存后无法再次查看。':
    'The key is stored encrypted and cannot be viewed again after saving.',
  '模型（可选）': 'Models (optional)',
  '模型 ID': 'Model ID',
  添加模型: 'Add model',
  // #355 picker 形态(spec 11 §A6;preset 显示名 = 品牌串不译,OAuth 徽标
  // 同为英文字面)
  '搜索服务商...': 'Search providers...',
  自定义端点: 'Custom endpoint',
  // #385 族表未接线的 OAuth preset 行注记(如 openai-codex)
  暂未开通: 'Not yet available',
  // Paper grouped provider picker: group headings
  订阅登录: 'Subscription sign-in',
  模型厂商: 'Model vendors',
  云平台: 'Cloud platforms',
  推理平台: 'Inference platforms',
  网关与聚合: 'Gateways and routers',
  其他: 'Other',
  // #356 runtime tabs(spec 11 §A1-A4;tab 名 pi/Claude Code 不译,槽位名
  // default/opus/… 为配置标识符不译;{hostname} = 上报机器名插值)
  'cairn 自有运行时。模型来自你添加的服务商。':
    "cairn's own runtime. Models come from the providers you add.",
  '执行机 Claude Code 配置（~/.claude/settings.json）的模型槽。':
    'Model slots from the executor machine’s Claude Code config (~/.claude/settings.json).',
  '执行机 Gemini CLI 的本地会话。': 'Local sessions of the executor machine’s Gemini CLI.',
  '已安装在 {hostname}': 'Installed on {hostname}',
  未安装: 'Not installed',
  '已安装，未配置模型槽': 'Installed, no model slots configured',
  未登录: 'Not signed in',
  '在该机器上写 ~/.claude/settings.json 的 env.ANTHROPIC_*_MODEL 槽后，此处自动展示其模型槽。':
    'Add ANTHROPIC_*_MODEL slots to env in ~/.claude/settings.json on that machine and its model slots show up here.',
  '安装 Claude Code 并完成一次登录后，此处自动展示其模型槽。':
    'Install Claude Code and sign in once; its model slots appear here automatically.',
  '尚未添加服务商。': 'No providers yet.',
  '添加后，服务商的模型会出现在这里。': 'Once you add one, its models appear here.',
  'settings.json 未配置模型槽。': 'No model slots configured in settings.json.',
  '尚无执行机上报模型信息。': 'No executor has reported model info yet.',
  // #231/#243 OAuth 落地 reason 三译(providers-page 喂 connectError 行)
  '授权已被取消。': 'Authorization was cancelled.',
  '令牌交换失败，请稍后重试。': 'Token exchange failed — please try again.',
  '连接已过期，请重新发起。': 'Connection expired — please start it again.',
  // #361 GitHub 连接认证 + repo picker（spec 12 G2-T4；错误三译复用 #243 键）
  '认证 GitHub': 'Connect GitHub',
  '选择 GitHub 仓库': 'Choose a GitHub repository',
  搜索仓库: 'Search repositories',
  没有匹配的仓库: 'No matching repositories',
  断开连接: 'Disconnect',
  已连接: 'Connected',
  '手动输入 owner/repo': 'Enter owner/repo manually',
  // wayfinder #181 add-machine dialog family (r2 11b verbatim copy; the
  // command strings themselves stay untranslated — brand slots via BRAND)
  '有条件时优先使用云主机：笔记本会休眠或断网，云主机常在线，构建更稳定。':
    'Prefer a cloud host when you can: laptops sleep or drop off the network, while cloud hosts stay online and build more reliably.',
  '在待接入的机器上执行以下命令。浏览器将打开登录页，授权团队 {team} 后机器即可上线。此后它在后台常驻运行，无需保持终端开启。':
    'Run the following commands on the machine you want to connect. Your browser will open a sign-in page; once you authorize the team {team}, the machine comes online. It then keeps running in the background — no need to keep the terminal open.',
  '安装 CLI': 'Install the CLI',
  在机器上执行: 'Run on the machine',
  '在云服务器上运行？改用 API key 注册':
    'Running on a cloud server? Register with an API key instead',
  '获取 API key →': 'Get an API key →',
  // #253 token 门页（鉴权开时 401 落页；auth 单缝 = src/api/auth.ts）
  需要访问令牌: 'Access token required',
  '服务端已开启令牌鉴权，输入访问令牌后继续使用。':
    'This server has token authentication enabled. Enter your access token to continue.',
  '令牌从哪来：在运行服务端的机器上执行 `cairn token` 查看当前令牌（`cairn token --rotate` 换发新令牌；令牌存于服务端 {tokenFile} 文件，设了 {tokenVar} 环境变量则以环境变量为准）。本地自行部署时，服务端启动日志还会打印一次性登录链接；容器/托管部署（{requireTokenVar}）的日志是共享的，不会打印令牌值和登录链接，请向部署者索取。删除环境变量或令牌文件并重启服务端即可关闭令牌鉴权。':
    'Where the token comes from: run `cairn token` on the machine running the server to see the current token (`cairn token --rotate` issues a new one; it is stored in the {tokenFile} file on the server, and the {tokenVar} environment variable wins when set). On a local self-hosted deployment, the server log also prints a one-time login link at startup; container/hosted deployments ({requireTokenVar}) keep shared logs free of the token value and the login link, so ask the deployer for access. Remove the environment variable or the token file and restart the server to turn token authentication off.',
  访问令牌: 'Access token',
  进入: 'Continue',
  '令牌无效，请重试。': 'Invalid token — please try again.',
  // W4 #285 浏览器授权页（02 §5.2 路径一；/app/machines/authorize）
  授权机器: 'Authorize machine',
  '生成授权链接，在执行机上完成注册发起。':
    'Generate an authorization link and start enrollment on the executor machine.',
  生成授权链接: 'Generate authorization link',
  '一台执行机请求加入你的团队。确认后它将以自己的凭据连接。':
    'An executor machine is requesting to join your team. Once authorized it connects with its own credentials.',
  确认授权: 'Authorize',
  '正在授权…': 'Authorizing…',
  '授权完成，机器已注册。': 'Authorized — the machine is registered.',
  '授权链接已失效，请在执行机上重新发起。':
    'This authorization link has expired — restart enrollment on the executor machine.',
  '浏览器授权注册 →': 'Browser authorization →',
  // W2 #318 桩群校准：新建任务未保存闸（r9 §3.4）。#310 附件：dirty 位由
  // spec 非空承载（附件 token 注入后归 spec）,标签 add 仍为桩（本票不动）。
  // （#640：开始任务 dialog 统一面的 规划/执行/在线/离线/选择 Agent 五键随
  // 选择面撤销退役——开始入口不再有 dialog 选择器。）
  '放弃新建任务？': 'Discard this new task?',
  '未保存的内容将丢失。': 'Unsaved content will be lost.',
  继续编辑: 'Keep editing',
  放弃并关闭: 'Discard and close',

  // —— mention picker (issue #311, r9 §2.2/§3.2) ——
  // Top layer 5 category rows + drill-in search + footer Insert (N) count.
  // 与侧边栏/搜索面板的「任务/技能/Agents/项目/机器」键一致,只追加弹层
  // 本地需要的 5 个键(搜索/空集/返回/插入 (n)/空态 query 分支；#848 起内联
  // 空态复用「没有可引用的对象」，「没有可用的 Agent」退役)。
  '搜索…': 'Search…',
  没有可引用的对象: 'Nothing to mention',
  '没有与"{query}"匹配的结果': 'No results matching “{query}”',
  '插入 ({count})': 'Insert ({count})',

  // —— local 项目 Files tab 读面（#1030 开闸；不可达降级文案）——
  '本地仓库当前无法读取。': 'The local repository cannot be read right now.',

  // —— github 项目 Files tab 诚实降级面（#704 / B-C1：文件在 GitHub，外链承接）——
  'GitHub 仓库项目的文件在 GitHub 上查看': 'Files for GitHub repository projects live on GitHub',
  '打开 GitHub 仓库': 'Open the GitHub repository',

  // —— #403/#445 看板筛选面（仓库 chip 组 + 类型 popover + 空结果态）——
  类型: 'Type',
  没有匹配筛选条件的任务: 'No tasks match the selected filters',
  清除筛选: 'Clear filters',

  // —— XMON-57 统一筛选面板（两维 + 批次键 + 生效筛选条 + 空词表行）——
  // #636 批次行照参考站形：全选行（zh「全选」，本域 en 'Select all'）+ 右端
  // 反选；权限授予面改用「授予全部」避开同形碰撞（zh 源串即 key，两域必须
  // 分叉）。段内清除钮撤除——清除由全选行满选再点 / 反选 / 顶栏生效筛选条
  // 三路承接，`清除` 条目随之下架。
  全选: 'Select all',
  反选: 'Invert',
  仅此: 'Only this',
  '已选 {n}/{m}': '{n}/{m} selected',
  清除全部: 'Clear all',
  '搜索{name}': 'Search {name}',
  '清除{name}筛选': 'Clear {name} filter',
  本作用域内没有可选的仓库: 'No repositories available in this scope',
  本作用域内没有可选的类型: 'No types available in this scope',
  '没有与“{q}”匹配的选项': 'No options match “{q}”',
  '筛选生效：{summary}': 'Filters active: {summary}',

  // —— #485 Agent 详情编辑面（三 tab + 概览字段 + 记忆/权限面）——
  // 含空格/标点的键一律引号形（对象字面量的键不是标识符）。
  概览: 'Overview',
  权限: 'Permissions',
  职责: 'Responsibility',
  工具: 'Tools',
  // 模型 已在 #476 段登记，本段不重复。
  思考强度: 'Thinking level',
  // 「状态」键随 XMON-18 撤行一并摘除（概览不再摆状态行，en-coverage gate 也不
  // 容许死键）。
  未设置模型: 'No model',
  '默认 skill': 'Default skill',
  '找不到该 Agent。它可能已被删除。': 'Agent not found. It may have been deleted.',
  // 概览「进行中」段空态（原文 = 参考产品 web 包 agent_modal.no_active_tasks）。
  暂无进行中的任务: 'No active tasks',
  '暂无团队密钥。': 'No team secrets yet.',
  // XMON-80/P3：零密钥空态旁的出口（落到侧栏密钥页）。
  去添加密钥: 'Add a secret',
  // XMON-80/P2：权限 tab 保存失败的可见反馈。
  '保存失败，请重试。': 'Save failed. Try again.',
  // #1251 机器匹配段（权限 tab 第五组：执行要求写面 + 「哪些机器可跑它」读面）。
  机器匹配: 'Machine fit',
  '执行要求 = 派发硬闸：能力快照不满足的机器不领该 Agent 的步（排队面会给可见成因）；从未上报快照的机器按可跑放行。':
    'Execution requirements are a hard dispatch gate: machines whose capability snapshot does not satisfy them never claim this agent’s steps (the queue shows a visible reason); machines that never reported a snapshot are let through.',
  '要求执行机已安装该 MCP 服务器': 'Require this MCP server installed on the executing machine',
  '要求安装 {name}': 'Require {name} installed',
  离线: 'Offline',
  '未开启该 Agent 所需的 runtime': 'Required runtime not enabled for this agent',
  '缺 {missing}（在该机装齐即解锁）': 'Missing {missing} (install on that machine to unlock)',
  '能力快照未上报——按可跑放行': 'Capability snapshot not reported — treated as runnable',
  '可跑；声明的 MCP 缺 {gaps}（执行时跳过）':
    'Runnable; declared MCP missing {gaps} (skipped at runtime)',
  可跑: 'Runnable',
  不可跑: 'Not runnable',
  '暂无机器。': 'No machines yet.',
  // XMON-113：机器行 shell 开关的副文案（机器侧半边；{tool} 插值 = 上面那条
  // AGENT_TOOL_SHELL 的 en 值，两层开关共用同一词）。
  '已授权「{tool}」的 Agent 可在该机器上执行命令。':
    'Agents you have granted {tool} to can run commands on this machine.',
  // #895 机器页三态读标注（spec 21 A8；orchestration 块 join 行集）+ chief
  // 设置 Agent tab「机器」槽的描述（A6）。徽标/状态 = 机器与总管编排的
  // 关系面，非机器自身状态。
  总管主机: 'Chief host',
  总管回合进行中: 'Chief turn in progress',
  总管等待机器: 'Chief waiting for machine',
  '暂无 MCP 服务器。': 'No MCP servers yet.',
  团队密钥: 'Team secrets',
  // #1169 授权技能段（权限 tab）：不限制（null）与限制后全不勾（[] = 显式
  // 全拒）两态互转；逐技能勾选行只在限制态渲染。
  授权技能: 'Skill access',
  不限制: 'Unrestricted',
  '该 Agent 执行任务时可读取的团队技能范围。开启「不限制」= 全量可读；关闭后仅勾选的技能可读，未勾选一律拒绝——「不限制」与全不勾是两种状态，可随时互转。':
    'Which team skills this Agent may read. Unrestricted reads everything; once restricted, only the checked skills are readable and every unchecked one is denied. Unrestricted and nothing-checked are two different states, switchable either way.',
  // shared canon（packages/shared/src/records/agent.ts、memory.ts），经 t()
  // 消费、不作字面量出现——i18n-coverage COMPUTED_KEYS 登记。
  '远程 shell': 'Remote shell',
  合并分支: 'Merge branches',
  创建标签: 'Create tags',
  推送分支: 'Push branches',
  创建技能: 'Create skills',
  更新技能: 'Update skills',
  运行时: 'Runtime',
  '内置 (pi)': 'Built-in (pi)',
  '允许该 Agent 在团队中已开启 shell 访问的机器上执行命令。':
    'Allow this Agent to run commands on machines where shell access is enabled for the team.',
  '允许该 Agent 通过合并分支进行发布（例如将 develop 合并进 main）。':
    'Let this Agent publish by merging branches (for example develop into main).',
  '允许该 Agent 创建 git tag，这可能触发发布流程。':
    'Let this Agent create git tags, which may trigger a release pipeline.',
  '允许该 Agent 随时提交并推送其工作分支（自行合并发布改动时需要）。':
    'Let this Agent commit and push its working branch at any time (needed when it merges release changes itself).',
  '允许该 Agent 向团队技能库添加新技能。':
    'Let this Agent add new skills to the team skill library.',
  '允许该 Agent 修改团队技能库中已有的技能。':
    'Let this Agent modify skills already in the team skill library.',
  '任务执行时，该 Agent 可在需要密钥的执行步中按需取用团队密钥，每次取用都会留下记录；密钥不预置进 shell 环境。所在机器需要 cairn CLI 0.1.28 及以上。':
    'When running a task, this Agent can retrieve team secrets on demand in the execution steps that need them; every retrieval is recorded, and secrets are never preloaded into the shell environment. The machine must have cairn CLI 0.1.28 or newer.',
  '该 Agent 执行任务时可使用的团队 MCP 服务器，其工具以 mcp__<服务器>__<工具> 的形式出现。':
    'Team MCP servers this Agent may use while running tasks; their tools appear as mcp__<server>__<tool>.',
  '说明该 Agent 的常驻职责，可多行。该说明会注入它执行的每个任务的系统提示词，也会提供给总管用于分派。':
    'Describe the Agent’s ongoing responsibility — multi-line OK. The text is injected into the system prompt of every task it runs and is given to the chief for dispatch.',
  '该 Agent 执行任何任务时自动携带的团队技能，无需在消息中 @ 引用。':
    'The team skill this Agent always carries, without an @ mention in the message.',
  '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。':
    'No memories yet. The Agent stores experience worth keeping here as it works.',

  // —— #499 记忆 tab 的搜索与排序（配额头 + 搜索框 + 排序档）——
  // `记忆 · {n} / {max}`：{max} = shared MEMORY_QUOTA_PER_AGENT 插值，不写死
  // 数字；`搜索记忆…` = shared MEMORY_UI_COPY.searchPlaceholder（经 t() 消费、
  // 不作字面量出现，i18n-coverage COMPUTED_KEYS 登记）。
  '记忆 · {n} / {max}': 'Memory · {n} / {max}',
  '搜索记忆…': 'Search memories…',
  // 排序第二档（[设计]，见 agent-detail-page.tsx 的 MEMORY_SORT_OPTIONS）。
  添加时间: 'Added',
  // 记忆 tab 空态（标题 + 说明）与零命中态：搜不到不等于没存过。
  尚无记忆: 'No memories yet',
  'Agent 会在工作中将值得沉淀的经验存入此处。':
    'The Agent stores experience worth keeping here as it works.',
  没有匹配的记忆: 'No memories match',
  '换个关键词再试。': 'Try another search term.',
  // —— #631 总管对话失败闭环（sonner toast + 线程失败行）——
  总管本轮执行失败: 'The chief turn failed',
  '发送失败，请重试。': 'Send failed. Try again.',
  '恢复失败，请重试。': 'Restore failed. Try again.',
  // —— #774 收单回落显式告知（成功 toast，非失败面；用户裁决静默不要）——
  // —— #729 附件上传失败面（toast 家族同上；大小/类型拒是本地预检可自救，
  // 各给专名，其余归通用失败）——
  '附件超过 10MB 上限': 'Attachment exceeds the 10 MB limit',
  不支持该文件类型: 'That file type is not supported',
  附件上传失败: 'Attachment upload failed',
  // —— #757 composer 附件 strip（在途占位 + 落定 chip，同面中文键）——
  附件: 'Attachments',
  上传中: 'Uploading',
  // —— #640 开始任务单出口（直发总管编排回合；r14 §5.7 前置裁决落地）——
  由总管创建: 'Created by chief',
  来源: 'Source',
  总管编排会话: 'Chief orchestration session',
  '这张任务将交给总管重新编排。': 'The chief will re-orchestrate this task.',
  已交给总管编排: 'Handed to the chief',
  '已保存，交给总管编排': 'Saved — handed to the chief',
  '总管将直接规划，并按活的类型派发执行。':
    'The chief plans first, then dispatches each piece to the right agent.',
  查看会话: 'View session',
  未能开始编排: 'Could not start orchestration',
  // —— #1216 在飞编排态（开始/重跑的可见反馈）与详情缺失三态 ——
  编排中: 'Orchestrating',
  '上下文超出模型上限，精简任务后重试': 'Context exceeds the model limit; trim the task and retry',
  '额度不足或请求太频繁，稍后重试': 'Out of quota or rate limited; retry later',
  '模型服务鉴权失败，检查密钥': 'Model provider rejected the credentials; check the key',
  '连接中断，可以重试': 'Connection dropped; retry',
  '请求超时，可以重试': 'Request timed out; retry',
  '模型服务暂时不可用，可以重试': 'Model provider is unavailable; retry',
  '出了点问题，可以重试或查看会话': 'Something went wrong; retry or open the thread',
  编排失败: 'Orchestration failed',
  '等 {machine} 上线': 'waiting for {machine} to come online',
  等机器上线: 'waiting for a machine to come online',
  '缺 {missing}': 'missing {missing}',
  排队中: 'queued',
  '总管正在编排这张任务，等这一轮结束再发起。':
    'The chief is already orchestrating this task — wait for this round to finish.',
  '重复发起只会多排一轮编排，不会更快开始。':
    'Firing again only queues one more orchestration round; it will not start sooner.',
  任务加载失败: 'Failed to load the task',
  任务不存在或已被删除: 'This task does not exist or was deleted',
  回看板: 'Back to board',
  // —— #638 全站静默 mutation 失败面接线（toast 标题句；server 原因进
  // description 透传不译，#631 同律。已有面内 canon 位的面——merge 拒绝行 /
  // issue 导入内联 / fs-pick 提示行 / OAuth 内联 / 技能弹窗内联——不在此列）——
  '新建任务失败，请重试。': 'Could not create the task. Try again.',
  '创建项目失败，请重试。': 'Could not create the project. Try again.',
  '移动任务失败，请重试。': 'Could not move the task. Try again.',
  '重置任务失败，请重试。': 'Could not reset the task. Try again.',
  '关闭任务失败，请重试。': 'Could not close the task. Try again.',
  '删除任务失败，请重试。': 'Could not delete the task. Try again.',
  '开始运行失败，请重试。': 'Could not start the build. Try again.',
  '重试失败，请稍后再试。': 'Retry failed. Try again later.',
  '新建定时失败，请重试。': 'Could not create the schedule. Try again.',
  '删除定时失败，请重试。': 'Could not delete the schedule. Try again.',
  '删除项目失败，请重试。': 'Could not delete the project. Try again.',
  '断开连接失败，请重试。': 'Could not disconnect. Try again.',
  '添加模型服务失败，请重试。': 'Could not add the provider. Try again.',
  '添加密钥失败，请重试。': 'Could not add the secret. Try again.',
  '新建 API 密钥失败，请重试。': 'Could not create the API key. Try again.',
  '创建 Agent 失败，请重试。': 'Could not create the agent. Try again.',
  '删除 Agent 失败，请重试。': 'Could not delete the agent. Try again.',
  '删除记忆失败，请重试。': 'Could not delete the memory. Try again.',
  '同步失败，请重试。': 'Sync failed. Try again.',
  总管提问: 'Chief question',
  等你回答: 'Awaiting your answer',
  已回答: 'Answered',
  取消提问: 'Dismiss question',
  提交回答: 'Submit answers',
  输入你的回答: 'Type your answer',
  '其他…': 'Other…',
  '数字键 1–{n} 选择': 'Press 1–{n} to choose',
  '已选 {n} 项': '{n} selected',
  未选: 'None selected',
  上一步: 'Back',
  下一步: 'Next',
  '提交回答失败，请重试。': 'Could not submit your answers. Try again.',
  '取消提问失败，请重试。': 'Could not dismiss the question. Try again.',
  备用模型: 'Fallback models',
  '主模型额度用完、模型 404 或认证失败时，按顺序换到下一个可用备选。只有规划和执行步会换；审核、验证、合并、总管不换；限流不换。':
    'When the primary model runs out of quota, returns 404 or fails authentication, the next usable fallback takes over in order. Only plan and build steps switch; review, verify, merge and chief never do; rate limits do not trigger a switch.',
  '备用 {n}': 'Fallback {n}',
  '备用 {n} 运行时': 'Fallback {n} runtime',
  '备用 {n} 模型': 'Fallback {n} model',
  '上移备用 {n}': 'Move fallback {n} up',
  '下移备用 {n}': 'Move fallback {n} down',
  '删除备用 {n}': 'Remove fallback {n}',
  添加备用模型: 'Add fallback model',
  选择运行时: 'Choose runtime',
  选完模型后才会保存: 'Saved once a model is chosen',
  当前可选列表里没有该模型: 'This model is not in the current list',
  '已下架，运行时会跳过该备选': 'Delisted; this fallback is skipped at run time',
  '归属机 {machine} 未开启 {runtime} runtime，运行时会跳过该备选':
    'Home machine {machine} has the {runtime} runtime off; this fallback is skipped at run time',
};
