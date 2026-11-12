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
  订阅账户没能加载: 'Subscriptions could not be loaded',
  '路由对所有机器生效，{name} 沿用所有机器的设置。':
    'Routing applies to all machines, including {name}.',
  移除订阅: 'Remove subscription',
  '移除后，后续步骤不再使用这个订阅。':
    'After removal, later steps no longer use this subscription.',
  '登录已失效，请重新生成令牌后再添加':
    'The login is no longer valid. Generate a new token and add it again.',
  '验证超时，请重试': 'Verification timed out. Try again.',
  '服务器上找不到 claude 命令': 'The claude command was not found on the server.',
  '验证没有通过，请重试': 'Verification did not pass. Try again.',
  '连接中断，服务器可能正在重启，请重试':
    'The connection dropped; the server may be restarting. Try again.',
  '验证太频繁，请 10 秒后重试': 'Verifying too often. Try again in 10 seconds.',
  验证失败: 'Verification failed',
  '令牌已过期，请重新添加': 'The token has expired. Add it again.',
  使用: 'Usage',
  '24 小时步骤': 'Steps in 24 hours',
  Archive: 'Archive',
  'Could not unarchive task.': 'Could not unarchive task.',
  'Could not archive task.': 'Could not archive task.',
  '{name}: Claude subscription token expired. Run `claude setup-token` and add a new connection.':
    '{name}: Claude subscription token expired. Run `claude setup-token` and add a new connection.',
  '{name}: Claude subscription token expires in {days} days. Run `claude setup-token` and add a new connection.':
    '{name}: Claude subscription token expires in {days## day|# days}. Run `claude setup-token` and add a new connection.',
  Archived: 'Archived',
  Agent: 'Agent',

  '思考 {n} 次': 'Thought {n#once|# times}',
  '读了 {n} 个文件': 'Read {n#1 file|# files}',
  '{n} 行未改动': '{n#1 unmodified line|# unmodified lines}',
  '搜索 {n} 次': 'Searched {n#once|# times}',
  '跑了 {n} 条命令': 'Ran {n#1 command|# commands}',
  '改了 {n} 个文件': 'Edited {n#1 file|# files}',
  '推送 {n} 次': 'Pushed {n#once|# times}',
  '调用 {n} 个工具': 'Called {n#1 tool|# tools}',
  准备了工作区: 'Prepared the workspace',
  正在准备工作区: 'Preparing the workspace',
  正在思考: 'Thinking',
  正在回复: 'Replying',
  正在查看项目: 'Looking through the project',
  正在运行命令: 'Running a command',
  正在创建任务: 'Creating a task',
  等你确认: 'Waiting for you',
  出错了: 'Something went wrong',
  等待电脑上线: 'Waiting for the computer',
  等待恢复: 'Waiting to resume',
  '正在读 {n} 个文件': 'Reading {n#1 file|# files}',
  '正在搜索 {n} 次': 'Searching {n#once|# times}',
  '正在跑 {n} 条命令': 'Running {n#1 command|# commands}',
  '正在改 {n} 个文件': 'Editing {n#1 file|# files}',
  正在推送: 'Pushing',
  '正在调用 {n} 个工具': 'Calling {n#1 tool|# tools}',
  '（{n} 个失败）': '({n} failed)',
  '已工作 {n} 分钟': 'Worked for {n#1 minute|# minutes}',
  '工作中 · {time}': 'Working · {time}',
  思考了: 'Thought',
  读取了: 'Read',
  搜索了: 'Searched',
  运行了: 'Ran',
  修改了: 'Edited',
  推送了: 'Pushed',
  调用了: 'Called',
  准备了: 'Prepared',
  正在读取: 'Reading',
  正在搜索: 'Searching',
  正在运行: 'Running',
  正在修改: 'Editing',
  正在准备: 'Preparing',
  '已加载 {n} 个技能': 'Skills loaded: {n}',
  '还有 {n} 行': '{n## more line|# more lines}',
  无输出: 'No output',
  '本步异常结束：{reason}': 'This step ended abnormally: {reason}',
  '改动 {n} 个文件': 'Changed {n#1 file|# files}',
  '提交 {shas}': 'Commit {shas}',
  'PR #{n}': 'PR #{n}',
  '未开 PR': 'No PR',
  'git 凭据': 'git credentials',
  'integration：每步下发的 token': 'integration: a token issued for each step',
  'machine：执行机本机的 git 凭据': "machine: the executor machine's own git credentials",
  未完成: 'Not finished',

  // —— shared chrome / sidebar (r2 §1.1) ——
  搜索: 'Search',
  // #351 看板更名工作台：'Workbench'（不用 'Workspace'，避撞 daemon workspaces 概念）
  工作台: 'Workbench',
  // Paper 顶栏等你处理摘要：数字单独着色，后接本串（「3 项等你处理」→「3 waiting on you」）
  '{greeting}，{name}': '{greeting}, {name}',
  夜深了: 'Good night',
  早上好: 'Good morning',
  中午好: 'Good afternoon',
  下午好: 'Good afternoon',
  晚上好: 'Good evening',
  '，': ', ',
  '{n} 项待你处理': '{n} waiting on you',
  换项目: 'Move project',
  已转给任务: 'Passed to task',
  已建任务: 'Created task',
  '任务 #{n} {title}：{status}': 'Task #{n} {title}: {status}',
  审阅中: 'In review',
  定时: 'Schedules',
  '执行中 {n}': '{n} running',
  项目: 'Project', // sidebar group / search group / schedule-form field — one fit
  Coordinator: 'Coordinator',
  成果: 'Made',
  电脑: 'Computers',
  '在线 · {n}/{max} 在跑': 'Online · {n}/{max} running',
  '在线 · {n} 在跑': 'Online · {n} running',
  '在线 · 空闲': 'Online · idle',
  '{n} 在跑': '{n} running',
  已安装: 'Installed',
  '未开启桌面控制，开启后这里显示屏幕':
    'Desktop control is off; the screen shows here once it is on',
  '桌面控制已上线，屏幕显示在这里': 'Desktop control is online; the screen shows here',
  正在连接屏幕: 'Connecting to the screen',
  屏幕暂时连不上: 'The screen could not connect',
  出错: 'Error',
  这一块出错了: 'This part failed',
  '页面其余部分还在，重试会重新打开这一块。':
    'The rest of the page is still here. Retry opens this part again.',
  开着: 'On',
  正在开机: 'Starting up',
  关着: 'Off',
  中断: 'Interrupted',
  终端: 'Terminal',
  我的电脑: 'My computer',
  写文件: 'Write file',
  启动应用: 'Launch app',
  '退出码 {n}': 'exit {n}',
  命令记录: 'Command log',
  '还没有命令。Coordinator 在这台电脑上跑的命令会出现在这里。':
    'No commands yet. Commands the Coordinator runs on this computer show up here.',
  'Coordinator 的电脑': "Coordinator's computer",
  'Coordinator 还没有自己的电脑。第一次需要时会自动开一台。':
    'The Coordinator has no computer of its own yet. One opens the first time it needs one.',
  '这台机器还没有电脑记录，等桌面控制上线后才能在这里打开。':
    'This machine has no computer record yet. Desktop control can open here once it comes online.',
  电脑离线: 'Computer offline',
  'Coordinator 在这台': 'Coordinator runs here',
  桌面控制: 'Desktop control',
  放大屏幕: 'Enlarge screen',
  屏幕已放大: 'Screen is enlarged',
  在大屏里点击和键入: 'Click and type in the enlarged screen',
  打开桌面控制后再操作: 'Turn on desktop control to click and type',
  '由你接管这台电脑的桌面，在大屏里点击和键入。打开期间 agent 不能操作桌面上的应用，关掉后恢复。':
    'You take over this computer’s desktop and click and type in the large view. While it is on, the agent cannot operate desktop apps; turning it off lets it resume.',
  浏览器: 'Browser',
  '让 agent 打开网页、点击和填表。': 'Lets agents open pages, click and fill forms.',
  '这台机器还不支持浏览器。': 'This machine does not support the browser yet.',
  '这台机器已不再报告浏览器能力；可关闭已保存的偏好。':
    'This machine no longer reports browser capability; you can turn off the saved preference.',
  '浏览器偏好已绑定到另一台机器。': 'The browser preference is already bound to another machine.',
  '没有其他电脑时，任务都在 Coordinator 这台电脑上跑。':
    'With no other computer, work runs on the Coordinator’s computer.',
  添加电脑: 'Add computer',
  你的电脑: 'Your computers',
  '{time} 检查过': 'Checked {time}',
  再检查一次: 'Check again',
  所有电脑: 'All computers',
  在进行: 'In progress',
  等你处理: 'Needs you',
  管理定时: 'Manage schedules',
  接下来: 'Up next',
  已暂停: 'Paused',
  本周合并: 'Merged this week',
  全团队: 'Whole team',
  '仅 {name}': 'Only {name}',
  '项目密钥只发给该项目的 thread，同名时优先于团队密钥。':
    'Project secrets go only to threads in that project and override a team secret with the same name.',
  并发与优先级: 'Concurrency and priority',
  '不限（跟随机器上限）': 'No limit (machine limits apply)',
  '串行，一次一个': 'Serial, one at a time',
  '最多 {n} 个': 'Up to {n}',
  '本项目同时运行的 thread 上限。你发的消息会插队，并可多用一个位置。':
    'How many threads in this project run at once. Your own messages go first and may use one extra slot.',
  项目说明: 'Instructions',
  项目记忆: 'Project memory',
  定时任务: 'Schedules',
  没有定时任务: 'No schedules',
  项目主页: 'Project home',
  '问 Coordinator 关于 {name} 的事…': 'Ask the Coordinator about {name}…',
  '这个项目还没有 thread': 'No threads in this project yet',
  '在上面问 Coordinator，它会开 thread 来做。':
    'Ask the Coordinator above and it will open threads for the work.',
  '还没有项目说明。写在这里的规则会被本项目的每个 thread 和 Coordinator 读到。':
    'No instructions yet. Every thread and the Coordinator in this project will read the rules written here.',
  'Coordinator 在本项目学到的事会记在这里，默认只在本项目内使用。即将上线。':
    'What the Coordinator learns in this project will be kept here, used only in this project by default. Coming soon.',
  目前用团队密钥: 'Team secrets for now',
  目前跟随机器上限: 'Machine limits for now',
  保存项目说明: 'Save instructions',
  '例如：仓库内容用英文；改动后跑 pnpm lint；不要 force push。':
    'For example: repository content is English; run pnpm lint after changes; never force push.',
  '项目说明保存失败，请重试。': 'Could not save the instructions. Try again.',
  没有在进行的任务: 'Nothing in progress',
  没有空闲的任务: 'Nothing idle',
  还没有完成的工作: 'Nothing finished yet',
  '任务合并完成后会出现在这里。': 'Tasks show up here once they merge.',
  新建项目: 'New project',
  接入模型来源: 'Connect a model source',
  '添加模型服务商，或在机器上登录 Claude Code':
    'Add a provider, or sign in to Claude Code on a machine',
  连接一台机器: 'Connect a machine',
  运行: 'Run',
  连接这台机器: 'to connect this machine',
  'Coordinator 还不能回答': 'The Coordinator cannot answer yet',
  '点输入框下方的按钮，把模型来源、机器和 Coordinator 接上，再发一次。':
    'Use the button below the box to connect a model source, a machine and the Coordinator, then send again.',

  '{n} 分': '{n}m',
  '{n} 小时': '{n}h',
  '{n} 天': '{n}d',
  归档: 'Archive',
  '{name} 的菜单': '{name} menu',
  '无法归档项目。': 'Could not archive the project.',
  '已归档「{title}」': 'Archived "{title}"',
  '无法撤销归档。': 'Could not undo the archive.',
  '无法移动项目。': 'Could not move the project.',
  有任务在等你: 'A task is waiting on you',
  '{name}：有任务在等你': '{name}: A task is waiting on you',
  移到分组: 'Move to group',
  新建分组: 'New group',
  移出分组: 'Remove from group',
  分组名称: 'Group name',
  移入: 'Move',
  新任务: 'New task', // sidebar action row (#389) — the dialog title stays 新建任务
  看板: 'Board',
  技能: 'Skills',
  密钥: 'Secrets',
  机器: 'Machines',
  模型服务: 'Providers',
  用量: 'Usage',
  收起侧边栏: 'Collapse sidebar',
  展开侧边栏: 'Expand sidebar',
  侧边栏: 'Sidebar',
  返回: 'Back',
  更多: 'More',
  关闭: 'Close',
  滚动到最新: 'Scroll to latest',
  取消: 'Cancel',
  保存: 'Save',
  删除: 'Delete',
  今天: 'today',

  // —— board surface (r2 §4.1, r7 01/02; #351 6→4 列收敛) ——
  任务: 'Tasks',
  待开始: 'To start',
  // 规划中 survives as the planning phase chip (detail header), not a column
  规划中: 'Planning',
  执行中: 'Running',
  已完成: 'Done',
  暂无: 'None',
  审阅: 'Review',
  回复: 'Reply',
  选中文字的操作: 'Selection actions',
  移除引用: 'Remove quote',
  方案: 'Plan',
  分支: 'Branch',
  变更: 'Changes',
  // 看板顶部通知引导条 (issue #114): components consume the shared
  // NOTIFICATION_BANNER_COPY canon — these keys match its zh values
  // verbatim (i18n-coverage liveness via COMPUTED_KEYS)
  浏览器通知未开启: 'Browser notifications are off',
  '标签页切换到后台时，通过桌面通知提醒你。':
    'Get a desktop reminder when this tab is in the background.',
  开启: 'Turn on',

  // —— phase chips / actions / placeholders (phase.ts canon table) ——
  确认: 'Confirm',
  审核: 'Review',
  开始: 'Start',
  完成: 'Complete',
  重开: 'Reopen',
  '向 Agent 补充说明，执行过程中即可送达':
    'Add details for the Agent — delivered while the run is in progress',
  '发送消息以继续这个任务…': 'Send a message to continue this task…',
  '请求修改…': 'Request changes…',
  // #701 审核关口人肉打回（更多菜单入口 + reject 弹层）
  请求修改: 'Request changes',

  // —— relative time (rel-time.ts; compact en forms avoid plural logic) ——
  刚刚: 'just now',
  '{n} 分钟前': '{n}m ago',
  '{n} 小时前': '{n}h ago',
  昨天: 'yesterday',
  '今天 {time}': 'Today {time}',
  '昨天 {time}': 'Yesterday {time}',
  '{n} 天前': '{n}d ago',

  // —— todo detail (r7 §3.3–§3.6) ——
  运行历史: 'Run history',
  打开方案: 'Open plan',
  添加附件: 'Add attachment',
  '上下文 {percent}%（示意）': 'Context {percent}% (mock)',
  '上下文 {percent}%': 'Context {percent}%',
  暖: 'Warm',
  冷·将精简: 'Cold · will slim',
  已压实: 'Compacted',
  '{state} · {percent}%（示意）': '{state} · {percent}% (mock)',
  '{state} · {percent}%': '{state} · {percent}%',
  '移除附件：{name}': 'Remove attachment, {name}',
  上传失败: 'Upload failed',
  松开即可添加附件: 'Drop to attach',
  下载: 'Download',
  已复制: 'Copied',
  '没能复制，再试一次': 'Could not copy. Try again',
  正在加载文件: 'Loading the file',
  文件没能加载: 'The file did not load',
  '无法预览，下载查看': 'No preview. Download to view',
  '图片没能加载，下载查看': 'The image did not load. Download to view',
  '只显示前 {n} 行，下载查看完整文件': 'Showing lines 1 to {n}. Download for the full file',
  '此任务为只读，请在实时工作区中打开后继续。':
    'This task is read only. Open it in the live workspace to continue.',
  提及: 'Mention',
  停止: 'Stop',
  丢弃修改: 'Discard changes',
  '取消失败，请重试。': 'Failed to cancel. Try again.',
  编辑排队消息: 'Edit queued message',
  取消编辑: 'Cancel edit',
  '回车保存 · Esc 取消': 'Enter to save · Esc to cancel',
  '这条排队消息已经发出，改动没有生效':
    'That queued message was already sent; your edit was not applied',
  '丢弃本轮修改？': 'Discard this round’s changes?',
  // #1250（ADR 0018 层 1）verify 步状态与 fan-out 面。
  验证中: 'Verifying',
  验证通过: 'Verification passed',
  验证未通过: 'Verification failed',
  // #731 `/` slash completion vocabulary (zh keys, en values).
  命令: 'Commands',
  '没有匹配"/{query}"的命令': 'No commands match "/{query}"',
  清空输入: 'Clear the input',
  已清空: 'Cleared',
  '发起 AI 审核': 'Start an AI review',
  停止当前运行: 'Stop the current run',
  查看命令说明: 'Show command help',
  命令说明: 'Command help',
  '团队技能来自技能页面（共 {count} 个）': 'Team skills come from the Skills page ({count} total)',
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
  '正在停止…': 'Stopping…',
  已取消: 'Canceled',
  发送: 'Send',
  暂无方案: 'No plan yet',
  暂无可显示的变更: 'No changes to show',
  '{n} 个文件改动': 'Files changed: {n}',
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
  尚无描述: 'No description yet',

  账号: 'Account',
  'API 密钥': 'API keys',
  外观: 'Appearance',
  浅色: 'Light',
  深色: 'Dark',

  // —— account / agent settings list ——
  编辑名称: 'Edit name',
  '任务需要你处理时，在系统通知中心提醒':
    'Notify you in the system notification center when a task needs you',

  // —— chip popover / plan dropdown (r7 19/20/29) ——
  确认方案: 'Confirm plan',
  构建中: 'Building',
  移回待开始: 'Move back to To start',
  标记为已完成: 'Mark done',
  '点击开始后，Agent 会先写方案。': 'The agent writes a plan first once you start.',
  '排队中，轮到它时会自动开始。': 'Queued. It starts on its own when its turn comes.',
  '方案写好后，Agent 会把它移到确认方案。':
    'The agent moves it to Confirm plan when the plan is ready.',
  '你确认方案后，Agent 开始构建。': 'The agent starts building once you confirm the plan.',
  '构建完成后，Agent 会把它移到审核。': 'The agent moves it to Review when the build is done.',
  '审核无误后，你可以把它标记为已完成。': 'Mark it done once the review looks right.',
  '它在等一个问题的回答，回答后会在同一个会话里继续。':
    'It is waiting for an answer to its question; once answered it continues in the same session.',
  待回答: 'Needs input',
  '回答它的问题…': 'Answer its question…',
  '任务已完成，发送消息即可继续。': 'The task is done. Send a message to continue.',
  '这次运行失败了，可以重跑，或移回待开始。':
    'This run failed. Rerun it, or move it back to To start.',
  '任务已取消。': 'The task was cancelled.',
  面板视图: 'Pane view',

  // —— ⌘K search panel (r7 05/05b, r2 §8.4) ——
  '搜索任务、项目…': 'Search todos, projects…',
  最近: 'Recent',
  '{dir} 里的仓库': 'Repositories in {dir}',
  查找文件夹或粘贴路径: 'Find a folder or paste a path',
  '查找文件夹或粘贴路径…': 'Find a folder or paste a path…',
  '使用 {path}': 'Use {path}',
  还没有用过的文件夹: 'No folders used yet',
  没有匹配的文件夹: 'No matching folders',
  '浏览文件夹…': 'Browse folders…',
  返回列表: 'Back to the list',
  这个任务: 'This task',
  '输入命令或搜索…': 'Type a command or search…',
  移动: 'Move',
  移除上下文: 'Drop context',
  '更多操作…': 'More actions…',
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
  // #1037 fixture 模式自我声明 chip（api/provider.tsx）
  '示例数据（scenario {id}）': 'Sample data (scenario {id})',
  演示数据: 'Demo data',
  '只读演示，改动不会被保存。': 'Read-only demo — changes are not saved.',
  官网: 'Website',
  闭环录像: 'Closed-loop video',
  '这是演示数据，改动不会保存': 'Demo data: changes are not saved',
  还没有定时任务: 'No schedules yet',
  '按周期或在指定时间自动重新运行任务。每一轮都会依据任务描述从头开始一次全新运行，到达确认或审核关口时暂停，交由负责人接手。':
    'Automatically rerun a task on a cycle or at a chosen time. Every round starts a fresh run from the task description, pausing at the confirm or review gate for the owner to pick up.',
  '也可以直接告诉 Coordinator 某个任务要多久重跑一次，它会替你写好规则。':
    'You can also just tell the Coordinator how often a task should rerun, and it will write the rule for you.',

  // —— account route (r7 13) ——
  更换: 'Change',
  名称: 'Name',
  语言: 'Language',
  推送通知: 'Push notifications',
  在这台设备上接收推送: 'Push on this device',
  '需要你决定时立即推送，其余进展并入每日两次简报，锁屏也能收到':
    'Push immediately when a decision is needed; everything else lands in the twice-daily digest — even on the lock screen',
  '首个 PR': 'First PR',
  人工共同作者署名: 'Human co-author trailers',
  '团队设置，默认开启。在人工发起的任务提交中添加共同作者署名。':
    'Team setting, on by default. Credit the human who instructed the work in commit trailers.',
  邀请任务发起人审阅: 'Request instructor review',
  '团队设置，默认关闭。在 PR 上邀请人工发起人审阅。':
    'Team setting, off by default. Request PR review from the human who instructed the work.',
  '首个 PR 社区提示': 'First-PR community prompt',
  '团队设置，默认关闭。首个 PR 完成后显示分享链接，由你决定是否在 GitHub 发布。':
    'Team setting, off by default. Show a sharing link after the first PR succeeds; you decide whether to post on GitHub.',
  '首个 PR 已合并': 'Your first PR merged',
  '可以在 GitHub Discussions 发一条帖子，说明第一支 PR 用了多久':
    'You can post in GitHub Discussions to say how long the first PR took',
  '第一支 PR 用了 {days} 天。可以在 GitHub Discussions 发一条帖子':
    'Your first PR took {days## day|# days}. You can post about it in GitHub Discussions',
  '分享到 Discussions': 'Share on Discussions',
  不再显示: 'Do not show again',
  // #1031: the switch is a preference; when it's on but the browser permission
  // is denied, the row explains why nothing will actually fire.
  '浏览器已拒绝通知权限，需到站点设置重新允许':
    'Notifications are blocked by the browser — re-allow them in site settings',

  // —— team route (r7 12) ——
  设置: 'Settings',
  // team empty state, grid and chart (r2 §8.1 17c title)
  ' · 默认': ' · Default',
  未配置模型: 'No model configured',

  // —— api-keys route (r2 19, 02 §8 canon note) ——
  '尚无 API 密钥': 'No API keys yet',
  'API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的工作台。':
    'API keys connect machines from the command line and let MCP clients reach your workbench.',
  新建密钥: 'New key',
  复制: 'Copy',
  展开: 'Expand',
  '回复：{quote}': 'Replying to: {quote}',
  回复这条消息: 'Reply to this message',
  代码: 'Code',
  '{lang} 代码': '{lang} code',
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
  尚无技能: 'No skills yet',
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
  '尚无 MCP 服务器': 'No MCP servers yet',
  // spec 13/#368 本地 config 只读制：空态文案 = 配置指引（无添加钮）。
  '读取 server 本机 ~/.claude.json 的 mcpServers 段：在该文件添加配置并刷新，即出现在这里。MCP 服务器为 Agent 提供额外工具；授权在每个 Agent 的页面上单独进行。':
    'Reads the mcpServers section of ~/.claude.json on the cairn server machine — add entries there and refresh to see them here. MCP servers give Agents extra tools; authorization happens per Agent, on its own page.',
  尚无密钥: 'No secrets yet',
  '团队密钥按 Agent 授权，在需要它的执行步中下发，不预置进任务 shell 环境。值只写不读：保存后只能覆盖或删除，无法再次查看。':
    'Team secrets are granted per Agent and released to the build steps that need them — never pre-set into the task shell environment. Values are write-only: once saved they can be overwritten or deleted, never viewed again.',
  添加密钥: 'Add secret',
  '也可以让 Coordinator 添加：它会开一张安全输入卡填写值，值不会进入对话。':
    'The Coordinator can add them too: it opens a secure input card for the value, which never enters the conversation.',
  个文件: 'file(s)',
  描述: 'Description',

  // —— project routes (r2 07/24/24b/24c) ——
  文件: 'Files',
  历史: 'History',
  '1 次运行': '1 run',
  '{n} 次运行': '{n## run|# runs}',
  根目录: 'Root',
  '搜索任务…': 'Search todos…',
  搜索任务: 'Search todos',
  筛选: 'Filter',
  列表视图: 'List view',
  网格视图: 'Grid view',
  暂无内容: 'Nothing yet',
  '创建第一个任务以开始使用。': 'Create your first todo to get started.',
  // #446（ADR 0005 读向）项目页「从 GitHub issue 建任务」入口 + 选择弹层
  // （状态过滤 / 分页 / 三态行）。
  '从 GitHub issue 建任务': 'New task from GitHub issue',
  打开: 'Open',
  已关闭: 'Closed',
  '运行失败了，先重跑才能完成': 'The run failed; rerun it before marking it done',
  '已归档，不能标记完成': 'Archived, so it cannot be marked done',
  'Coordinator 在问你，到对话里回答':
    'A question from the Coordinator; answer it in the conversation',
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
  模型: 'Model',
  接入机器: 'Connect a machine',
  在线: 'Online',
  '迁移到…': 'Migrate to…',
  迁移到: 'Migrate to',
  整机迁移: 'Migrate all agents',
  状态: 'Status',
  删除机器: 'Delete machine',
  '删除后，这台机器要重新注册才能再接任务':
    'Once deleted, the machine has to enroll again before it takes work',
  '确定删除这台机器？此操作不可撤销。': 'Delete this machine? This cannot be undone.',
  尚无机器: 'No machines yet',
  '在要执行任务的机器上运行注册命令，它就会出现在这里。':
    'Run the enroll command on the machine that should run tasks and it appears here.',
  '整机迁移失败，请重试。': 'Migration failed. Try again.',
  '删除机器失败，请重试。': 'Could not delete the machine. Try again.',
  // 桌面通知标题（M5 SSE notification 事件面，02 §9.1 三事件；api/sse.ts
  // 纯函数位消费——非组件 t()，i18n-coverage 以本键位兑现 en 兜底）
  方案已就绪: 'Plan ready',
  构建待审核: 'Build awaiting review',
  // #1261 等额度族（桌面通知标题 + 卡芯片 + 横幅 + 详情行标签）。
  等额度: 'Waiting for quota',
  // #1493 降级链：桌面通知标题。
  已换备用模型: 'Switched to fallback model',
  没有机器能跑: 'No machine can run it',
  '等额度：{lane} {kind}，{probe} 自动探测续跑':
    'Waiting for quota: {lane} {kind}, auto-probe at {probe}',
  '{lane} {kind}，{count} 个任务挂起等额度':
    '{lane} {kind}, {count## task|# tasks} waiting for quota',
  '额度恢复后自动续跑；{probe} 自动探测':
    'Runs resume automatically once quota recovers; next probe at {probe}',
  '{count} 个任务因额度/限流挂起': '{count## task|# tasks} suspended on quota/rate limits',
  '额度恢复后自动续跑，无需人工操作':
    'Runs resume automatically once quota recovers — no action needed',
  // #1261 标签 vars 值（kind 位的中英对译——vars 插值不查词典，单列键位）。
  额度空: 'out of quota',
  限流: 'rate limited',
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
  '{branch}（默认）': '{branch} (default)',
  默认分支: 'Default branch',
  读取失败: 'Could not load',
  // #1213/ADR 0017 双执行源：github 形态项目的 localPath 同机加速位字段。
  本机加速路径: 'Local acceleration path',
  '绝对路径，留空即清除': 'Absolute path; empty to clear',
  // #1242 项目身份可变面：设置页名称/描述编辑 + local→github 转换卡。
  保存名称: 'Save name',
  更换项目图标: 'Change project icon',
  搜索图标: 'Search icons',
  没有匹配的图标: 'No matching icons',
  图标: 'Icon',
  重置图标: 'Reset icon',
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
  排期扫票: 'Schedule sweep',
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
  'Coordinator 设置': 'Coordinator settings',
  '请先在工作路由里配置 Coordinator。': 'Configure the Coordinator in work routing first.',
  '有什么可以帮你的？': 'How can I help?',
  章程: 'Charter',
  记忆: 'Memory',
  记忆已更新: 'Memory updated',
  技能已更新: 'Skill updated',
  关注与提醒: 'Watches & reminders',
  未设置: 'Not set',
  '尚无章程。点击编辑，为 Coordinator 添加常设指示。':
    'No charter yet. Click edit to give the Coordinator standing instructions.',
  编辑: 'Edit',
  '暂无跟进事项。Coordinator 关注某个任务，或约定到点回头核实时，会按主题列在这里。':
    'Nothing being watched yet. When the Coordinator watches a todo, or promises to check back at a set time, it is listed here by thread.',
  // #811 关注 tab：无备注 wake 行的回退文案（有备注显示备注原文）。
  到点提醒: 'Scheduled check-in',
  // #182 设置面接线：选择总管 Agent dialog + 章程编辑弹窗；换绑二次确认
  // copy 走 shared CHIEF_REBIND_CONFIRM_COPY canon（<agent> 占位，显示层替换，
  // i18n-coverage COMPUTED_KEYS 登记）。
  // #615 总管抽屉主模型闭环文案（模型行 aria + 覆盖 dialog 默认行/搜索/空态）。
  // #615 返工：恢复钮（参考站 live aria 正词）+ 过程折叠 + 确认层 + 工具行失败徽标。
  恢复到此处: 'Restore to here',
  '恢复到此处？该条之后的 {n} 条消息会移除，Coordinator 从这条重发开新回合。':
    'Restore to here? The {n## message after it is removed|# messages after it are removed} and the Coordinator resends from this one as a fresh turn.',
  // #822 在飞存在行展开面：行开关 aria + 正在调用的工具 + 空面 fallback。
  展开实时步骤: 'Show live steps',
  查看步骤: 'View steps',
  收起实时步骤: 'Hide live steps',
  正在调用: 'Calling',
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
  // #1250（ADR 0018 层 1）review fan-out 三视角（ReviewDialog 勾选行）。
  // #509 审核选人独立性提示：默认值优先跨厂商；无跨厂商可选时出声。两档措辞
  // ——确证同源 vs 无法判定（未配置厂商 = 没有比对基准），都不静默。
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
  '更换 Coordinator 的 agent？Coordinator 的记忆保存在其运行所用的 Agent 上。切换至 <agent> 后，记忆将变为 <agent> 的记忆，当前记忆不会迁移。':
    "Switch the Coordinator's Agent? The Coordinator's memory lives on the Agent it runs on. After switching to <agent>, the memory becomes <agent>'s — the current memory is not migrated.",
  编辑章程: 'Edit charter',
  保存章程: 'Save charter',
  '长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…':
    'Long-term instructions: model routing rules (which model for which work), priorities, preferences…',
  // #209 编辑分配接线：chip-popover「编辑分配」→ agent 选择弹层（#182 家族
  // 形态复用）；弹层内容 r2 C.18 从未捕获，文案 [设计]，<agent> 占位显示层
  // 替换。

  // —— chrome carried inside fixture records (exact-value keys; user and
  // agent content is deliberately absent — it falls back to the zh
  // original like any real user data would) ——
  '准备工作区...': 'Preparing workspace...',
  '处理中...': 'Working on it...',
  '正在连接 {machine}...': 'Connecting to {machine}...',
  '执行中...': 'Running...',
  // #1108 queue rows (pending steps waiting for a machine) + machines page
  // concurrency face.
  '排队中：等 {machine}（{running}/{cap} 在跑，前面 {ahead} 个）':
    'Queued: waiting for {machine} ({running}/{cap} running, {ahead} ahead)',
  '排队中：等空闲机器（前面 {ahead} 个）': 'Queued: waiting for a free machine ({ahead} ahead)',
  // #1251 visible pending reasons (queue blocked face): missing capability =
  // the fix, offline = waiting.
  '排队中：没有机器满足能力要求（缺 {missing}）——装齐后下一拍心跳即解锁（前面 {ahead} 个）':
    'Queued: no machine meets the capability requirements (missing {missing}) — it runs on the next heartbeat once they are installed ({ahead} ahead)',
  '排队中：等 {machine} 上线（前面 {ahead} 个）':
    'Queued: waiting for {machine} to come online ({ahead} ahead)',
  '排队中：等机器上线（前面 {ahead} 个）':
    'Queued: waiting for a machine to come online ({ahead} ahead)',
  '执行中 {n}/{cap}': 'Running {n}/{cap}',
  // #1251 machines page capability annotation (daemon-reported inventory).
  能力清单未上报: 'Capabilities not reported',
  'MCP {n} · 本机技能 {m}': 'MCP {n} · local skills {m}',
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
  'skill: {n}': 'skill: {n}',
  '✕ skill: {n}（已挡下）': '✕ skill: {n} (blocked)',
  '技能：{n}': 'Skills: {n}',
  '挡下：{n}': 'Blocked: {n}',
  // #1106 dispatch skill injection: detail-face lookup row (reasons ride as
  // server data, not t() keys — same law as note #634).
  '未注入技能（任务文本未命中任何技能）': 'No skills injected (task text matched none)',
  // #1288：模型活性标注——dead 模型置灰 +「已下架」（不隐藏）。
  已下架: 'Delisted',
  [PROBE_TOOL_CALL_LABEL]: `Calling tool: ${PROBE_TOOL_PILLS[1]}`,
  '方案 · v1': 'Plan · v1',
  'Xmon Dai 发起了合并': 'Xmon Dai started a merge',
  '运行在 ': 'Running on ',
  '远程（HTTP）': 'Remote (HTTP)',
  '2 天前': '2d ago',
  // —— overlay dialogs (issues #66 / #68) ——
  新建任务: 'New task',
  删除任务: 'Delete todo',
  '确定删除该任务？此操作不可撤销。': 'Delete this todo? This cannot be undone.',
  // #306 sched-card 菜单删除确认（DeleteConfirm 家族泛化随加）。
  删除定时: 'Delete schedule',
  '确定删除该定时？此操作不可撤销。': 'Delete this schedule? This cannot be undone.',
  // XMON-19/B2 删除 Agent：三串 = 原版产线 bundle 的 en 语料原文
  // （agent_modal.remove / remove_title / remove_confirm），非回译。
  复制链接: 'Copy link',
  暂停: 'Snooze',
  撤销: 'Undo',
  完成任务: 'Complete task',
  负责人: 'Owner',
  'issue 状态': 'Issue state',
  'Coordinator 用的模型额度已用完': "The Coordinator's model is out of quota",
  'Coordinator 用的模型暂时过载': "The Coordinator's model is overloaded",
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
  花费: 'Cost',
  '无价格来源：模型未声明费率，或该运行未上报费用':
    'No price source: the model declares no rates, or the run reported no cost',
  当前: 'Current',
  重跑: 'Rerun',
  同步: 'Sync',
  // #319 分支对话框「同步到机器」结果卡四态 + 机器选择占位
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

  // —— #75 deep dynamic states: reject loop / failed / reuse plan ——
  '由 Coordinator 发起': 'Started by Coordinator',
  '运行在 {m} 上': 'Running on {m}',
  上一版本: 'Previous version',
  '与其他版本对比…': 'Compare with other versions…',
  '回到与 base 对比': 'Back to comparison with base',
  // #1258 失败行原始错误弹窗面
  查看原始错误: 'View raw error',
  原始错误: 'Raw error',
  'CI 修复第 {round}/{max} 轮：推送前检查未通过':
    'CI fix round {round}/{max}: pre-push checks failed',
  'CI 修复第 {round}/{max} 轮：CI 检查未通过': 'CI fix round {round}/{max}: CI checks failed',
  '解冲突第 {round}/{max} 轮：PR 与默认分支冲突':
    'Conflict fix round {round}/{max}: the PR conflicts with the default branch',
  '按反馈返工，继续本会话': 'Reworking from feedback in this session',
  查看原始日志: 'View raw log',
  原始日志: 'Raw log',
  查看完整指令: 'View full instruction',
  完整指令: 'Full instruction',
  // #1285 失败行指引按分类分族
  '请将这台机器重新上线。这一步不会改派到其他机器。':
    'Bring this machine back online. This step is not reassigned.',
  '模型额度已用尽，请等待额度恢复后重试。':
    'Model quota exhausted — wait for it to recover, then retry.',
  '请求被限流，请稍后重试。': 'Rate limited — retry later.',
  重试: 'Retry',
  失败: 'Failed',
  默认: 'Default',
  // #170 create-agent dialog family
  创建: 'Create',
  // W4 #287 API key 新建表单弹窗（r3 §6 权限位 [推断]）
  '名称（可选）': 'Name (optional)',
  '如：笔记本、CI 机器': 'e.g. laptop, CI runner',
  'Git 读写（托管仓库 push/pull）': 'Git read/write (hosted repo push/pull)',
  'MCP 访问（MCP 客户端接入）': 'MCP access (MCP client connections)',
  '机器注册（CLI 接入执行机）': 'Machine enrollment (CLI executor registration)',
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
  添加模型: 'Add model',
  移除模型: 'Remove model',
  连接设置: 'Connection',
  没有匹配的模型: 'No models match.',
  '添加自定义模型「{id}」': 'Add custom model "{id}"',
  '搜索模型或输入 ID': 'Search models or type an ID',
  '填写 Base URL 和协议': 'Set the base URL and protocol',
  原生鉴权: 'native auth',
  '目录里还有 {n} 个模型，点「添加模型」搜索。':
    '{n#1 more model|# more models} in the catalog. Use Add model to search.',
  '把 Base URL 中的占位符换成你的账户值':
    'Replace the placeholders in the Base URL with your account values',
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
  未安装: 'Not installed',
  '已安装，未配置模型槽': 'Installed, no model slots configured',
  未登录: 'Not signed in',
  '在该机器上写 ~/.claude/settings.json 的 env.ANTHROPIC_*_MODEL 槽后，此处自动展示其模型槽。':
    'Add ANTHROPIC_*_MODEL slots to env in ~/.claude/settings.json on that machine and its model slots show up here.',
  尚未添加服务商: 'No providers yet',
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
  'GitHub 连接已断开': 'GitHub connection disconnected',
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
  配对这台电脑: 'Pair this computer',
  '正在配对…': 'Pairing…',
  '输入一次性配对码。码在运行服务的电脑的远程访问设置里生成，5 分钟内有效，只能用一次。':
    'Enter a one-time pairing code. Create it in Remote access on the computer running the server. It works once, for 5 minutes.',
  配对码: 'Pairing code',
  '配对码无效，请重试。': 'Pairing code is invalid. Try again.',
  未使用的配对码: 'Unused pairing codes',
  作废配对码: 'Revoke code',
  进入: 'Continue',
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

  没有可引用的对象: 'Nothing to mention',
  '没有与"{query}"匹配的结果': 'No results matching “{query}”',

  // —— #403/#445 看板筛选面（仓库 chip 组 + 类型 popover + 空结果态）——
  类型: 'Type',

  // —— XMON-57 统一筛选面板（两维 + 批次键 + 生效筛选条 + 空词表行）——
  // #636 批次行照参考站形：全选行（zh「全选」，本域 en 'Select all'）+ 右端
  // 反选；权限授予面改用「授予全部」避开同形碰撞（zh 源串即 key，两域必须
  // 分叉）。段内清除钮撤除——清除由全选行满选再点 / 反选 / 顶栏生效筛选条
  // 三路承接，`清除` 条目随之下架。

  // —— #485 Agent 详情编辑面（三 tab + 概览字段 + 记忆/权限面）——
  // 含空格/标点的键一律引号形（对象字面量的键不是标识符）。
  权限: 'Permissions',
  工具: 'Tools',
  // 模型 已在 #476 段登记，本段不重复。
  思考强度: 'Thinking level',
  // 「状态」键随 XMON-18 撤行一并摘除（概览不再摆状态行，en-coverage gate 也不
  // 容许死键）。
  未设置模型: 'No model',
  // 概览「进行中」段空态（原文 = 参考产品 web 包 agent_modal.no_active_tasks）。
  // XMON-80/P3：零密钥空态旁的出口（落到侧栏密钥页）。
  // XMON-80/P2：权限 tab 保存失败的可见反馈。
  '保存失败，请重试。': 'Save failed. Try again.',
  // #1251 机器匹配段（权限 tab 第五组：执行要求写面 + 「哪些机器可跑它」读面）。
  '要求安装 {name}': 'Require {name} installed',
  离线: 'Offline',
  '{name} 上的 Claude Code 登录将在 {days} 天后过期。在该机器上运行 `claude auth login` 重新登录。':
    'Claude Code login on {name} expires in {days## day|# days}. On that machine run `claude auth login`.',
  '{name} 上的 Claude Code 登录将在 1 天后过期。在该机器上运行 `claude auth login` 重新登录。':
    'Claude Code login on {name} expires in 1 day. On that machine run `claude auth login`.',
  '{name} 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。':
    'Claude Code login on {name} expires in less than a day. On that machine run `claude auth login`.',
  '{name} 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。':
    'Claude Code login on {name} has expired. On that machine run `claude auth login`.',
  服务器数据库备份: 'Server database backup',
  数据库备份已停止: 'Database backup stopped',
  数据库备份失败: 'Database backup failed',
  无法确认数据库备份状态: 'Backup status unknown',
  '服务器数据库备份状态文件无法读取，无法确认备份是否在运行。':
    'The server database backup status file cannot be read, so the backup cannot be confirmed as running.',
  '{host} 上的服务器数据库备份已有 {hours} 小时没有成功，备份可能已停止。在该机器上运行 `systemctl --user list-timers cairn-db-backup.timer` 检查定时器。':
    'The server database backup on {host} has not succeeded for {hours## hour|# hours} and may have stopped. On that machine run `systemctl --user list-timers cairn-db-backup.timer` to check the timer.',
  '{host} 上的服务器数据库备份最近一次运行失败（{detail}），还没有成功过的备份。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。':
    'The latest server database backup run on {host} failed ({detail}), and no backup has succeeded yet. On that machine run `systemctl --user status cairn-db-backup.service` to see why.',
  '{host} 上的服务器数据库备份最近一次运行失败（{detail}），上次成功备份在不到 1 小时前。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。':
    'The latest server database backup run on {host} failed ({detail}); the last successful backup was less than an hour ago. On that machine run `systemctl --user status cairn-db-backup.service` to see why.',
  '{host} 上的服务器数据库备份最近一次运行失败（{detail}），上次成功备份在 {hours} 小时前。在该机器上运行 `systemctl --user status cairn-db-backup.service` 查看原因。':
    'The latest server database backup run on {host} failed ({detail}); the last successful backup was {hours## hour|# hours} ago. On that machine run `systemctl --user status cairn-db-backup.service` to see why.',
  // #895 机器页三态读标注（spec 21 A8；orchestration 块 join 行集）+ chief
  // 设置 Agent tab「机器」槽的描述（A6）。徽标/状态 = 机器与总管编排的
  // 关系面，非机器自身状态。
  'Coordinator 主机': 'Coordinator host',
  'Coordinator 回合进行中': 'Coordinator turn in progress',
  'Coordinator 等待机器': 'Coordinator waiting for machine',
  '暂无 MCP 服务器。': 'No MCP servers yet.',
  团队密钥: 'Team secrets',
  // #1169 授权技能段（权限 tab）：不限制（null）与限制后全不勾（[] = 显式
  // 全拒）两态互转；逐技能勾选行只在限制态渲染。
  '该 Agent 执行任务时可读取的团队技能范围。开启「不限制」= 全量可读；关闭后仅勾选的技能可读，未勾选一律拒绝——「不限制」与全不勾是两种状态，可随时互转。':
    'Which team skills this Agent may read. Unrestricted reads everything; once restricted, only the checked skills are readable and every unchecked one is denied. Unrestricted and nothing-checked are two different states, switchable either way.',
  // shared canon（packages/shared/src/records/agent.ts、memory.ts），经 t()
  // 消费、不作字面量出现——i18n-coverage COMPUTED_KEYS 登记。
  合并分支: 'Merge branches',
  '、': ', ',
  创建标签: 'Create tags',
  推送分支: 'Push branches',
  创建技能: 'Create skills',
  更新技能: 'Update skills',
  运行时: 'Runtime',
  '内置 (pi)': 'Built-in (pi)',
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
  '说明该 Agent 的常驻职责，可多行。该说明会注入它执行的每个任务的系统提示词，也会提供给 Coordinator 用于分派。':
    'Describe the Agent’s ongoing responsibility — multi-line OK. The text is injected into the system prompt of every task it runs and is given to the Coordinator for dispatch.',
  '该 Agent 执行任何任务时自动携带的团队技能，无需在消息中 @ 引用。':
    'The team skill this Agent always carries, without an @ mention in the message.',
  'Coordinator 在所有项目里都会用到的笔记。': 'Notes the Coordinator uses across every project.',
  '像 AGENTS.md：本项目的每个 thread 和 Coordinator 都会读到并遵守。':
    'Like an AGENTS.md: every thread and the Coordinator in this project read and follow it.',
  自动记忆: 'Auto memory',
  'Coordinator 在这个项目里工作时自己写下的笔记。':
    'Notes the Coordinator writes itself as it works in this project.',
  'Coordinator 还没有记下团队笔记。': 'The Coordinator has not written team notes yet.',
  'Coordinator 还没有在这个项目里记下笔记。':
    'The Coordinator has not written notes in this project yet.',
  可自动注入: 'Eligible for automatic injection',
  记忆文件: 'Memory files',
  '记忆没有加载出来，请重试。': 'Memories did not load. Try again.',
  正在加载记忆: 'Loading memories',
  '打开记忆：{title}': 'Open memory: {title}',
  '可检索 · 不自动注入': 'Searchable · not injected automatically',
  核心: 'Core',
  '更新于 {date}': 'Updated {date}',
  更新于: 'Updated',
  概要: 'Summary',
  '删除…': 'Delete…',
  删除这条记忆: 'Delete this memory',
  '删除这条记忆？': 'Delete this memory?',
  删除记忆: 'Delete memory',
  '正在删除…': 'Deleting…',
  '只删除这条记忆，不影响保存它的对话。':
    'Deletes only this memory, not the conversation it was saved from.',
  '没有删除成功，记忆保持原样，请重试。': 'The memory was not deleted and is unchanged. Try again.',
  '离线中。记忆只能查看，重新连接后才能删除。':
    'Offline. Memories are read-only until you reconnect.',
  模型与机器: 'Model & machine',

  '搜索记忆…': 'Search memories…',
  // 排序第二档（[设计]，见 agent-detail-page.tsx 的 MEMORY_SORT_OPTIONS）。
  // 记忆 tab 空态（标题 + 说明）与零命中态：搜不到不等于没存过。
  // —— #631 总管对话失败闭环（sonner toast + 线程失败行）——
  'Coordinator 这一轮没有完成。': 'The Coordinator did not finish this turn.',
  'Coordinator 本轮执行失败': 'The Coordinator turn failed',
  '撤回失败，Coordinator 可能已经开始处理这条了。':
    'Could not withdraw: the Coordinator may already be working on it.',
  '插话失败，请重试。': 'Could not steer. Try again.',
  '停止失败，请重试。': 'Could not stop. Try again.',
  '已停止，没有建任务。': 'Stopped. No task was created.',
  '已停止。停之前已经建了任务': 'Stopped. A task was already created before the stop:',
  '已存下，Coordinator 恢复后会处理': 'Saved. The Coordinator will handle it once it is back',
  现在插话: 'Steer now',
  移除: 'Remove',
  排队中的消息: 'Queued messages',
  撤回: 'Withdraw',
  '由备用模型 {model} 回答': 'Answered by backup model {model}',
  'Coordinator 用的模型 {model} 额度已用完': "The Coordinator's model {model} is out of quota",
  'Coordinator 用的模型 {model} 暂时过载': "The Coordinator's model {model} is overloaded",
  '{time} 会自动再试': 'it retries automatically at {time}',
  恢复时间还不确定: 'no recovery time yet',
  'Coordinator 暂时不可用': 'The Coordinator is unavailable',
  '{why}，{when}。任务照常在跑；你说的话先存下，恢复后按顺序处理。':
    '{why}; {when}. Tasks keep running; your messages are saved and handled in order once it is back.',
  详情: 'Details',
  '给 Coordinator 换模型': "Change the Coordinator's model",
  'Coordinator 的主模型暂时用不了，这次改用备用模型 {model} 回复，判断可能没那么准。':
    "The Coordinator's main model is unavailable, so backup model {model} is replying. Its judgment may be less sharp.",
  换模型: 'Change model',
  '停止 Coordinator 这次回复': 'Stop this Coordinator reply',
  '可以继续说，Coordinator 恢复后会按顺序处理…':
    'Keep typing; the Coordinator handles messages in order once it is back…',
  '发出的话会直接插进 Coordinator 这一轮': 'Steer the current reply',
  '还没开始处理，新发的话会排在这条后面': 'Not started yet. New messages queue behind it',
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
  来源: 'Source',
  'Coordinator 编排会话': 'Coordinator orchestration session',
  '已交给 Coordinator 编排': 'Handed to the Coordinator',
  'Coordinator 将直接规划，并按活的类型派发执行。':
    'The Coordinator plans first, then dispatches each piece to the right agent.',
  查看会话: 'View session',
  未能开始编排: 'Could not start orchestration',
  先选择机器: 'Choose a machine first',
  选择机器: 'Choose a machine',
  '多台机器在线时，开工前要在规则里点名一台。':
    'Name a machine in routing rules before starting, while several are online.',
  去选择: 'Choose',
  // —— #1216 在飞编排态（开始/重跑的可见反馈）与详情缺失三态 ——
  '等 {machine} 上线': 'waiting for {machine} to come online',
  等机器上线: 'waiting for a machine to come online',
  '缺 {missing}': 'missing {missing}',
  排队中: 'queued',
  'Coordinator 正在编排这张任务，等这一轮结束再发起。':
    'The Coordinator is already orchestrating this task — wait for this round to finish.',
  '重复发起只会多排一轮编排，不会更快开始。':
    'Firing again only queues one more orchestration round; it will not start sooner.',
  变更加载失败: 'Failed to load the changes',
  返回对话: 'Back to conversation',
  查看变更: 'Show changes',
  任务加载失败: 'Failed to load the task',
  任务不存在或已被删除: 'This task does not exist or was deleted',
  '开始后才能回复 #{seq}': 'Start #{seq} to reply',
  '这个任务已归档。取消归档后才能发消息。': 'This task is archived. Unarchive it to send messages.',
  调整面板宽度: 'Resize panel',
  拖动调宽: 'Drag to resize',
  编排中: 'Orchestrating',
  查看计划: 'View plan',
  '已关闭，不能再回复': 'Closed. It takes no more replies',
  '计划已就绪。要改计划，直接在下面回复。': 'The plan is ready. To change it, reply below.',
  批准计划: 'Approve plan',
  '失败了。可以重试，或在下面回复说明怎么改。':
    'It failed. Retry, or reply below with what to change.',
  取消归档: 'Unarchive',
  归档于: 'Archived',
  已归档项目: 'Archived projects',
  筛选项目: 'Filter projects',
  '筛选项目：{value}': 'Filter projects: {value}',
  '已归档的项目和它们的对话会一直保留，直到你删除。':
    'Archived projects and their conversations are kept until you delete them.',
  '这个项目已归档。取消归档后才能发消息。':
    'This project is archived. Unarchive it to send messages.',
  '这个项目已归档。取消归档后才能修改。': 'This project is archived. Unarchive it to make changes.',
  没有已归档的项目: 'No archived projects',
  已归档的项目: 'Archived projects',
  全部删除: 'Delete all',
  没有可删除的已归档项目: 'No archived projects to delete',
  '删除 {n} 个已归档的项目？': 'Delete {n#1 archived project|# archived projects}?',
  '它们的对话、任务和仍在进行的工作会一起删除，无法恢复。':
    'Their conversations, tasks and any work still running are deleted with them. This cannot be undone.',
  '{n} 个项目没能删除，已留在列表里。':
    '{n#1 project|# projects} could not be deleted and stay in the list.',
  '在侧栏项目菜单里归档的项目会出现在这里。':
    'Projects you archive from the sidebar project menu appear here.',
  '取消归档失败，请重试。': 'Could not unarchive the project. Try again.',
  '取消归档中…': 'Unarchiving…',
  '批准失败，请重试。': 'Could not approve. Try again.',
  // —— #638 全站静默 mutation 失败面接线（toast 标题句；server 原因进
  // description 透传不译，#631 同律。已有面内 canon 位的面——merge 拒绝行 /
  // issue 导入内联 / fs-pick 提示行 / OAuth 内联 / 技能弹窗内联——不在此列）——
  '创建项目失败，请重试。': 'Could not create the project. Try again.',
  '关闭任务失败，请重试。': 'Could not close the task. Try again.',
  '删除任务失败，请重试。': 'Could not delete the task. Try again.',
  '重试失败，请稍后再试。': 'Retry failed. Try again later.',
  '新建定时失败，请重试。': 'Could not create the schedule. Try again.',
  '删除定时失败，请重试。': 'Could not delete the schedule. Try again.',
  '删除项目失败，请重试。': 'Could not delete the project. Try again.',
  '断开连接失败，请重试。': 'Could not disconnect. Try again.',
  '添加模型服务失败，请重试。': 'Could not add the provider. Try again.',
  '添加密钥失败，请重试。': 'Could not add the secret. Try again.',
  '新建 API 密钥失败，请重试。': 'Could not create the API key. Try again.',
  '删除记忆失败，请重试。': 'Could not delete the memory. Try again.',
  待回答的提问: 'Pending questions',
  '提交回答失败，草稿还在，请再试一次。':
    'Could not send your answer. Your draft is still here. Try Submit again.',
  已回答: 'Answered',
  在等你回答: 'Waiting for your answer',
  更多操作: 'More actions',
  等待你的回复: 'Waiting for your reply',
  取消提问: 'Dismiss question',
  已取消提问: 'Question dismissed',
  问题: 'Question',
  附件上传中: 'Uploading attachment',
  提交回答: 'Submit answers',
  输入你的回答: 'Type your answer',
  '输入你自己的回答…': 'Type your own answer…',
  回答选项: 'Answer options',
  提交: 'Submit',
  下一步: 'Next',
  '提交回答失败，请重试。': 'Could not submit your answers. Try again.',
  '取消提问失败，请重试。': 'Could not dismiss the question. Try again.',
  备用模型: 'Fallback models',
  选择运行时: 'Choose runtime',
  已忘掉: 'Forgotten',
  '让 Coordinator 忘掉这条': 'Make the Coordinator forget this',
  决定: 'Decided',
  还开着: 'Still open',
  记住了: 'Remembered',
  '没能更新这条建议，请重试。': "Couldn't update this suggestion. Try again.",
  建议回复: 'Suggested replies',
  '为什么没拦住：{why}': 'Why it slipped through: {why}',
  '防护：{safeguard}': 'Safeguard: {safeguard}',
  '出处：': 'Source: ',
  协调者对话: 'Coordinator chat',
  建成线程: 'Make it a thread',
  不用了: 'Dismiss',
  已建成线程: 'Made into a thread',
  已忽略: 'Dismissed',
  '今天的日报：昨天没有新进展。': "Today's report: nothing new yesterday. ",
  '{n} 件等你': '{n## item|# items} waiting on you',
  今天的日报: "Today's report",
  '今天的日报 · 昨天（{day}）': "Today's report · yesterday ({day})",
  '日报没写成，过一会儿再试一次；先看昨天的数字。':
    "The report couldn't be written; it will try once more shortly. Here are yesterday's numbers.",
  '日报两次都没写成；下面是昨天的原始数字。':
    "The report failed twice; here are yesterday's raw numbers.",
  昨天的进展: 'Yesterday',
  '完成 {done} · 合并 {merged} · 失败 {failed} · 重跑 {retries} · 等额度 {quota} · 审查通过 {pass} / 拦下 {block}':
    'Done {done} · merged {merged} · failed {failed} · reruns {retries} · quota waits {quota} · reviews passed {pass} / blocked {block}',
  '失败：': 'Failed: ',
  '完成：': 'Done: ',
  '合并：': 'Merged: ',
  等你的事: 'Needs you',
  没有等你的事: 'Nothing is waiting on you',
  '{n} 件等你，去处理': '{n## item|# items} waiting on you, open the inbox',
  复盘: 'Retro',
  外部动态: 'Outside developments',
  '来源：': 'Source: ',
  '对应：{matches}': 'Matches: {matches}',
  '建议动作：{action}': 'Suggested action: {action}',
  昨天的对话里没找到值得改的地方: "Nothing in yesterday's conversations needs a safeguard",
  '这些来源太长，只读了后面的部分：{sources}。':
    'These sources were too long, so only their latest part was read: {sources}. ',
  '复盘建议只是草稿：点「建成线程」才会建线程，建好后也要你自己开始。':
    'Retro suggestions are drafts: a thread is created only when you choose "Make it a thread", and you still start it yourself.',
  'Coordinator 把昨天的对话整理成了 {n} 条摘要':
    "The Coordinator summarized yesterday's chat into {n## item|# items}",
  '对话太长了，Coordinator 把上面的内容整理成了 {n} 条摘要':
    'The chat got long, so the Coordinator summarized everything above into {n## item|# items}',
  '昨天的摘要 · {time} 整理': "Yesterday's summary · made at {time}",
  '上面内容的摘要 · {time} 整理': 'Summary of the chat above · made at {time}',
  '原文都还在，往上滑就能看到。Coordinator 接着聊时用的是这份摘要；任务的进度它会直接去任务里查，不靠记对话。摘要漏了或写错了，直接在下面告诉 Coordinator。':
    'The original messages are still here; scroll up to see them. The Coordinator continues from this summary and checks task progress in the tasks themselves, not from memory of the chat. If something is missing or wrong, tell the Coordinator below.',
  执行: 'Build',
  合并: 'Merge',
  运行中: 'Running',
  等待检查: 'Waiting on checks',
  未配置: 'Not configured',
  空闲: 'Idle',
  项目设置: 'Project settings',
  回答: 'Answer',
  看计划: 'Review plan',
  '在问你一个问题。': 'Asked you a question.',
  '计划已就绪，批准后开工。': 'Plan ready. Approve to start.',
  '已就绪，等你审阅。': 'Ready for your review.',
  '失败了，打开它重试。': 'Failed. Open it to retry.',
  '排队等机器。': 'Waiting for a machine.',
  '正在写计划。': 'Writing the plan.',
  '正在动手。': 'Working on it.',
  '还没开始。': 'Not started.',
  做个计划: 'Make a plan',
  接一个仓库: 'Add a repo',
  接着最近的活: 'Pick up recent work',
  用我的工具: 'Use my tools',
  '与 Coordinator 的对话': 'Conversation with the Coordinator',
  对话加载失败: 'Could not load the conversation',
  '对话记录还在，重试一下。': 'Your conversation is still there. Try again.',
  '{n} 件在进行': '{n} in progress',
  待你决定: 'Needs you',
  '跟 Coordinator 说（在 {name} 里）…': 'Talk to the Coordinator (in {name})…',
  首页: 'Home',
  'Claude 登录需要处理': 'Claude sign-in needs attention',
  '{kind} 步骤': '{kind} step',
  '{name} 接任务': 'Run steps on {name}',
  '{time} 重置': 'resets {time}',
  '冷却至 {time}': 'Cooling until {time}',
  可用: 'Available',
  '固定于 {ago}': 'pinned {ago}',
  '固定账户的 thread': 'Sticky threads',
  在这台机器上运行: 'Run on this machine:',
  已登录: 'Signed in',
  已过期: 'Expired',
  '最近 24 小时': 'Last 24 hours',
  '最近 24 小时没有步骤': 'No steps in the last 24 hours',
  最近使用: 'Last used',
  最近步骤: 'Recent steps',
  构建: 'Build',
  状态未知: 'Unknown',
  评审: 'Review',
  账户: 'Accounts',
  还没有额度读数: 'No quota reading yet',
  '这台机器还不能单独开关 {name}': '{name} cannot be switched on this machine yet',
  '这台机器还没有上报 provider 状态': 'This machine has not reported its providers yet',
  重命名: 'Rename',
  重命名项目: 'Rename project',
  重命名分组: 'Rename group',
  解散分组: 'Ungroup',
  '分组 {name} 的菜单': 'Menu for group {name}',
  '无法重命名项目。': 'Could not rename the project.',
  '无法重命名分组。': 'Could not rename the group.',
  额度用尽: 'Quota used up',
  驳回重跑: 'Rejected, rerun',
  验证: 'Verify',
  '5 小时': '5-hour',
  计费周期: 'Billing period',
  '{window} 剩余': '{window} left',
  未上报: 'not reported',
  不可用: 'Unavailable',
  用途: 'Uses',
  连接: 'Connections',
  模型路由: 'Model routing',
  用量与连接: 'Usage & connections',
  正在加载用量与连接: 'Loading usage & connections',
  用量与连接没能加载: 'Usage & connections did not load',
  规则与策略: 'Rules & policies',
  正在加载规则与策略: 'Loading rules & policies',
  规则与策略没能加载: 'Rules & policies did not load',
  打开工作路由: 'Open work routing',
  '「{name}」验证通过': '{name} verified',
  '验证中…': 'Verifying…',
  '重命名失败，请重试。': 'Could not rename. Try again.',
  'Claude 用量': 'Claude usage',
  付费方式: 'Billing',
  '只用订阅，按 token 付费的 Claude 调用一律拦下，包括后台任务。':
    'Subscriptions only: paid-per-token Claude calls are blocked, background tasks included.',
  '订阅不够时，可以改用按 token 付费的 Claude API key。':
    'When subscriptions run out, Claude may fall back to a paid-per-token API key.',
  只用订阅: 'Subscriptions only',
  允许按量付费: 'Allow pay as you go',
  '每种用途用哪个模型、走哪个连接': 'Which model and connection each use runs on',
  '正在读取路由…': 'Loading routing…',
  '移除「{name}」？': 'Remove {name}?',
  '移除失败，请重试。': 'Could not remove. Try again.',
  'API key': 'API key',
  订阅: 'Subscription',
  实现: 'Implementation',
  机械活: 'Mechanical',
  评测: 'Eval',
  每晚扫描: 'Nightly scan',
  周: 'Week',
  订阅账户: 'Subscription accounts',
  '还没有路由，添加一个订阅账户后这里会画出每种用途走哪个连接。':
    'No routing yet. Add a subscription account and this shows which connection each use runs on.',
  '直接发给 #{seq}，插进它这一轮。': 'Goes straight to #{seq}, into its current turn.',
  '作为改计划的意见发给 #{seq}，不算批准。': 'Plan feedback for #{seq}, not an approval.',
  '#{seq} 会带着这句话重跑。': 'Reruns #{seq} with this note.',
  '已发给 #{seq}。': 'Sent to #{seq}.',
  '没发出去，再试一次。': 'Not sent. Try again.',
  '回复 #{seq}': 'Reply to #{seq}',
  '回复 #{seq}…': 'Reply to #{seq}…',
  回复这个任务: 'Reply to this task',
  '你直接对 #{n} 说：{excerpt}': 'You told #{n} directly: {excerpt}',
  'Coordinator 直接对 #{n} 说：{excerpt}': 'The Coordinator told #{n} directly: {excerpt}',
  '任务 #{n}': 'Task #{n}',
  '{n} 次追问': '{n#1 follow-up|# follow-ups}',
  '你：{excerpt}': 'You: {excerpt}',
  'Coordinator：{excerpt}': 'Coordinator: {excerpt}',
  展开活动: 'Show activity',
  收起活动: 'Hide activity',
  '对某个 thread 说': 'Talk to a thread',
  '正在对 #{seq} 说': 'Talking to #{seq}',
  发给谁: 'Send to',
  '默认，由它安排': 'Default. It decides who does what.',
  '改回对 Coordinator 说': 'Back to the Coordinator',
  '没发给 #{seq}，再试一次。': 'Not sent to #{seq}. Try again.',
  '#{seq} 现在收不了消息。改回 Coordinator，或换一个 thread。':
    '#{seq} cannot take a message now. Switch back to the Coordinator or pick another thread.',
  '启用 {name}': 'Enable {name}',
  添加服务商: 'Add provider',
  '移除 {name}': 'Remove {name}',
  '加密保存，保存后不能再查看': 'Encrypted; cannot be viewed after saving',
  '更换 API key': 'Replace API key',
  '新的 API key': 'New API key',
  测试连接: 'Test connection',
  测试: 'Test',
  '测试中…': 'Testing…',
  '发一个最小请求，不会显示密钥': 'Sends one minimal request; the key is never shown',
  连接正常: 'Connected',
  '连接失败，请检查连接设置后重试。':
    'Connection failed. Check the connection settings and try again.',
  '测试没能跑完，请重试。': 'The test could not finish. Try again.',
  协议: 'Protocol',
  地址: 'Base URL',
  这里的模型会出现在模型选择器里: 'These models show up in the model pickers',
  '添加模型 ID，回车保存': 'Add a model ID, press Enter to save',
  移除服务商: 'Remove provider',
  '移除后，用到它的模型和路由不再可用。':
    'After removal, the models and routes that use it stop working.',
  '离线 · 显示最后一次上报': 'Offline · showing the last report',
  '{machine} 上的 CLI': 'CLI on {machine}',
  程序: 'Binary',
  未找到: 'Not found',
  配置: 'Config',
  模型槽来自这台机器的这个文件: 'Model slots come from this file on the machine',
  模型槽: 'Model slots',
  '这台机器还没上报 Claude Code 信息。': 'This machine has not reported Claude Code yet.',
  '{machine} 上的运行时': 'Runtime on {machine}',
  服务商: 'Providers',
  'pi 步骤用所有机器的服务商，不读这台机器的配置':
    "pi steps use the providers for all machines, not this machine's config",
  '所有机器的 {n} 个服务商': 'All machines: {n#1 provider|# providers}',
  'Gemini CLI 还不上报版本和模型；打开后，这台机器会接 Gemini 步骤。':
    'Gemini CLI does not report its version or models yet; when on, this machine takes Gemini steps.',
  '{n} 个模型': '{n#1 model|# models}',
  '{n} 个已下架': '{n} retired',
  使用所有机器的服务商: 'Uses providers for all machines',
  范围: 'Scope',
  '添加 API key、订阅或自定义端点后，它们的模型会出现在这里。':
    'Add an API key, subscription or custom endpoint and its models show up here.',
  还没上报: 'Not reported yet',
  模型列表: 'Models',
  '已安装，登录状态未知': 'Installed, sign-in unknown',
  '{online}/{total} 台电脑在线': '{online} of {total#1 computer|# computers} online',
  '{online} 台在线': '{online} online',
  '{online} 在线 · {offline} 离线': '{online} online · {offline} offline',
  '{online} 台在线 · {offline} 台离线（{names}）': '{online} online · {offline} offline ({names})',
  设置分区: 'Settings sections',
  搜索设置: 'Search settings',
  没有匹配的设置: 'No matching settings',
  跟随系统: 'System',
  向左滚动: 'Scroll left',
  向右滚动: 'Scroll right',
  '还有 {n} 项': '{n} more',
  路由规则: 'Routing rules',
  工作策略: 'Work policies',
  还没有路由规则: 'No routing rules yet',
  '先创建 Coordinator 规则，它才能回答你的消息。':
    'Create the Coordinator rule first so it can answer your messages.',
  '这条路由还没有规则，选好运行时与模型后创建。':
    'This route has no rule yet; pick a runtime and model, then create it.',
  不填则沿用规则的机器: 'Leave empty to keep the rule machine',
  '跟随 coordinator 路由规则，在路由设置里调整。':
    'Follows the coordinator routing rules; adjust them in routing settings.',
  '{n} 条路由规则未过校验留在原机':
    '{n#1 routing rule|# routing rules} failed validation and stayed put',
  '把固定在这台机器上的路由规则一起迁到另一台机器。':
    'Move the routing rules pinned to this machine to another machine.',
  引文检查: 'Citation check',
  模型与首选机器: 'Model and preferred machine',
  首选机器: 'Preferred machine',
  不固定: 'Any machine',
  路由覆盖: 'Route override',
  '本任务的机器与执行要求；调度在规则开启后生效。':
    'Per-task machine and capability requirements; applied when routing rules are on.',
  '要求 Orb': 'Require Orb',
  '执行机须上报 Orb 沙箱执行器': 'Executor must report the Orb sandbox',
  '要求的 MCP': 'Required MCP',
  '派发时要求执行机已安装这些 MCP 服务器': 'Dispatch requires these MCP servers on the executor',
  路由覆盖已保存: 'Route override saved',
  '保存路由覆盖失败，请重试。': 'Could not save the route override. Try again.',
  会话: 'Session',
  摘要: 'Digest',
  压缩: 'Compaction',
  会话权限: 'Session policy',
  评审权限: 'Review policy',
  '声明可写工具；密钥与 MCP 只读展示': 'Writable tools; secrets and MCP are shown read-only',
  有未保存的改动: 'Unsaved changes',
  已与服务器一致: 'In sync with the server',
  规则已保存: 'Saved',
  执行环境: 'Execution',
  安全: 'Security',
  关闭设置: 'Close settings',
  颜色主题: 'Color theme',
  '在浏览器打开这个链接，输入验证码。': 'Open this link in a browser and enter the code.',
  'xAI 登录被拒绝。': 'xAI sign-in was denied.',
  '已有更新的 xAI 凭证，这次登录没有覆盖它。':
    'A newer xAI credential is already stored. This sign-in did not replace it.',
  '验证码已过期，请重试。': 'The code expired. Try again.',
  'xAI 登录失败，请重试。': 'xAI sign-in failed. Try again.',
  找不到这个项目: 'That project is not here',
  '它可能已被删除、改名，或你不在它所属的团队。':
    'It may have been deleted, renamed, or you may not be on its team.',
  '打开 Coordinator': 'Open the Coordinator',
  你是不是想找: 'Maybe one of these?',
  最近的项目: 'Recent projects',
  项目没能加载: 'Projects did not load',
  '检查网络后再试一次。': 'Check your connection and try again.',
  正在加载项目: 'Loading projects',
  活动: 'Activity',
  '移除筛选 {filter}': 'Remove filter {filter}',
  搜索筛选: 'Search filters',
  '可以任意组合，需同时满足': 'Combine any; they all apply',
  '没有筛选的词匹配标题。在筛选前加 - 表示排除。':
    'Words without a filter match titles. Prefix a filter with - to exclude it.',
  '状态：failed、waiting、review、running、done、snoozed':
    'State: failed, waiting, review, running, done, snoozed',
  项目名: 'A project name',
  'PR 编号，或 any': 'A pull request number, or any',
  '发起它的 agent 或成员': 'The agent or person who started it',
  '日期，或距今的时间段': 'A date or a span back from now',
  '花费，用 > 或 <': 'Spend, with > or <',
  这个筛选还没有值: 'This filter has no value yet',
  '状态只能是 failed、waiting、review、running、done 或 snoozed':
    'State must be failed, waiting, review, running, done or snoozed',
  '请写 PR 编号，或 any': 'Use a PR number, or any',
  '请写日期如 2026-11-01，或时间段如 7d': 'Use a date like 2026-11-01, or a span like 7d',
  '请写 > 或 < 加数字，如 >5': 'Use > or < with a number, like >5',
  没有这个名字的项目: 'No project has that name',
  '没有这个名字的 agent 或成员': 'No agent or person has that name',
  再加一个筛选或词: 'Add a filter or a word',
  没有同时满足这些筛选的任务: 'No threads match all of these filters',
  清除全部筛选: 'Clear all filters',
  '没找到想要的？': 'Not what you wanted?',
  '在活动里查看全部 {n} 条': 'View all {n} in Activity',
  语法: 'Syntax',
  待审阅: 'Review',
  '近 7 天': 'Last 7 days',
  '超过 $1': 'Over $1',
  筛选活动: 'Filter activity',
  加词或筛选: 'Add words or a filter',
  快速筛选: 'Quick filters',
  '{n} 条 · {cost}': '{n#1 thread|# threads} · {cost}',
  '显示 {shown} / {total}': 'Showing {shown} of {total}',
  加载更多: 'Load more',
  正在加载活动: 'Loading activity',
  活动没能加载: 'Activity did not load',
  还没有活动: 'No activity yet',
  本周早些时候: 'Earlier this week',
  更早: 'Earlier',
  今日: 'Today',
  昨日: 'Yesterday',
  待定: 'Pending',
  需重新审核: 'Needs re-review',
  已开启: 'Open',
  有冲突: 'Conflicts',
  检查运行中: 'Checks running',
  检查未通过: 'Checks failed',
  审核未通过: 'Review blocked',
  可合并: 'Ready to merge',
  '队列第 {n} 位': 'Queue position {n}',
  已合并: 'Merged',
  交给负责人: 'Owner route',
  '审核 {result}': 'Review {result}',
  评审于: 'judged on',
  '与 main 冲突，解决后才会审核': 'Conflicts with main; review waits for a clean merge',
  交给负责人合并: 'Routed to the owner to merge',
  还没有审核: 'No review yet',
  审核结论已过期: 'verdict is stale',
  'CI 未读取': 'CI not read',
  '{failed} 个失败': '{failed} failed',
  '{failed} 个失败：{names}': '{failed} failed: {names}',
  检查: 'Checks',
  '评审 head': 'Judged head',
  解决: 'Resolve',
  '在 GitHub 打开': 'Open on GitHub',
  'thread 用量': 'Thread usage',
  '正在加载用量…': 'Loading usage…',
  用量加载失败: 'Usage could not load',
  'Token 数': 'Tokens',
  缓存命中: 'Cache hit',
  '包含全部运行；总时长暂不可用。': 'Across all runs. Total duration is unavailable.',
  未知机器: 'Unknown machine',
  'Token 数：{tokens}': 'Tokens: {tokens}',
  用量暂不可用: 'Usage unavailable',
  'Auto-disabled': 'Auto-disabled',
  'Automation update failed': 'Automation update failed',
  Automations: 'Automations',
  'Automations could not refresh': 'Automations could not refresh',
  'Cron: {expression}': 'Cron: {expression}',
  'Delete automation': 'Delete automation',
  'Enable automation': 'Enable automation',
  Enabled: 'Enabled',
  'Every day at {time}': 'Every day at {time}',
  'Every hour at minute {minute}': 'Every hour at minute {minute}',
  'Every weekday at {time}': 'Every weekday at {time}',
  'Every {day} at {time}': 'Every {day} at {time}',
  'Last run {age}': 'Last run {age}',
  'Loading automations…': 'Loading automations…',
  'Next run in {n} {n#day|days}': 'Next run in {n} {n#day|days}',
  'Next run in {n} {n#hour|hours}': 'Next run in {n} {n#hour|hours}',
  'Next run in {n} {n#minute|minutes}': 'Next run in {n} {n#minute|minutes}',
  'Next run is due': 'Next run is due',
  'No upcoming runs': 'No upcoming runs',
  'Once on {date} at {time}': 'Once on {date} at {time}',
  Paused: 'Paused',
  Retry: 'Retry',
  'Retry loading automations': 'Retry loading automations',
  'Schedule time unavailable': 'Schedule time unavailable',
  'Uses the thread description': 'Uses the thread description',
  '{n} {n#automation|automations}': '{n} {n#automation|automations}',
  Weekdays: 'Weekdays',
  'Custom cron': 'Custom cron',
  'Cron expression': 'Cron expression',
  'Cron is evaluated by the server in {timezone}.':
    'Cron is evaluated by the server in {timezone}.',
  'Use five cron fields: minute hour day month weekday.':
    'Use five cron fields: minute hour day month weekday.',
  'Day to repeat each week': 'Day to repeat each week',
  'Runs on the hour may start a few minutes late.':
    'Runs on the hour may start a few minutes late.',
  'Saved prompt': 'Saved prompt',
  'Leave empty to use the thread description.': 'Leave empty to use the thread description.',
  'Loading scheduled task…': 'Loading scheduled task…',
  'This scheduled task is no longer available.': 'This scheduled task is no longer available.',
  'Schedule changes are unavailable in this preview.':
    'Schedule changes are unavailable in this preview.',
  Active: 'Active',
  'Finished one-time schedule': 'Finished one-time schedule',
  'Next run': 'Next run',
  'Last run': 'Last run',
  'Next run unavailable': 'Next run unavailable',
  'None while paused': 'None while paused',
  'Run queued': 'Run queued',
  'Not run yet': 'Not run yet',
  'Scheduled task in {project}, #{number}': 'Scheduled task in {project}, #{number}',
  'Saving replaces this schedule and resets its run history.':
    'Saving replaces this schedule and resets its run history.',
  'Run now': 'Run now',
  'Re-enable': 'Re-enable',
  'Schedule update failed': 'Schedule update failed',
  'Open schedule {title}': 'Open schedule {title}',
  'Open thread': 'Open thread',
  'Choose a valid date and time in this timezone.':
    'Choose a valid date and time in this timezone.',
  'Choose a future time for a one-time schedule.': 'Choose a future time for a one-time schedule.',
  'The scheduled task could not be loaded.': 'The scheduled task could not be loaded.',
  'Schedule setup could not be loaded.': 'Schedule setup could not be loaded.',
  'Loading schedule setup…': 'Loading schedule setup…',
  'No team is available for this schedule.': 'No team is available for this schedule.',
  'Create a thread before scheduling it.': 'Create a thread before scheduling it.',
  'The project for this thread is unavailable.': 'The project for this thread is unavailable.',
  'Scheduled tasks could not be loaded': 'Scheduled tasks could not be loaded',
  'Loading scheduled tasks…': 'Loading scheduled tasks…',
  等待审核: 'Review pending',
  草稿: 'Draft',
  '落后于 main': 'Behind main',
  'GitHub 暂不允许合并': 'GitHub is blocking the merge',
  '分支落后，更新后才能合并': 'Branch is behind; update it before merging',
  '审核已通过，GitHub 还不允许合并': 'Review passed, but GitHub does not allow the merge yet',
  '{n} 分钟前读取，GitHub 可能被限流或延迟':
    'Last read {n} min ago; GitHub may be rate-limiting or slow',
  '检查通过 {passed} / {total}': 'Checks passed: {passed} of {total}',
  'PR #{n} 的菜单': 'Menu for PR #{n}',
  已复制链接: 'Link copied',
  显示更多: 'Show more',
  'PR 状态加载失败，稍后会自动重试。': 'Could not load the PR status; retrying shortly.',
  '这台机器在 Coordinator 里的角色': "This machine's role for the Coordinator",
  '这台机器上能接任务的执行器，以及它们的登录状态。':
    'The runtimes that can take tasks on this machine, and their sign-in state.',
  能力: 'Capabilities',
  '这台机器上报的 MCP 与技能清单': 'The MCP servers and skills this machine reports',
  容量: 'Capacity',
  管理: 'Manage',
  登录已过期: 'Sign-in expired',
  登录将过期: 'Sign-in expiring',
  已接入的机器: 'Connected machines',
  '已检查 {ago}': 'Checked {ago}',
  用途与连接: 'Uses and connections',
  接任务中: 'Taking tasks',
  '连接断开，正在重连…': 'Connection lost, reconnecting…',
  '恢复连接前，新消息可能发不出去。': 'Until the connection is back, new messages may not send.',
  设置作用于: 'Settings apply to',
  所有机器: 'All machines',
  视图: 'View',
  '移除后，使用它的模型不再可选。': 'Once removed, its models can no longer be picked.',
  '{n} 分钟后恢复': 'Back in {n#1 minute|# minutes}',
  '{n} 小时后恢复': 'Back in {n#1 hour|# hours}',
  '{n} 天后恢复': 'Back in {n#1 day|# days}',
  '最近使用 {ago}': 'Last used {ago}',
  还没用过: 'Not used yet',
  额度: 'Quota',
  '正在加载 MCP 服务器': 'Loading MCP servers',
  'MCP 服务器没能加载': 'MCP servers did not load',
  正在加载技能: 'Loading skills',
  技能没能加载: 'Skills did not load',
  正在加载密钥: 'Loading secrets',
  密钥没能加载: 'Secrets did not load',
  '正在加载 API 密钥': 'Loading API keys',
  'API 密钥没能加载': 'API keys did not load',
  正在加载机器: 'Loading machines',
  机器没能加载: 'Machines did not load',
  正在加载模型服务: 'Loading providers',
  模型服务没能加载: 'Providers did not load',
  正在加载命令记录: 'Loading command history',
  命令记录没能加载: 'Command history did not load',
  '正在加载 Coordinator 的电脑': "Loading the Coordinator's computer",
  'Coordinator 的电脑没能加载': "The Coordinator's computer did not load",
  正在加载任务: 'Loading tasks',
  任务没能加载: 'Tasks did not load',
  正在加载成果: 'Loading results',
  成果没能加载: 'Results did not load',
  搜索成果: 'Search results',
  '搜索成果…': 'Search results…',
  没有匹配的成果: 'No matching results',
  已归档: 'Archived',
  本周: 'This week',
  还没有已归档的成果: 'Nothing archived yet',
  '已归档的成果会一直保留，直到你删除它或它所在的项目。':
    'Archived results are kept until you delete them or their project.',
  正在加载电脑: 'Loading computers',
  电脑没能加载: 'Computers did not load',
  '搜索没能完成，下面只是本地匹配的结果。': 'Search did not finish. These are local matches only.',
  正在加载对话: 'Loading the conversation',
  '加载完成后才能发送。': 'You can send once loading finishes.',
  远程访问: 'Remote access',

  配对新设备: 'Pair a new device',
  '用手机扫描二维码，5 分钟内有效，只能用一次。':
    'Scan with your phone. Valid for 5 minutes, works once.',
  配对二维码: 'Pairing QR code',
  '手机将连接到 {origin}': 'Your phone will connect to {origin}',
  '生成配对码失败，请重试。': 'Could not create a pairing code. Try again.',
  这台电脑暂时没有手机可用的线路: 'This computer has no route your phone can use yet',
  '请先登录 Tailscale：{url}': 'Sign in to Tailscale first: {url}',
  '设置 CAIRN_TSNET=1 后重启，即可用 Tailscale 连接手机。':
    'Set CAIRN_TSNET=1 and restart to reach this computer from your phone over Tailscale.',
  Tailscale: 'Tailscale',
  局域网: 'Local network',
  '配对已关闭：当前页面的地址只在这台电脑上有效，手机扫码后会连到它自己。请设置 CAIRN_TSNET=1 后重启，或用局域网或 Tailscale 地址打开本页。':
    'Pairing is off: this page is open on an address that only works on this computer, so a phone would connect to itself. Set CAIRN_TSNET=1 and restart, or open this page through its LAN or Tailscale address.',
  当前页面地址: 'This page’s address',
  还没有配对的设备: 'No paired devices yet',
  撤销设备: 'Revoke',
  '撤销设备失败，请重试。': 'Could not revoke the device. Try again.',
  等你审阅: 'Ready for review',
  '选择 {title}': 'Select {title}',
  '最后在线 {time}': 'Last seen {time}',
  选择这台机器接哪些运行时: 'Choose which runtimes this machine takes work for',
  '重新连接 {name} 后才能修改它的设置。': 'Reconnect {name} to change its settings.',
  '在这台机器上确认它已联网、没有休眠，然后运行 `{command}` 重新启动。上线后这里会自动变回在线。':
    'On this machine, make sure it is online and awake, then run `{command}` to start it again. It turns online here by itself.',
  '额度空了，等额度恢复后自动续跑。': 'Out of quota. It resumes by itself when quota returns.',
  '被限流，等恢复后自动续跑。': 'Rate limited. It resumes by itself when the limit lifts.',
  '第一支 PR 当天就合并了。可以在 GitHub Discussions 发一条帖子':
    'The first PR merged on day one. You can post about it in GitHub Discussions',
  查看: 'View',
  '{count} 处 Claude 登录已过期': '{count} Claude logins have expired',
  '{count} 处 Claude 登录即将过期': '{count} Claude logins are about to expire',
  '{expired} 处已过期，{expiring} 处即将过期': '{expired} expired, {expiring} about to expire',
  '到期前重新登录，任务才不会中断。':
    'Sign in again before they expire so tasks are not interrupted.',
  '重新登录前，这些机器和订阅不会接新任务。':
    'Until you sign in again, these machines and subscriptions take no new tasks.',
  查看机器: 'View machines',
  查看订阅: 'View subscriptions',
  待你审阅: 'Ready for review',
  待你回答: 'Needs input',
  已解决: 'Resolved',
  'PR #{n} 有 {f} 项检查没过': 'PR #{n} has {f} failing checks',
  'PR #{n} 检查还在跑': 'Checks are still running on PR #{n}',
  'PR #{n} 检查 {p}/{t} 通过': 'PR #{n}: all checks passed ({p}/{t})',
  'PR #{n} 已合并': 'PR #{n} merged',
  改动写好了: 'The changes are ready',
  '到 PR 卡合并': 'Merge on the PR card',
  到任务里看改动: 'Review the changes in the task',
  计划写好了: 'The plan is written',
  到任务里批准计划: 'Approve the plan in the task',
  在问你一个问题: 'Asked you a question',
  到任务里回答: 'Answer in the task',
  'Coordinator 在跟进': 'Coordinator is on it',
  'Coordinator 建任务前先问你': 'Coordinator asks before creating a task',
  在对话里回答: 'Answer in the conversation',
  还没开始: 'Not started',
  现在没有任务: 'No tasks right now',
  '跟 Coordinator 说一件事，它会在这里出现。':
    'Tell the Coordinator about something and it shows up here.',
  '给 Coordinator 发消息': 'Message the Coordinator',
  接下来没有安排: 'Nothing is lined up next',
  现在没有进行中的任务: 'Nothing is in progress right now',
  还没有完成的任务: 'No finished tasks yet',
  定时没能加载: 'Schedules could not be loaded',
  正在加载定时: 'Loading schedules',
  '添加任务…': 'Add a task…',
  添加任务: 'Add a task',
  查看详情: 'View details',
  添加: 'Add',
  '任务没有发出，请重试。': 'The task was not sent. Try again.',
  打开任务: 'Open task',
  '停止并标记完成？': 'Stop and mark done?',
  停止并标记完成: 'Stop and mark done',
  停止并完成: 'Stop and finish',
  '正在运行的工作会被停止，任务随即标记为完成。':
    'The running work will be stopped and the task marked done.',
  '已通知停止，执行端确认后任务会标记为完成。':
    'Stopping now. The task is marked done once the executor confirms.',
  '任务已标记完成。': 'Task marked done.',
  '这个任务已经不存在。': 'This task no longer exists.',
  '任务状态刚刚变了，请刷新后再试。': 'The task just changed. Refresh and try again.',
  '标记完成没有成功，请重试。': 'Could not mark the task done. Try again.',
  标记完成: 'Mark done',
  '标记完成：{title}': 'Mark done: {title}',
  重命名任务: 'Rename task',
  移到项目: 'Move to project',
  '任务已移到 {project}': 'Task moved to {project}',
  '移动任务失败，请重试。': 'Could not move the task. Try again.',
  暂停定时: 'Pause schedule',
  恢复定时: 'Resume schedule',
  立即运行: 'Run now',
  '定时已暂停。': 'Schedule paused.',
  '定时已恢复。': 'Schedule resumed.',
  '已排上立即运行。': 'Run queued.',
  '定时没能更新，请重试。': 'Could not update the schedule. Try again.',
  '运行请求未送出，请重试。': 'Could not queue the run. Try again.',
  '{title} 的定时菜单': 'Menu for schedule {title}',
  任务名称: 'Task name',
  '{title} 的菜单': 'Menu for {title}',
  '任务，{n} 件等你': 'Tasks, {n} waiting on you',
  拉取请求: 'Pull requests',
  'PR 列表加载失败，稍后会自动重试。': 'Could not load the PR list; retrying shortly.',
  '任务开出 PR 后会列在这里。': 'PRs opened by threads are listed here.',
  '失败了，等自动重试': 'Failed; an automatic retry is coming',
  '{n} 件进行中': '{n} in progress',
  对话: 'Chat',
  '对话、任务和成果': 'Chat, tasks and results',
  决定与更新: 'Decisions and updates',
  '{time} 更新': 'Updated {time}',
  '{n} 条更新': '{n#1 update|# updates}',
  在主对话中查看: 'View in the main chat',
  主对话里没有加载这条消息: 'That message is not loaded in the main chat.',
  有新动态: 'New activity',
  刚刚检查过: 'Last checked just now',
  '{n} 分钟前检查过': 'Last checked {n## minute ago|# minutes ago}',
  '{time}检查过': 'Last checked {time}',
  '{n} 个文件夹': '{n## folder|# folders}',
  它自称: 'It calls itself',
  在这台工作: 'Work here',
  'Agent 的权限': 'Agent access',
  'Agent 在这台电脑上能用的文件夹': 'Folders the agent can use on this computer',
  还没有开放任何文件夹: 'No folders shared yet',
  已开放: 'On',
  未开放: 'Off',
  '这台电脑上有 {n} 个任务在跑。': '{n## task is|# tasks are} running on this computer.',
  '这台电脑上现在没有在跑的任务。': 'Nothing is running on this computer right now.',
  正在这台电脑上跑: 'Running on this computer',
  '{time}开始': 'started {time}',
  仅自己可见: 'Only you can see this',
  文档: 'Documents',
  设计: 'Designs',
  网页: 'Web pages',
  代码改动: 'Code changes',
};
