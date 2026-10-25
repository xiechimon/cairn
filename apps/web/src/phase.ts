import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  GitPullRequest,
  ListChecks,
} from 'lucide-react';
import type { Phase } from './fixtures/records.js';

export interface PhaseUi {
  chip: string;
  tone: 'idle' | 'plan' | 'confirm' | 'done' | 'failed';
  action: string | null;
  placeholder: string | null;
}

export const IN_FLIGHT_PHASES: ReadonlySet<Phase> = new Set<Phase>(['planning', 'building']);

export const isInFlightPhase = (phase: string): boolean => IN_FLIGHT_PHASES.has(phase as Phase);

export const PHASE_UI: Record<Phase, PhaseUi> = {
  todo: { chip: '待开始', tone: 'idle', action: '开始', placeholder: null },
  queued: { chip: '排队中', tone: 'idle', action: null, placeholder: null },
  planning: {
    chip: '规划中',
    tone: 'plan',
    action: null,
    placeholder: '向 Agent 补充说明，执行过程中即可送达',
  },
  confirm: { chip: '确认', tone: 'confirm', action: '确认', placeholder: '请求修改…' },
  building: {
    chip: '执行中',
    tone: 'plan',
    action: null,
    placeholder: '向 Agent 补充说明，执行过程中即可送达',
  },
  review: { chip: '审核', tone: 'confirm', action: '完成', placeholder: '请求修改…' },
  done: { chip: '已完成', tone: 'done', action: '重开', placeholder: null },
  failed: {
    chip: '失败',
    tone: 'failed',
    action: '重跑',
    placeholder: '请求修改…',
  },
  closed: { chip: '已取消', tone: 'idle', action: null, placeholder: null },
};

const ACCENT_INK = 'text-(--card-button)';
export const RUNNING_INK = 'text-running-text';
const QUIET_INK = 'text-content-tertiary';

export const PHASE_STATUS: Record<Phase, { icon: LucideIcon; ink: string }> = {
  todo: { icon: CircleDashed, ink: QUIET_INK },
  queued: { icon: CircleDashed, ink: QUIET_INK },
  planning: { icon: Activity, ink: RUNNING_INK },
  building: { icon: Activity, ink: RUNNING_INK },
  confirm: { icon: ListChecks, ink: ACCENT_INK },
  review: { icon: GitPullRequest, ink: ACCENT_INK },
  failed: { icon: CircleX, ink: ACCENT_INK },
  done: { icon: CircleCheck, ink: QUIET_INK },
  closed: { icon: Ban, ink: QUIET_INK },
};
