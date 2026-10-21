// Board todo card, Paper anatomy (DESIGN.md 任务卡): title (2 lines) → one
// meta row that never wraps → a footer chosen by cardFace(). Card root keeps
// data-todo-id, the stretched title link (#629 drag locks) and the
// todo-card / todo-card-title / todo-card-action / todo-card-branch aliases.

import { canOrchestrate } from '@pacman/shared';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Ban,
  Bot,
  Check,
  CircleX,
  Clock,
  FileText,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Hourglass,
  ListChecks,
  MessageCircle,
  Play,
  Reply,
  RotateCcw,
  Sparkles,
  Tag,
} from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useLiveData } from '../api/provider.js';
import type { CardOrchestration } from '../chief/orchestration-inflight.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import type { TagChipData } from '../components/ui/tag-chip.js';
import { PROJECT_NAME } from '../fixtures/fixtures.js';
import type { TodoRecord } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { PHASE_UI } from '../phase.js';
import { type CardFace, cardFace } from './columns.js';
import { relativeTime } from './rel-time.js';

interface TodoCardProps {
  todo: TodoRecord;
  now: number;
  /** Card action link (开始/重试/确认计划/审阅/回复); the page decides what
   *  it does (issue #68: review-phase 审阅 opens the accept dialog). */
  onAction?: (todo: TodoRecord) => void;
  /** Card branch icon (issue #68): opens the 分支与 PR dialog. */
  onBranch?: (todo: TodoRecord) => void;
  /** #828: false = no branch icon (cards without a build have nothing to open). */
  hasBranch?: boolean;
  /** Project name. Absent: fixture = capture canon constant, live = no
   *  project item (projects read pending/failed, or no row for the todo). */
  projectName?: string;
  /** #445: the card's tag (cardTag result, at most one); null = no tag item. */
  tag?: TagChipData | null;
  /** #1216: an orchestration round is in flight for this card. A 待开始 card
   *  swaps its 开始 for a 编排中 footer naming what the round waits on; a
   *  失败 card swaps 重试 for an inert 编排中, so neither can fire twice. */
  orchestration?: CardOrchestration | null;
}

type AttentionNeed = Extract<CardFace, { kind: 'attention' }>['need'];

const ATTENTION: Record<
  AttentionNeed,
  { icon: LucideIcon; label: string; action: string; actionIcon: LucideIcon }
> = {
  failed: { icon: CircleX, label: '失败', action: '重试', actionIcon: RotateCcw },
  confirm: { icon: ListChecks, label: '待确认', action: '确认计划', actionIcon: Check },
  review: { icon: GitPullRequest, label: '待审阅', action: '审阅', actionIcon: ArrowRight },
  reply: { icon: MessageCircle, label: '待回复', action: '回复', actionIcon: Reply },
};

const ACCENT_INK = 'text-(--card-button)';
const ACTION_LINK =
  'todo-card-action relative z-10 h-6 flex-none gap-1 px-1.5 text-(--card-button) hover:bg-accent-hover hover:text-spot-text-on-tint dark:hover:bg-accent-hover';
const META_ITEM = 'flex flex-none items-center gap-1';

function Glyph({
  icon: Icon,
  className,
  style,
}: {
  icon: LucideIcon;
  className: string;
  style?: CSSProperties;
}) {
  return <Icon aria-hidden strokeWidth={1.75} className={className} style={style} />;
}

/** #1257 / #1261 suspension (等机器 / 等额度); quotaWait wins when both exist. */
function suspension(todo: TodoRecord): { label: string; quota: string | undefined } | null {
  if (todo.quotaWait != null) return { label: '等额度', quota: todo.quotaWait.kind };
  if (todo.waitingOn == null) return null;
  return { label: todo.waitingOn.on === 'quota' ? '等额度' : '等机器', quota: undefined };
}

