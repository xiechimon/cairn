// phase 九值权威（02 §4.1，锁定）——复刻全线的唯一 phase 词表源。
// 内部名取 docs 序；`exec` 为 r3 早期猜测，已作废正名 `building`（02 §4.1）。
// 本模块刻意零依赖（不 import zod）：web 端可直接消费而不拖入 schema 运行时。
// zod schema 版见 records/common.ts（phaseSchema，由本表派生）。

export const PHASE_VALUES = [
  'todo',
  'queued',
  'planning',
  'confirm',
  'building',
  'review',
  'done',
  'failed',
  'closed',
] as const;

export type Phase = (typeof PHASE_VALUES)[number];

/** 语义 = docs 原文（02 §4.1 表）。 */
export const PHASE_SEMANTICS: Readonly<Record<Phase, string>> = {
  todo: '已建档未开始',
  queued: '已启动，等空闲机器',
  planning: '读仓库写计划',
  confirm: '计划就绪等你',
  building: '在改',
  review: '改动就绪等你（`待验收`≡`审核` 同 phase，CONTEXT.md 裁决）',
  done: '已接受，若选了则已合并',
  failed: 'run 停在错误上',
  closed: '未完成即搁置',
};

/** 「进行中」判据——原创件里的 `In progress` 桶（Agent 详情「进行中」段与
 *  总管 Progress 的三桶 In progress / To review / Failed 同源）。原件谓词逐字：
 *  `phase === 'queued' || BUSY_PHASES.includes(phase)`，
 *  `BUSY_PHASES = ['planning','building','plan_reviewing','implement_reviewing']`；
 *  同包内 review/confirm 归「等你」（`isAwaitingUser`）、failed 单列、todo 未启动。
 *  本仓九值词表下 = queued / planning / building（两个 reviewing 子相本仓未采，
 *  九值权威见 02 §4.1）。 */
export const IN_PROGRESS_PHASES = ['queued', 'planning', 'building'] as const;

/** 工作台 4 列（#351；前身 = r2 §4.1 的 6 列折叠）——列只是 phase 的折叠
 *  视图，非独立实体（CONTEXT.md）。 */
export const BOARD_COLUMNS = ['待开始', '执行中', '待处理', '已完成'] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/**
 * 列映射单键 phase（#351：原 phase × hasChanges 双键折叠随 6→4 列收敛退役）：
 * gate 三态（confirm / review / failed）同入 `待处理`——方案确认、变更验收、
 * 失败重试都是等用户处理的事；review+awaitingReply 与 failed 的钉顶是渲染
 * 行为（web columns.ts sortColumnTodos），列归属同 `待处理`。
 * `queued→执行中`（#1447）：已开始的卡停在它的构建将要跑的那一步（参考站
 * changelog 2026-09-12「a queued todo sits on the step its build will run」），
 * 取代旧的 `queued→待开始` [推断] 折叠；待开始只收未开始的 todo。
 * `done` 列语义 =「已完成（近 7 天）」（changelog "Done (last 7 days)"）。
 */
export function boardColumnFor(phase: Phase): BoardColumn | null {
  switch (phase) {
    case 'todo':
      return '待开始';
    case 'queued':
    case 'planning':
    case 'building':
      return '执行中';
    case 'confirm':
    case 'review':
    case 'failed':
      return '待处理';
    case 'done':
    case 'closed':
      // #1247：canceled（closed）与 done 同列展示，卡面加「已取消」标记。
      return '已完成';
  }
}

/** 手动改相面落点集（#160 看板拖拽）= 持落点列 dropPhase 正名（web columns.ts
 *  COLUMNS[].dropPhase 的同表镜像，columns.test.ts 有自动对拍钉单源）。
 *  拖拽只产生「源相占列 → 目标列」：`closed` 与 done 同列（#1247 canceled）；拖入走 canBoardDrop→closed，不占 BOARD_DROP_PHASES 白名单。
 *  #753（todos.dev 2026-10-03/04 live 重测，推翻 #351 的「待处理不作落点」）：
 *  `待处理` 收 已完成→待处理 的重开落位，落点正名 `review`（重开回审核关口
 *  [设计]——参考站 wire 未能采到：其机器离线，见 #753 侦察记录）。边级合法性
 *  不在本表：见 canBoardDrop（源列 × 目标列矩阵）。
 *  官方 PATCH wire 未抓（r3 §3.10 合成拖拽未复现；2026-10-04 实测参考站落位
 *  走语义动作端点 POST complete/uncomplete，本仓载体仍 = PATCH phase [设计]）；
 *  系统流仍走 PHASE_TRANSITIONS 漏斗（server services/phase.ts）。 */
export const BOARD_DROP_PHASES: readonly Phase[] = ['todo', 'building', 'review', 'done'];

/** 手动列迁移矩阵（#753，todos.dev 2026-10-03/04 live 重测）：源相占列 →
 *  目标落点相的边级判据。实测钉死的格子：
 *  - 每张卡都可拖（含 待处理/已完成——2026-10-02 旧测「不可拖」已推翻）；
 *  - 执行中 只吃 待开始 拖入（拖入 = 开始意图；待处理/已完成 源恒素面）；
 *  - 待处理 只吃 已完成 拖入（2026-10-04 实测：无变更产物的 done 卡拖拽时
 *    待处理 恒素面——hasChanges 数据闸在 server updateTodo / web
 *    canDropOnColumn，本函数只答相位级的边）；待开始→待处理 恒素面；
 *  - 已完成 吃 待开始/执行中/待处理 的拖入，含 failed（#1247 手动关边）。
 *    系统漏斗 PHASE_TRANSITIONS 仍拒 failed→done。
 *  - 源列全程素面（同列落位 = 无操作，dnd.ts moveTodo 恒等）。
 *  执行中 源行未测（参考站机器离线，列进不去卡）：沿用本仓既有语义
 *  （→待开始/已完成 合法，→待处理 不收）[设计]。 */
export function canBoardDrop(from: Phase, to: Phase): boolean {
  if (from === to) return false;
  // #1247：closed 在已完成列。出列重开同 done（→todo / →review）；入列
  // canceled 与 done 同缘（任一占列源均可，含 failed）。
  if (from === 'closed') {
    return to === 'todo' || to === 'review';
  }
  if (to === 'closed') {
    // 已完成卡再标取消无意义；其余占列源可进 canceled。
    return boardColumnFor(from) != null && from !== 'done';
  }
  if (!BOARD_DROP_PHASES.includes(to)) return false;
  const src = boardColumnFor(from);
  if (src == null) return false;
  switch (to) {
    case 'todo':
      return src !== '待开始';
    case 'building':
      return src === '待开始';
    case 'review':
      return src === '已完成';
    case 'done':
      return true;
    default:
      // 非落点相（queued/planning/confirm/failed）——上面的白名单
      // 守卫已挡，这里只是穷尽 Phase 联合的兜底。
      return false;
  }
}
