// Detail top bar (issue #56; Paper top bar, paper-redesign-plan PR 7): back
// link, serif task title, #seq, the status (icon + color + label) that
// toggles the assignment popover, then 更多 and the phase's one ink primary button.
// #58: the back link carries the current search string home so the
// dev/fixture ?scenario= selection survives the round trip. #1255: each
// column list's scrollTop is restored by BoardSurface from sessionStorage.

import { Activity, Hourglass } from 'lucide-react';
import { type Ref, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ChevronLeft, EllipsisVertical } from '../icons/index.js';
import { type ChipAgentModel, ChipPopover } from '../overlays/chip-popover.js';
import { PHASE_STATUS, PHASE_UI, RUNNING_INK } from '../phase.js';

interface DetailHeadProps {
  todo: TodoRecord;
  /** Chip popover 执行对话 row: the model of `todo.agent` (live only). */
  agentModel?: ChipAgentModel;
  /** Rendered phase; the reject chain overrides the record's phase
   *  (replan streaming / building rounds, issue #75). */
  phase?: TodoRecord['phase'];
  /** #66: opens the 更多 menu popover. */
  onMore?: () => void;
  /** Primary button (开始/确认/完成/重开/重跑); the page decides what it
   *  does — the reject chain's 确认 step, the failed 重跑 dialog (#75). */
  onAction: () => void;
  /** Scenario-frozen initial open state of the chip popover (#67). */
  chipPopoverOpen?: boolean;
  /** #209: chip popover「编辑分配」入口——关 popover 后由页层开 agent 选择
   *  弹层(弹层挂页层:popover 关即卸载,挂内层会被带走)。 */
  onEditAssign?: () => void;
  /** M7 #312 / r8 §3.1：审核中态旗标——chip 改「审核中」、composer placeholder
   * 改「AI 审核进行中…」、期间显示停止钮（复用 #308）。 */
  reviewActive?: boolean;
  /** #1250 / ADR 0018 层 1：验证中态旗标——chip 改「验证中」（reviewActive
   *  同律：额外 agent 步，phase 不动）。verify 优先于 review 显示（同刻
   *  并行时验证是更晚的相位事实）。 */
  verifyActive?: boolean;
  /** #1216：在飞编排回合（todo 开始 / failed 重跑 已发出，chief 尚未落位）
   *  ——主钮翻禁用「编排中」，相位不动的静默窗口显性化。缺省 false =
   *  fixture 面与既有行为零变化。 */
  actionInFlight?: boolean;
  /** #1008: 更多 钮的定位锚 ref（MoreMenu 迁 DropdownMenu 后触发钮与菜单体
   *  分住两层，页面层持 ref 双投：这里挂到钮上，Content 走 anchor）。 */
  moreButtonRef?: Ref<HTMLButtonElement>;
}

export function DetailHead({
  todo,
  agentModel,
  phase,
  onMore,
  onAction,
  chipPopoverOpen,
  onEditAssign,
  reviewActive,
  verifyActive,
  actionInFlight,
  moreButtonRef,
}: DetailHeadProps) {
  const { t } = useI18n();
  const shown = phase ?? todo.phase;
  // The review/verify steps are extra agent steps (phase stays confirm/review),
  // so their words and the green ink come from the active step, not the phase.
  // #1261: a quota hold says 等额度 instead of a misleading 执行中.
  const status = verifyActive
    ? { chip: '验证中', icon: Activity, ink: RUNNING_INK }
    : reviewActive
      ? { chip: '审核中', icon: Activity, ink: RUNNING_INK }
      : todo.quotaWait != null
        ? { chip: '等额度', icon: Hourglass, ink: 'text-content-secondary' }
        : { chip: PHASE_UI[shown].chip, ...PHASE_STATUS[shown] };
  const action = PHASE_UI[shown].action;
  const { search } = useLocation();
  const [popover, setPopover] = useState(chipPopoverOpen === true);
  const StatusIcon = status.icon;
  return (
    <header
      className="detail-head flex h-14 flex-none items-center gap-3 border-b border-border px-6 whitespace-nowrap"
      data-testid="detail-head"
    >
      <Link
        className="-mr-1 -ml-2 flex size-7 flex-none items-center justify-center rounded-md text-content-tertiary hover:bg-muted"
        to={{ pathname: '/app', search }}
        aria-label={t('返回')}
      >
        <ChevronLeft width={16} height={16} />
      </Link>
      <h1
        className="min-w-0 truncate font-heading text-page font-medium text-foreground"
        title={todo.title}
        data-testid="detail-title"
      >
        {todo.title}
      </h1>
      <span className="flex-none text-meta tabular-nums text-content-tertiary">#{todo.seqNum}</span>
      {/* #1008: Base UI Popover; initialFocus=false keeps focus on the trigger
          so the same key closes it again (#666). #634: the chevron sits inside
          the trigger, one hit area. */}
      <Popover open={popover} onOpenChange={setPopover}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              data-testid="phase-chip"
              data-tone={PHASE_UI[shown].tone}
              className={`detail-chip -ml-1.5 h-7 flex-none gap-1.5 px-1.5 text-ui font-normal ${status.ink}`}
            />
          }
        >
          <StatusIcon aria-hidden strokeWidth={1.75} className="size-3.5" />
          {t(status.chip)}
          <span className="flex flex-none text-content-tertiary" data-testid="chip-chevron">
            <ChevronDown width={12} height={12} />
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          alignOffset={-6}
          sideOffset={8}
          initialFocus={false}
          aria-label={t('任务分配')}
          className="w-74.5"
        >
          <ChipPopover
            todo={todo}
            agentModel={agentModel}
            onEditAssign={
              onEditAssign == null
                ? undefined
                : () => {
                    // Close first: the dialog lives on the page and the two
                    // overlays never stack.
                    setPopover(false);
                    onEditAssign();
                  }
            }
          />
        </PopoverContent>
      </Popover>

      <div
        className="ml-auto flex flex-none items-center gap-0.5"
        data-testid="detail-head-actions"
      >
        <Button
          variant="ghost"
          ref={moreButtonRef}
          size="icon-sm"
          className="detail-head-icon--more flex-none text-content-secondary"
          aria-label={t('更多')}
          onClick={onMore}
        >
          <EllipsisVertical />
        </Button>
        {action != null &&
          (actionInFlight === true ? (
            // #1216: a start/rerun already went out; a second click would
            // spawn another orchestration thread.
            <Button
              className={`detail-head-action ${TOPBAR_PRIMARY_BUTTON}`}
              data-orchestrating="true"
              disabled
            >
              {t('编排中')}
            </Button>
          ) : (
            <Button className={`detail-head-action ${TOPBAR_PRIMARY_BUTTON}`} onClick={onAction}>
              {t(action)}
            </Button>
          ))}
      </div>
    </header>
  );
}
