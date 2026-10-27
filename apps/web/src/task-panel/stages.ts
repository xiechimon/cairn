import type { Phase } from '../fixtures/records.js';

export type StageState = 'done' | 'cur' | 'wait' | 'failed' | 'not';

export const STAGES = ['方案', '执行', '审阅', '合并'] as const;

const POSITION: Record<Phase, { at: number; state: StageState }> = {
  todo: { at: 0, state: 'not' },
  queued: { at: 0, state: 'not' },
  closed: { at: 0, state: 'not' },
  planning: { at: 0, state: 'cur' },
  confirm: { at: 0, state: 'wait' },
  building: { at: 1, state: 'cur' },
  failed: { at: 1, state: 'failed' },
  review: { at: 2, state: 'wait' },
  done: { at: STAGES.length, state: 'done' },
};

export function stagesFor(
  phase: Phase,
  task: { awaitingReply: boolean; hasPlan: boolean },
): StageState[] {
  const base = POSITION[phase];
  const at =
    (phase === 'failed' && !task.hasPlan) || (phase === 'review' && task.awaitingReply)
      ? base.at - 1
      : base.at;
  const state = task.awaitingReply && base.state !== 'done' ? 'wait' : base.state;
  return STAGES.map((_, i) => (i < at ? 'done' : i === at ? state : 'not'));
}