export function TodoCard({
  todo,
  now,
  onAction,
  onBranch,
  hasBranch = true,
  projectName,
  tag,
  orchestration = null,
}: TodoCardProps) {
  const { t } = useI18n();
  const { search } = useLocation();
  const { live } = useLiveData();
  const face = cardFace(todo);
  const project = live ? projectName : (projectName ?? PROJECT_NAME);
  const suspended = suspension(todo);
  const queued = todo.phase === 'queued';
  const retryTitle =
    todo.waitingOn?.on === 'quota' && todo.waitingOn.retryAt != null
      ? t('下次尝试 {time}', {
          time: new Date(todo.waitingOn.retryAt).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
        })
      : undefined;
  const lockedByOrchestration = orchestration != null && canOrchestrate(todo.phase);
  const chiefSearch = (threadId: string) => {
    const params = new URLSearchParams(search);
    params.set('chief', threadId);
    return `?${params}`;
  };

  const actionLink = (label: string, icon: LucideIcon, className?: string): ReactNode =>
    lockedByOrchestration ? (
      <span
        data-orchestrating="true"
        className={`todo-card-action flex h-6 flex-none items-center px-1.5 text-meta font-medium text-content-tertiary ${className ?? ''}`}
      >
        {t('编排中')}
      </span>
    ) : (
      <Button
        variant="ghost"
        size="xs"
        className={`${ACTION_LINK} ${className ?? ''}`}
        onClick={() => onAction?.(todo)}
      >
        <Glyph icon={icon} className="size-3.25" />
        <span className="text-meta font-medium">{t(label)}</span>
      </Button>
    );

  return (
    /* #629: the card face is not selectable (select-none) and the title
       link cannot be dragged natively (draggable=false + -webkit-user-drag). */
    <Card
      data-todo-id={todo.id}
      className="todo-card relative w-full gap-0 rounded-(--radius-card) bg-card px-3.5 py-3 shadow-(--panel-shadow) ring-0 transition-[box-shadow] duration-150 ease-out hover:shadow-(--panel-shadow-hover) select-none"
    >
      <h3
        className={`todo-card-title line-clamp-2 wrap-break-word text-card-title ${
          face.kind === 'done'
            ? 'font-normal text-content-tertiary'
            : 'font-medium text-card-foreground'
        }`}
      >
        <Link
          className="todo-card-link rounded-sm text-inherit no-underline after:absolute after:inset-0 after:content-[''] [-webkit-user-drag:none]"
          to={{ pathname: `/app/todo/${todo.id}`, search }}
          draggable={false}
        >
          {todo.title}
        </Link>
      </h3>

      <div className="todo-card-meta mt-1.5 flex h-5 items-center gap-2 bg-inherit text-meta whitespace-nowrap text-content-tertiary">
        <div className="relative flex min-w-0 flex-1 bg-inherit">
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
            {project !== undefined && (
              <span className="flex items-center gap-1">
                <Glyph icon={Folder} className="size-3 flex-none text-content-dim" />
                {/* The ::before ghost holds the first five characters plus the
                    ellipsis on one line, so the name truncates but never below
                    five visible characters. The tag's huge shrink factor keeps
                    the project from losing even a sub-pixel (which would already
                    draw its ellipsis) until the tag is gone; the tag carries
                    its leading gap inside, so a fully shrunk tag leaves one gap. */}
                <span
                  data-floor={
                    [...project].length > 5 ? `${[...project].slice(0, 5).join('')}…` : project
                  }
                  className="flex flex-col before:invisible before:h-0 before:overflow-hidden before:content-[attr(data-floor)]"
                >
                  <span className="line-clamp-1 break-all whitespace-normal">{project}</span>
                </span>
              </span>
            )}
            <span className="flex-none tabular-nums">#{todo.seqNum}</span>
            {tag != null && (
              <span
                data-card-tag={tag.id}
                className="-ml-2 flex min-w-0 shrink-100000 items-center gap-1 overflow-hidden"
              >
                <Glyph icon={Tag} className="ml-2 size-3 flex-none" style={{ color: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </span>
            )}
            <span className={META_ITEM}>
              <Glyph icon={Clock} className="size-3 text-content-dim" />
              {relativeTime(todo.phaseAt, now, t)}
            </span>
            {face.kind === 'done' && face.canceled && (
              <span data-todo-canceled="" className={META_ITEM}>
                <Glyph icon={Ban} className="size-3 text-content-dim" />
                {t('已取消')}
              </span>
            )}
          </div>
          {face.kind === 'todo' &&
            face.action != null &&
            !lockedByOrchestration &&
            actionLink(
              face.action,
              Play,
              'absolute inset-y-0 right-0 my-auto bg-inherit opacity-0 transition-opacity duration-150 ease-out group-hover/card:opacity-100 group-focus-within/card:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            )}
        </div>
        <div className="flex flex-none items-center gap-1 text-content-dim empty:hidden">
          {todo.chiefCreated === true && (
            <span role="img" aria-label={t('由总管创建')} title={t('由总管创建')} className="flex">
              <Glyph icon={Sparkles} className="size-3" />
            </span>
          )}
          {todo.hasPlan && (
            <span role="img" aria-label={t('方案')} className="flex">
              <Glyph icon={FileText} className="size-3" />
            </span>
          )}
          {todo.hasChanges && (
            <span role="img" aria-label={t('变更')} className="flex">
              <Glyph icon={GitCommitHorizontal} className="size-3" />
            </span>
          )}
          {onBranch != null && hasBranch && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="todo-card-branch relative z-10 size-5 text-content-dim"
              aria-label={t('分支与 PR')}
              onClick={() => onBranch(todo)}
            >
              <Glyph icon={GitBranch} className="size-3" />
            </Button>
          )}
        </div>
      </div>

      {face.kind === 'todo' && lockedByOrchestration && orchestration != null && (
        <div
          data-orchestrating="true"
          className="todo-card-orchestration mt-2.5 flex items-center gap-1.5 border-t border-dashed border-border pt-2 text-meta whitespace-nowrap text-content-secondary"
        >
          <Glyph icon={Hourglass} className="size-3.25 flex-none text-content-tertiary" />
          <span className="min-w-0 truncate">
            {t('编排中')}
            {orchestration.wait != null &&
              ` · ${t(orchestration.wait.label, orchestration.wait.vars)}`}
          </span>
          <Link
            className="relative z-10 -mr-1.5 ml-auto flex h-6 flex-none items-center gap-1 rounded-(--radius-control) px-1.5 text-content-secondary no-underline hover:bg-secondary"
            to={{ search: chiefSearch(orchestration.threadId) }}
          >
            {t('查看会话')}
            <Glyph icon={ArrowRight} className="size-3.25" />
          </Link>
        </div>
      )}

      {face.kind === 'running' && (
        // #1447：queued 住执行中但还没跑——静态沙漏 + 次级墨（排队中 / 等机器 /
        // 等额度），呼吸机器人留给真在跑的 planning/building。
        <div
          data-card-footer={queued ? 'waiting' : 'running'}
          className={`mt-2 flex items-center gap-1.5 text-meta whitespace-nowrap ${queued ? 'text-content-secondary' : 'text-running-text'}`}
        >
          {queued ? (
            <Glyph icon={Hourglass} className="size-3.25 flex-none text-content-tertiary" />
          ) : (
            <Glyph
              icon={Bot}
              className="size-3.25 flex-none animate-breath text-running motion-reduce:animate-none"
            />
          )}
          <span className="min-w-0 truncate">
            {todo.agent != null && `${todo.agent.displayName} · `}
            {suspended == null ? (
              t(PHASE_UI[todo.phase].chip)
            ) : (
              <span data-todo-quota={suspended.quota} title={retryTitle}>
                {t(suspended.label)}
              </span>
            )}
          </span>
        </div>
      )}

      {face.kind === 'attention' && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-dashed border-border pt-2 text-meta whitespace-nowrap">
          <span className={`flex min-w-0 items-center gap-1 font-medium ${ACCENT_INK}`}>
            <Glyph icon={ATTENTION[face.need].icon} className="size-3.25 flex-none" />
            <span className="truncate">{t(ATTENTION[face.need].label)}</span>
          </span>
          {actionLink(
            ATTENTION[face.need].action,
            ATTENTION[face.need].actionIcon,
            '-mr-1.5 ml-auto',
          )}
        </div>
      )}
    </Card>
  );
}
