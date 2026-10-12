// Scenario mechanism (issue #52): `?scenario=<研究截图编号>` query parameter
// selects a deterministic fixture set, one id per research capture so fixture
// rows never drift in content — r7 numbers for the board/detail
// rows, r5 numbers for the chief rows (#72; the chief surfaces have no r7
// shot). Route behaviour never branches on the parameter — it only picks
// data inside the fixture layer, which is the app's whole data source in
// this fixture-driven phase.
// #58 gate: the parameter is dev/test-only — honoured by `vite dev`
// (import.meta.env.DEV) and by the fixture build's `vite build --mode
// fixture`; a plain production build ignores it and always serves the
// default board set, so the param can never leak into shipped behaviour.
// Unknown or absent ids fall back to the default board set.

import {
  agentDelete,
  agentDetail,
  agentDetailActive,
  agentDetailMemory,
  agentDetailSecrets,
  apiKeysCreated,
  boardChiefProbes,
  boardDarkFresh,
  boardDefault,
  boardDragMatrix,
  boardFailed,
  boardGithubPicker,
  boardMachinePicker,
  boardOverflow,
  boardProjectPicker,
  boardR8Overlay,
  boardRepoFilter,
  boardResetGate,
  boardStress,
  boardTagFilter,
  boardTagFilterEmpty,
  boardWithProbe,
  chiefAgentChip,
  chiefFabAvatar,
  chiefFabAvatarOverride,
  chiefGated,
  chiefMarkdown,
  chiefReady,
  chiefScrollLong,
  chiefSettings,
  chiefSettingsMachines,
  chiefSettingsStaleModel,
  chiefStreaming,
  chiefThread,
  chiefThreadsLong,
  chiefThreadsOpen,
  compareMenuV2,
  detailBuilding,
  detailConfirm,
  detailDiffWordStress,
  detailDone,
  detailFailed12,
  detailFailed15Set,
  detailFailedCurrent,
  detailFresh,
  detailFreshDark,
  detailLegacy,
  detailLegacyNow,
  detailPlanning,
  detailR8Confirm,
  detailR8DeleteFresh,
  detailR8Fresh,
  detailReview,
  detailSpinnerQuiescent,
  detailV3Collapsed,
  detailVerifyVerdict,
  diffV1V2,
  diffV2V3,
  history12,
  history15,
  machinesChiefState,
  mdToolout,
  planOpenReview,
  projectFixture,
  projectLocalFiles,
  projectTasks,
  projectTasksEmpty,
  r7,
  rerunDialog12,
  rerunDialog15,
  resourcesCcBinGone,
  resourcesCcLegacy,
  resourcesCcLoggedOut,
  resourcesCcMissing,
  resourcesCcNoConfig,
  resourcesDefault,
  reusedBuilding,
  reusePanel15,
  revisionChain,
  revisionStreaming,
  schedulesEmpty,
  schedulesFormDaily,
  schedulesFormOnce,
  schedulesList,
  skillInject,
  skillInjectZero,
  skillsRouting,
  teamGrid,
  teamOrgChart,
  teamOrgChartEmpty,
  versionMenuV2,
  versionMenuV3,
} from './fixtures.js';
import type { FixtureSet } from './records.js';

export const SCENARIO_PARAM = 'scenario';

/** #58 gate: scenario selection exists only in dev (`vite dev`) and in the
 *  fixture-mode build (`vite build --mode fixture`). A plain production
 *  build folds this to false at compile time. */
const SCENARIOS_ENABLED = import.meta.env.DEV || import.meta.env.MODE === 'fixture';

/** r7 capture number → fixture set. Board rows bind board scenarios,
 *  detail rows bind single-todo detail scenarios, resource rows (06–10)
 *  bind the shared resources set. `now` inside each set
 *  is the capture instant (keeps relative labels deterministic).
 *  Detail ids follow the r7 manifest filenames: 16d is the dark confirm
 *  capture with the user-menu popover, 17/17d/17b the confirm surface
 *  with/without it. */
/** W4 #289：scenario 集合构造收进启用门——生产构建折叠为 `{}`（#58 gate
 * 的补全：原顶层字面量在各 scenario 工厂即调即构，DCE 视作可达副作用，
 * 79KB 语料随主包出街）。dev/fixture 两形照常构造。 */
