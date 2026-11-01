import { type Ref, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useAgentAvatarUrlById, useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON } from '../board/filter-panel.js';
import { ProjectAvatar } from '../board/project-avatar.js';
import { useProjectMark } from '../board/project-mark.js';
import { relativeTime } from '../board/rel-time.js';
import { AgentPicker, type AgentPickerOption } from '../components/agent-picker.js';
import { type GlyphKind, StatusGlyph } from '../components/status-glyph.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, ChevronLeft, ChevronRight, EllipsisVertical } from '../icons/index.js';
import { StatusMenu } from '../overlay/status-menu.js';
import { PHASE_STATUS, PHASE_UI, RUNNING_INK } from '../phase.js';

interface DetailHeadProps {
  todo: TodoRecord;
  projectName?: string;
  phase?: TodoRecord['phase'];
  now?: number;
  onMore?: () => void;
  onAction: () => void;
  statusMenuOpen?: boolean;
  onMoveBack?: () => void;
  onMarkDone?: () => void;
  agentOptions?: AgentPickerOption[];
  onPickAgent?: (agentId: string) => void;
  agentRebindCopy?: string;
  reviewActive?: boolean;
  verifyActive?: boolean;
  actionInFlight?: boolean;
  moreButtonRef?: Ref<HTMLButtonElement>;
}

export function DetailHead({
  todo,
  projectName,
  phase,
  now,
  onMore,
  onAction,
  statusMenuOpen,
  onMoveBack,
  onMarkDone,
  agentOptions,
  onPickAgent,
  agentRebindCopy,
  reviewActive,
  verifyActive,
  actionInFlight,
  moreButtonRef,
}: DetailHeadProps) {
  const projectMark = useProjectMark();
  const { t } = useI18n();
  const shown = phase ?? todo.phase;
  const status: { chip: string; glyph: GlyphKind; ink: string } = verifyActive
    ? { chip: '验证中', glyph: 'three-quarter', ink: RUNNING_INK }
    : reviewActive
      ? { chip: '审核中', glyph: 'three-quarter', ink: RUNNING_INK }
      : todo.quotaWait != null
        ? { chip: '等额度', glyph: 'queued', ink: 'text-content-secondary' }
        : { chip: PHASE_UI[shown].chip, ...PHASE_STATUS[shown] };
  const { live } = useLiveData();
  const project = live ? projectName : PROJECT_NAME;
  const agentAvatarUrl = useAgentAvatarUrlById();
  const action = PHASE_UI[shown].action;
  const { search } = useLocation();
  const [popover, setPopover] = useState(statusMenuOpen === true);
  const inFlight = shown === 'planning' || shown === 'building';
  return (
    <header
      className="detail-head flex h-11 flex-none items-center gap-2.5 border-b border-border pr-3 pl-4 whitespace-nowrap max-md:h-13 max-md:gap-1.5"
      data-testid="detail-head"
    >
      <Link
        className="-ml-1 flex size-7 flex-none items-center justify-center rounded-md text-content-tertiary hover:bg-muted"
        to={{ pathname: '/app', search }}
        aria-label={t('返回')}
      >
        <ChevronLeft width={16} height={16} />
      </Link>
      <span className="flex flex-none items-center gap-1.5 text-meta text-content-tertiary">
        {project !== undefined && (
          <>
            <ProjectAvatar name={project} {...projectMark(project)} bare />
            <span className="max-w-40 truncate max-md:hidden">{project}</span>
            <span aria-hidden="true" className="max-md:hidden">
              /
            </span>
          </>
        )}
        <span className="tabular-nums max-md:hidden">#{todo.seqNum}</span>
      </span>
      <h1
        className="min-w-0 max-md:flex-1 truncate text-card-title font-semibold text-foreground"
        title={todo.title}
        data-testid="detail-title"
      >
        {todo.title}
      </h1>
      {todo.archivedAt != null && (
        <Badge variant="secondary" data-testid="archived-badge">
          {t('Archived')}
        </Badge>
      )}
      <Popover open={popover} onOpenChange={setPopover}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              aria-label={t(status.chip)}
              data-testid="phase-chip"
              data-tone={PHASE_UI[shown].tone}
              className="detail-chip h-7 flex-none gap-1.5 rounded-full pr-2 pl-1.5 text-ui font-medium text-foreground"
            />
          }
        >
          <StatusGlyph kind={status.glyph} className={status.ink} />
          <span className="max-md:hidden">{t(status.chip)}</span>
          <span
            className="flex flex-none text-content-tertiary max-md:hidden"
            data-testid="chip-chevron"
          >
            <ChevronDown width={12} height={12} />
          </span>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          alignOffset={-6}
          sideOffset={8}
          initialFocus={false}
          aria-label={t('任务状态')}
          className="w-72 gap-0 p-(--menu-pad)"
        >
          <StatusMenu
            phase={shown}
            elapsed={relativeTime(todo.phaseAt, now ?? Date.now(), t)}
            onMoveBack={
              onMoveBack == null
                ? undefined
                : () => {
                    setPopover(false);
                    onMoveBack();
                  }
            }
            onMarkDone={
              onMarkDone == null
                ? undefined
                : () => {
                    setPopover(false);
                    onMarkDone();
                  }
            }
          />
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex flex-none items-center gap-1" data-testid="detail-head-actions">
        {(todo.agent != null || agentOptions != null) && (
          <AgentPicker
            agents={agentOptions ?? []}
            selectedId={todo.agent?.id ?? null}
            onSelect={onPickAgent}
            rebindCopy={agentRebindCopy}
            footnote={
              inFlight
                ? t('更换 Agent 会重新开始当前这一步。')
                : t('后续步骤会改由所选 Agent 执行。')
            }
            trigger={
              <Button
                variant="ghost"
                size="sm"
                data-testid="agent-chip"
                aria-label={t('执行 Agent')}
                className="mr-1 h-7 flex-none gap-1.5 rounded-lg px-1.5 text-meta font-normal text-content-secondary aria-expanded:bg-(--menu-hover) max-md:hidden"
              />
            }
          >
            <SeededAvatar
              className="size-4.5"
              name={todo.agent?.displayName}
              src={todo.agent ? (agentAvatarUrl.get(todo.agent.id) ?? null) : null}
              fallback="/avatar-robot-1.svg"
            />
            <span>{todo.agent?.displayName ?? t('未指派')}</span>
            <ChevronDown width={12} height={12} className="flex-none text-content-tertiary" />
          </AgentPicker>
        )}
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
        {todo.archivedAt == null &&
          action != null &&
          (actionInFlight === true ? (
            <Button
              className={`detail-head-action ${TOPBAR_PRIMARY_BUTTON}`}
              aria-label={t('编排中')}
              data-orchestrating="true"
              disabled
            >
              <EllipsisVertical className="md:hidden" />
              <span className="max-md:hidden">{t('编排中')}</span>
            </Button>
          ) : (
            <Button
              className={`detail-head-action ${TOPBAR_PRIMARY_BUTTON}`}
              aria-label={t(action)}
              onClick={onAction}
            >
              <ChevronRight className="md:hidden" />
              <span className="max-md:hidden">{t(action)}</span>
            </Button>
          ))}
      </div>
    </header>
  );
}
