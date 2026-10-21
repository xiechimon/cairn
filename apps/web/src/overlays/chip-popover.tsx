// Status-chip popover (issue #67, r7 19 / 29): 298×193 panel anchored under
// the detail-header chip (left = chip − 18, top = chip bottom + 3.5, r7
// §3.5 @ (287,34.5)). Structure verbatim from the captures: project head
// (12px avatar + name + #seq), two-line title, divider, 任务 section
// (assignee row), the selected 执行对话 section (agent row + indigo check,
// the highlight covering label and row), divider, 编辑分配 row.
// #1008（#983 判决：floating-shell 族拆退役）：壳/定位/皮肤（298×193 冻结
// 几何、V2 弹层壳、描边 Arrow、手挂 role=dialog）退役——本组件只剩内容列，
// 外壳归 dhead 的 registry Popover（Positioner 锚定 + Content 默认皮肤，
// 宽度 layout 槽住消费点）。
// 选中 section 的状态载体 = data-selected（#910 裁定 3）；两行是纯展示
// div（无 role），行族载体 = data-row-kind（owner/agent，头像 spec 的
// 语义盲区继任者）。

import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { AGENT_MODEL_LINE, PROJECT_INITIAL, PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Settings } from '../icons/index.js';

/** 行节奏（#1008 用户复核：内里对齐同族浮层）：DropdownMenuItem 同拍——
 *  min-h-8 行 / rounded-md / px-1.5 / text-sm；hover 淡 tint =
 *  --accent-soft 同值（150ms 背景过渡同档）；头像 img 12px 圆形（身份
 *  tile 尺寸是内容语义，不随节奏放大）。旧 26px/11px 密档是 per-face
 *  捕获残留，registry 节奏赢（ADR 0012 D1）。 */
const POPOVER_ROW =
  'flex min-h-8 items-center gap-2.5 rounded-md px-1.5 text-sm leading-5 text-(--text-tertiary) transition-[background-color] duration-150 hover:bg-(--accent-soft) [&_img]:size-3 [&_img]:flex-none [&_img]:rounded-full';

/** 节标签 = DropdownMenuLabel 节奏（text-xs medium muted）。 */
const SECTION_LABEL = 'px-1.5 text-xs leading-4 font-medium text-muted-foreground';

export function ChipPopover({ todo, agentModel, onEditAssign }: ChipPopoverProps) {
  const { t } = useI18n();
  // XMON-105: the 任务 (owner) row shows the logged-in user's own identity
  // avatar — single source, same face as the sidebar chip / account head.
  const { user, live } = useLiveData();
  const modelLine = live
    ? agentModel && `${agentModel.modelId} · ${agentModel.thinkingLevel ?? t('默认')}`
    : AGENT_MODEL_LINE;
  const agentAvatarUrl = useAgentAvatarUrlById();
  return (
    <div className="chip-popover flex flex-col gap-1.5 text-left">
      {/* #1008 用户复核（内里节奏）：micro-padding（pt-[5px]/pb-2/pt-2）退役，
          段落间距归 root gap-1.5 + PopoverContent 默认 p-2.5；字号抬到
          registry popover 档（正文 text-sm、meta text-xs）。 */}
      <div className="flex items-center gap-2 px-1.5">
        <span className="flex size-3 flex-none items-center justify-center rounded-[4px] bg-(--project-avatar-bg) text-[8px] font-medium text-(--project-avatar-fg)">
          {PROJECT_INITIAL}
        </span>
        <span className="text-xs leading-4 text-(--text-tertiary)">{PROJECT_NAME}</span>
        {/* #序号墨 = --text-tertiary（#949 better-colors 换槽，search-panel
            时间列同判：--text-dim × --popover-bg 亮模 2.89 < 地板 3） */}
        <span className="text-xs leading-4 text-(--text-tertiary)">#{todo.seqNum}</span>
      </div>
      <div className="px-1.5 text-sm leading-5 text-(--foreground)">{todo.title}</div>
      <div className="h-px flex-none bg-(--border)" />
      <div className="flex flex-none flex-col gap-0.5">
        <div className={SECTION_LABEL}>{t('任务')}</div>
        <div className={POPOVER_ROW} data-row-kind="owner">
          <SeededAvatar
            className="size-3"
            name={user.displayName}
            src={user.avatarUrl}
            fallback="/avatar-user.png"
          />
          {user.displayName}
        </div>
      </div>
      <div
        className="flex flex-none flex-col gap-0.5 rounded-md bg-(--spot-soft) px-1 py-1"
        data-selected=""
      >
        <div className={SECTION_LABEL}>{t('执行对话')}</div>
        <div className={POPOVER_ROW} data-row-kind="agent">
          <SeededAvatar
            className="size-3"
            name={todo.agent?.displayName}
            src={todo.agent ? (agentAvatarUrl.get(todo.agent.id) ?? null) : null}
            fallback="/avatar-robot-1.svg"
          />
          {/* 未指派 fallback is [推断]: every capture shows an assigned agent */}
          {todo.agent?.displayName ?? t('未指派')}
          {modelLine !== undefined && ` · ${modelLine}`}
          <span className="ml-auto flex text-(--card-button)">
            <Check width={14} height={14} />
          </span>
        </div>
      </div>
      <div className="h-px flex-none bg-(--border)" />
      {/* 编辑分配行（#949 ghost 全通道中和保留；#1008 节奏对齐：min-h-8 /
          rounded-md / px-1.5 / text-sm = 行族同拍，旧 flex-1 吃余高随固定
          193 高退役）。 */}
      <Button
        variant="ghost"
        size="default"
        className="min-h-8 flex-none cursor-pointer justify-start gap-2 rounded-md border-none bg-transparent px-1.5 text-left text-sm leading-5 font-normal whitespace-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
        onClick={onEditAssign}
      >
        <Settings width={14} height={14} />
        {t('编辑分配')}
      </Button>
    </div>
  );
}

export interface ChipAgentModel {
  modelId: string;
  thinkingLevel: string | null;
}

interface ChipPopoverProps {
  todo: TodoRecord;
  /** Live: the model of `todo.agent` from the page's members read; absent =
   *  no model segment (unassigned, read pending/failed, or no model set).
   *  Fixture: ignored, the row shows the capture canon. */
  agentModel?: ChipAgentModel;
  /** #209「编辑分配」接线:点击开 agent 选择弹层(#182 家族形态);弹层挂
   *  在页层(popover 关即卸载,挂内层会被带走)。 */
  onEditAssign?: () => void;
}
