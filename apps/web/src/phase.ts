// Phase → UI copy matrix (issue #56): the single table both the detail
// header and the board card action read (one source for 开始/确认/完成/
// 重开). Two word lists again (CONTEXT.md
// ruling): board column names vs the detail chip words — `待验收`≡`审核`,
// `待确认`≡`确认`, fresh≡`待处理`. Chip pills, main-button copy and
// composer placeholders measured from the r7 captures (23 light/dark, 16
// light, 17 light/dark) and r5b §3.3/§3.6 + r6 §4.4 (main-button copy
// table incl. `重开`). Rows no capture exercises carry [推断].

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
  /** Status chip word. */
  chip: string;
  /** Chip color tone. */
  tone: 'idle' | 'plan' | 'confirm' | 'done' | 'failed';
  /** Header primary button copy; null = no button (planning/building). */
  action: string | null;
  /** Composer textarea placeholder; null = no composer (fresh). */
  placeholder: string | null;
}

/** 在飞相位：这两态 UI 没有主按钮（`action === null`，见下表）——人按不动，
 *  下一态只能由服务端推过来。所以「界面上还有实体停在这两态」是「服务端本该
 *  在推东西」的可观测证据，也是唯一可用的一条（XMON-60 的静默对账闸门读它，
 *  看板「执行中」列收的正是这两态）。 */
export const IN_FLIGHT_PHASES: ReadonlySet<Phase> = new Set<Phase>(['planning', 'building']);

/** 在飞判据（phase 九值枚举上的纯函数）。入参收 string：调用面常拿运行时
 *  值来问（查询缓存里的行），不必先窄化成 Phase。 */
export const isInFlightPhase = (phase: string): boolean => IN_FLIGHT_PHASES.has(phase as Phase);

export const PHASE_UI: Record<Phase, PhaseUi> = {
  todo: { chip: '待处理', tone: 'idle', action: '开始', placeholder: null },
  queued: { chip: '待处理', tone: 'idle', action: '开始', placeholder: null },
  planning: {
    chip: '规划中',
    tone: 'plan',
    action: null,
    placeholder: '向 Agent 补充说明，执行过程中即可送达',
  },
  confirm: { chip: '确认', tone: 'confirm', action: '确认', placeholder: '请求修改…' },
  // building chip copy from the r7 26 capture (`执行中`); failed/closed
  // rows stay [推断] (no capture exercises them).
  building: {
    chip: '执行中',
    tone: 'plan',
    action: null,
    placeholder: '向 Agent 补充说明，执行过程中即可送达',
  },
  review: { chip: '审核', tone: 'confirm', action: '完成', placeholder: '请求修改…' },
  // done drops the composer (r7 36/36d show none) — placeholder null
  done: { chip: '已完成', tone: 'done', action: '重开', placeholder: null },
  // r8 54/73 (dual-subject canon): red chip `失败`, header primary `重跑`,
  // composer keeps the writable-review placeholder but drops the AI 审核
  // tool (r8 §3.1). Board card word differs (`重试`, columns.ts).
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

/** Status glyph + ink per phase, shown next to the PHASE_UI chip word (the
 *  detail head, project task rows): terracotta for the three needs-you
 *  phases, green while an agent runs, ink greys otherwise (DESIGN.md
 *  强调色纪律). */
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