export const SCENARIOS: Record<string, FixtureSet> = SCENARIOS_ENABLED
  ? ({
      // board (r7 01–03, 21–22, 33, 35)
      '01': boardDefault,
      '01b': boardDefault,
      '02': boardWithProbe('confirm', r7(13, 26), r7(13, 35)),
      '02b': boardWithProbe('confirm', r7(13, 26), r7(13, 35)),
      '03': boardDefault,
      '21': boardWithProbe('confirm', r7(13, 26), r7(13, 35)),
      // 22: capture shows `刚刚` (21px ink) — now must sit under a minute past
      // phaseAt, so pin the same whole minute (13:22 would hit the exact
      // 60s boundary and render `1 分钟前`).
      '22': boardWithProbe('todo', r7(13, 21), r7(13, 21)),
      '22d': boardDarkFresh,
      '33': boardWithProbe('review', r7(13, 37), r7(13, 45)),
      '35': boardWithProbe('done', r7(13, 52), r7(13, 55)),
      '35d': boardWithProbe('done', r7(13, 52), r7(13, 55)),
      // notification permission banner (issue #114): the r2 01/28/30 board
      // state — r7 baselines carry no banner, so the strip gets a named id
      // and rides smoke rows (04 §2: no-baseline rows self-compare)
      'notify-banner': { ...boardDefault, ui: { notificationBanner: true } },
      // #176 new-task dialog 项目选择器:命名场景(无 capture)——boardDefault
      // 面加 projectNames 双项目,e2e 钉选择器行为;无 fixture 行。
      'newtask-projects': boardProjectPicker,
      // #758 机器 chip 选择记忆：命名场景（无 capture，同上先例）——
      // boardDefault 面 + resources 两台机器（在线本机 + 离线远端），
      // e2e 钉「选→刷新→回上次那台」与两条降级路径。
      'newtask-machines': boardMachinePicker,
      // #361 新建项目 GitHub repo picker：命名场景（无 capture，
      // newtask-projects 先例）——boardDefault 面 + 已连接 github fixture，
      // e2e 钉 picker 搜索/单选回填/断开/着陆参行为。
      'github-picker': boardGithubPicker,
      // #403 看板标签筛选：命名场景（无 capture，同上先例）——board-tags
      // 跨列三卡（bug/docs/无标签）钉筛选行为；board-tags-empty 两卡全
      // tagged，钉板级空结果态。
      'board-tags': boardTagFilter,
      'board-tags-empty': boardTagFilterEmpty,
      // #753 拖动矩阵：命名场景（无 capture，board-tags 先例）——四列满员 +
      // 待处理三相 + 已完成两态（有/无变更），e2e 钉 per-source 合法目标
      // 矩阵与重开落位。
      'board-drag-matrix': boardDragMatrix,
      // #755 重置确认闸：命名场景（无 capture，同上先例）——started 卡落
      // 待开始开 dialog，零历史卡走静默改相。
      'board-reset-gate': boardResetGate,
      // #445 看板仓库筛选：命名场景（无 capture，同上先例）——board-repos
      // 三项目三卡（r3 两卡 + r2 一卡 + r4-quiet 零卡）钉仓库轴单选/多选/
      // 空态与「仓库 × 类型」双轴组合收窄。
      'board-repos': boardRepoFilter,
      // #504 看板列滚动：命名场景（无 capture，board-tags 先例）——待开始
      // 12 卡撑出溢出，e2e 钉行高不破视口、列头固定、列表自持滚动。
      'board-overflow': boardOverflow,
      // #692 看板最坏数据：命名场景（无 capture，board-overflow 先例）——
      // 超长标题 + 120 卡计数 + 空列，e2e 钉停靠/窄窗/RTL 下列不塌。
      'board-stress': boardStress,
      // detail (r7 16–17, 23, 26–28, 36, 38)
      '16': detailPlanning,
      '16d': detailConfirm(true),
      '17': detailConfirm(true),
      '17b': detailConfirm(false),
      '17d': detailConfirm(false),
      '23': detailFresh,
      '23d': detailFreshDark,
      // 26: light froze at 处理中...; 26d (dark) caught the later bash tool
      // row and has the user menu open
      '26': detailBuilding(false),
      '26d': detailBuilding(true),
      // 27d (dark) carries the user-menu popover; 27 light does not
      '27': detailReview({ userMenuOpen: false }),
      '27d': detailReview({ userMenuOpen: true }),
      '27b': detailReview({ userMenuOpen: false, changesExpanded: true }),
      '28': detailReview({ userMenuOpen: false, changesExpanded: true, toolsExpanded: true }),
      '36': detailDone(),
      '36d': detailDone(),
      '38': detailLegacy,
      // #366: plan-card activation pin (smoke surface, no capture): the
      // review changes face with a collapsed plan card in the thread
      'plan-open': planOpenReview,
      // #469 named scenario (no capture, plan-open precedent): the chat
      // block-rendering pin — an agent reply with raw block markdown + a
      // tool group whose bash stdout renders as left-aligned mono blocks
      'md-toolout': mdToolout,
      // #919 named scenario (no capture, md-toolout precedent): skill
      // routing rows (read + blocked) in the thread column and the 技能
      // summary section row in the pane type select
      'skills-routing': skillsRouting,
      // #1106 named scenario（skills-routing 先例）：注入回查行正例 + 零命中对照
      'skill-inject': skillInject,
      'skill-inject-zero': skillInjectZero,
      // #443 named scenario (no capture, notify-banner precedent): scenario
      // 16's planning surface + chiefUnread 3 — the unread-gated detail FAB
      // face (badge pass-through pin; the shell-consistency detail row and
      // chief-fab.spec ride it).
      'detail-unread': { ...detailPlanning, chiefUnread: 3 },
      // #471 named scenario (no capture, detail-unread precedent): the
      // building surface's quiescent gap — agent not streaming, task not
      // ended — the transcript's live cue is one loading indicator (#672:
      // loading-dev Atom) + the static 执行中... label row;
      // spinner-live.spec rides it.
      'spinner-quiescent': detailSpinnerQuiescent(),
      // #1101 named scenario (no capture, chief-threads-long precedent):
      // review 面 + diff 压力变更集——单词级 del/add 对、不等长 run、marker
      // 隔开的对、超长行与超限对；diff-word-highlight.spec 钉词级高亮与
      // 横向滚动下的底色宽度契约。
      'diff-word-stress': detailDiffWordStress(),
      // #1250（skills-routing 先例）：verify verdict 行三态钉——review 面叠
      // passed/failed/判定提取失败三条 verdict 行，persona-verify.spec 骑它。
      'verify-verdict': detailVerifyVerdict(),
      // #1250：review 弹层 frozen 面（fixture 面不点开——onReview 仅 live 接
      // 线，34 号 accept overlay 同律）——钉 fan-out 行在 fixture 面零渲染。
      'review-dialog-fanout': {
        ...detailReview({ userMenuOpen: false }),
        overlay: { kind: 'review' },
      },
      // frozen right-pane views (issue #68 captures, re-homed by #366):
      // 30/31/32 sit on the review surface with diff + tool rows expanded,
      // exactly as the captures froze them — the former token/branch/
      // history dialogs are static pane sections now
      '30': {
        ...detailReview({ userMenuOpen: false, changesExpanded: true, toolsExpanded: true }),
        ui: { paneView: 'token' },
      },
      '31': {
        ...detailReview({ userMenuOpen: false, changesExpanded: true, toolsExpanded: true }),
        ui: { paneView: 'branch' },
      },
      // r8 57: the failed-current run's history section
      '57f': { ...detailFailedCurrent(), ui: { paneView: 'history' } },
      '32': {
        ...detailReview({ userMenuOpen: false, changesExpanded: true, toolsExpanded: true }),
        ui: { paneView: 'history' },
      },
      // 34: board scrollRight, probe #9 in 待验收 (`4 分钟前` → now 13:41)
      '34': { ...boardWithProbe('review', r7(13, 37), r7(13, 41)), overlay: { kind: 'accept' } },
      // dark pairs (r8 78–81): probe #9 is gone from the live account,
      // so the dark captures ride the r3 legacy #1 surface as it stands now
      // (re-run 2026-09-22 18:30); the accept dialog opens from the header
      // 完成 button on the same detail surface
      '30d': detailLegacyNow({ ui: { paneView: 'token' } }),
      '31d': detailLegacyNow({ ui: { paneView: 'branch' } }),
      '32d': detailLegacyNow({ ui: { paneView: 'history' } }),
      '34d': detailLegacyNow({ overlay: { kind: 'accept' } }),
      // overlays (issue #67): frozen open-states on top of the surface each
      // r7 capture sits on — 05 the empty ⌘K panel over the default board,
      // 05b the results state over the #46-session board, 19/29 the chip
      // popover on the confirm/review split, 20 the 方案▾ dropdown.
      '05': { ...boardDefault, ui: { searchOpen: true } },
      '05b': {
        ...boardChiefProbes,
        ui: { searchOpen: true, searchQuery: 'r3 lifecycle probe' },
      },
      '19': { ...detailConfirm(false), ui: { chipPopoverOpen: true } },
      '20': { ...detailConfirm(false), ui: { planDropdownOpen: true } },
      '29': { ...detailReview({ userMenuOpen: false }), ui: { chipPopoverOpen: true } },
      // schedules (issue #71): 11 = the r7 empty-state capture; the list and
      // form states come from r3 93/92/92b, so their ids carry the source
      '11': schedulesEmpty,
      'r3-93': schedulesList,
      'r3-92': schedulesFormDaily,
      'r3-92b': schedulesFormOnce,
      // r8 dynamic states (issue #75): ids = the r8 capture numbers. 54/73
      // are the two failed-detail subjects, 55 the failed board card, 56/74
      // the rerun dialog without/with 复用方案, 57/77 the run-history open
      // states, 63–72 the reject loop (dropdown / compare submenu / diff
      // surfaces / replan streaming), 75 the reuse sub-panel, 76 the reused
      // build. 68 and 69 are the same surface (r8 pixel-audit note).
      '54': detailFailed12,
      '55': boardFailed,
      '56': rerunDialog12,
      '57': history12,
      '63': versionMenuV2,
      '64': compareMenuV2,
      '65': diffV1V2(false),
      '66': diffV1V2(true),
      '67': revisionStreaming,
      '68': detailV3Collapsed,
      '69': detailV3Collapsed,
      '70': versionMenuV3,
      '71': diffV2V3(false),
      '72': diffV2V3(true),
      '73': detailFailed15Set,
      '74': rerunDialog15,
      '75': reusePanel15,
      '76': reusedBuilding,
      '77': history15,
      // interactive reject chain (AC3): confirm v1 + revision script
      chain: revisionChain,
      // project routes (issue #71): one content set, the route + tab pick the
      // surface; the ids name the r2 capture each row binds to. prj-tasks =
      // the populated 任务 list, which r2 only ever shows beside the open todo
      // panel (26), so it carries no clean capture number of its own
      'r2-07': projectFixture,
      'r2-24': projectFixture,
      'r2-24b': projectTasksEmpty,
      'prj-tasks': projectTasks,
      // spec 12 / #362 G2-T2 v1：local 项目 文件 tab 禁用面（占位 + 文案）。
      'prj-local-files': projectLocalFiles,
      'r2-24c': projectFixture,
      // secondary routes (issue #70): 12/13 are the r7 team/account captures;
      // the api-keys id has no r7 capture (smoke matrix rows) and picks its
      // surface by name — the account page renders no fixture content at all,
      // so it rides the default set
      '12': teamGrid,
      // team chart 组织图（命名场景，无 capture）：3 成员树 + 零成员空态
      'team-org-chart': teamOrgChart,
      'team-org-chart-empty': teamOrgChartEmpty,
      // Agent 详情编辑面（r3 §4）：团队 roster + 该 agent 的全记录 + providers
      // 行集，一套内容同时供 /app/team 与 /app/resources/agents/:id 两个路由。
      'agent-detail': agentDetail,
      // XMON-19/B2 删除 Agent：同详情面 + 两个 roster 行（删除后名单还剩一个）。
      'agent-delete': agentDelete,
      // #510 密钥区聚合总开关：同详情面，resources 带两个团队密钥。
      'agent-detail-secrets': agentDetailSecrets,
      // #499 记忆 tab 的非空变体（命名场景，无 capture）：同 agent 的 3 条
      // 记忆，钉配额头 / 搜索过滤 / 排序两档。
      'agent-detail-memory': agentDetailMemory,
      // XMON-15 概览「进行中」段的非空变体（命名场景，无 capture）：同 agent
      // 的两行 build（等机器 / 跑起来），钉行形状、状态位映射与点击落点。
      // 空态不另开场景——agentDetail 自身不带 agentTasks，即 canon 空态。
      'agent-detail-active': agentDetailActive,
      '13': boardDefault,
      // account 语言 dropdown open state (issue #74; shape [设计], r2 §11 Q19)
      '13-lang': { ...boardDefault, ui: { langDropdownOpen: true } },
      // account 推送通知开关的权限三态表达面 (#1031)：denied 档起步关、点开出
      // 拦截解释。旧面硬编 granted 使「关不掉」被掩盖——本场景把 denied 显式化。
      '13-notify-denied': { ...boardDefault, ui: { notificationPermission: 'denied' } },
      'api-keys': boardDefault,
      'api-keys-created': apiKeysCreated,
      // resources (r7 06–10, issue #69): one shared row set — the captures
      // differ per route, not per content state
      '06': resourcesDefault,
      '07': resourcesDefault,
      '08': resourcesDefault,
      '09': resourcesDefault,
      '10': resourcesDefault,
      // #356 未安装分支（spec 11 §A4）：claude-code settings.json 缺失 →
      // header 未安装指引态的 fixture 钉
      '10-cc-missing': resourcesCcMissing,
      // #1050 装了没配态（二进制在、settings.json 缺）→ 主句「已安装，未配置模型槽」
      '10-cc-noconfig': resourcesCcNoConfig,
      // #1050 未登录态（二进制与配置都在、auth=not-logged-in）→ 细字行尾「未登录」角标
      '10-cc-loggedout': resourcesCcLoggedOut,
      // #1050 配置在但二进制没了（消假绿）→ 主句「未安装」
      '10-cc-bin-gone': resourcesCcBinGone,
      // #1050 老 daemon（bin 键缺席）→ 维持只看 installed 的旧行为
      '10-cc-legacy': resourcesCcLegacy,
      // #895 机器页三态读标注（spec 21 A8）：主力机徽标 / 回合进行中 /
      // 等待机器——machines 路由用（06 同面，命名场景手法同 newtask-machines）
      'machines-chief-state': machinesChiefState,
      // r8 overlay batch (#66): the dark capture set; ids carry the r8 batch
      // prefix like the r2/r3 rows (numbering continues after #64's 54–77)
      'r8-78': boardR8Overlay,
      'r8-79': detailR8Confirm(),
      'r8-80': detailR8Confirm(),
      'r8-81': detailR8Fresh,
      'r8-82': detailR8DeleteFresh,
      // chief (issue #72): ids follow the r5 capture numbers — the chief
      // surfaces have no r7 shot (r7 §6 gap table), so r5 100–116 number these
      // rows. Dark rows reuse the same ids with theme: 'dark' in the matrix.
      '100': chiefGated,
      '101': chiefSettings('agent'),
      '102': chiefSettings('charter'),
      '103': chiefSettings('memory'),
      '104': chiefSettings('watches'),
      // #358 AC2（spec 11 §A10）：compactionModel 仍引用已废 preset →
      // 裸串兜底回显的 fixture 钉（合成 scenario，10-cc-missing 先例）
      '101-stale-model': chiefSettingsStaleModel,
      // #895 主力机槽（spec 21 A6）：Agent tab 机器 chip 的回显/清单钉面
      //（合成 scenario，101-stale-model 先例；live PATCH 写读归 verify 证据）
      '101-machines': chiefSettingsMachines,
      '111': chiefReady,
      // #624 r5 113 流式面（回合进行中）：composer 占位 = steer canon 的钉面
      // （running 位；命名场景手法循 #499/#444 先例，流内容 [推断] 拼装）。
      '113': chiefStreaming,
      '114': chiefThread,
      '116': chiefThreadsOpen,
      // #1094 长列表滚动面命名场景（无 capture，chief-md 先例）：22 行线程
      // 的切换器——钉封顶 + 滚动可达 + 尾部可点（116 短列表面当零变化对照）。
      'chief-threads-long': chiefThreadsLong,
      // #1067 滚动保留面命名场景（无 capture，chief-threads-long 先例）：
      // 40 行消息流撑出远超窗高的滚动——钉「滚到中部→最小化→重开落原位」
      // 与停靠态可及树/焦点剔除（e2e/chief-minimize-scroll.spec）。
      'chief-scroll-long': chiefScrollLong,
      // #650/#651 markdown 面命名场景（无 capture，md-toolout 先例）：定稿
      // robot 行 raw markdown + typing 打字尾行，钉共用解析器进抽屉的渲染形。
      'chief-md': chiefMarkdown,
      // #741 agent 身份可点进设置命名场景（无 capture，chief-md 先例）：
      // robot 行身份 chip（头像+名字，带 id 成链）+ 五种提及 scheme 的
      // 成链/惰性对照 + 详情页 transcript 同场景第二消费面。
      'chief-agent-chip': chiefAgentChip,
      // #444 FAB 头像命名场景（无 capture，notify-banner 先例）：绑定
      // Agent 的头像骑上各族 FAB；override 变体钉 avatarUrl 覆盖优先。
      'fab-avatar': chiefFabAvatar,
      'fab-avatar-override': chiefFabAvatarOverride,
    } as Record<string, FixtureSet>)
  : {};

/** Resolve the scenario for a URL. Signature takes URLSearchParams so
 *  callers can pass through without coupling to window.location. */
export function resolveScenario(search: URLSearchParams): FixtureSet {
  if (!SCENARIOS_ENABLED) return boardDefault;
  const id = search.get(SCENARIO_PARAM);
  return (id != null ? SCENARIOS[id] : undefined) ?? boardDefault;
}
