import { Activity, Hourglass } from 'lucide-react';
import { type Ref, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ChevronLeft, EllipsisVertical } from '../icons/index.js';
import { type ChipAgentModel, ChipPopover } from '../overlay/chip-popover.js';
import { PHASE_STATUS, PHASE_UI, RUNNING_INK } from '../phase.js';

interface DetailHeadProps {
  todo: TodoRecord;
  projectName?: string;
  agentModel?: ChipAgentModel;
  phase?: TodoRecord['phase'];
  onMore?: () => void;
  onAction: () => void;
  chipPopoverOpen?: boolean;
  onEditAssign?: () => void;
  reviewActive?: boolean;
  verifyActive?: boolean;
  actionInFlight?: boolean;
  moreButtonRef?: Ref<HTMLButtonElement>;
}

export function DetailHead({
  todo,
  projectName,
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
            projectName={projectName}
            agentModel={agentModel}
            onEditAssign={
              onEditAssign == null
                ? undefined
                : () => {
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
