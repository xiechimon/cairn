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

export const IN_PROGRESS_PHASES = ['queued', 'planning', 'building'] as const;

export const ORCHESTRATE_PHASES = ['todo', 'failed'] as const;

export const canOrchestrate = (phase: Phase): boolean =>
  (ORCHESTRATE_PHASES as readonly Phase[]).includes(phase);

export const BOARD_COLUMNS = ['待开始', '执行中', '待处理', '已完成'] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

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
      return '已完成';
  }
}

export const BOARD_DROP_PHASES: readonly Phase[] = ['todo', 'building', 'review', 'done'];

export function canBoardDrop(from: Phase, to: Phase): boolean {
  if (from === to) return false;
  if (from === 'closed') {
    return to === 'todo' || to === 'review';
  }
  if (to === 'closed') {
    return boardColumnFor(from) != null && from !== 'done';
  }
  if (!BOARD_DROP_PHASES.includes(to)) return false;
  const src = boardColumnFor(from);
  if (src == null) return false;
  switch (to) {
    case 'todo':
      return src !== '待开始';
    case 'building':
      return src === '待开始' && canOrchestrate(from);
    case 'review':
      return src === '已完成';
    case 'done':
      return true;
    default:
      return false;
  }
}
