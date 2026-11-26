import { parseReplyQuote, type RunnerOfflineContent, type StepQueueBlocked } from '@cairn/shared';
import { CircleAlert, CircleStop } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useContext, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { isUsableTimestamp, relativeTime } from '../board/rel-time.js';
import { reportStatusWord } from '../board/status-words.js';
import { ThreadLink } from '../board/thread-link.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, TypingDots } from '../components/chat/live-row.js';
import { CHAT_BODY_CLS, ChatMessageBody } from '../components/chat/message-body.js';
import { NoticeLine } from '../components/chat/notice-line.js';
import { useArrivals } from '../components/growth.js';
import { MachineName } from '../components/machine-label.js';
import { ModelMark, resolveModelClientEntry } from '../components/model-identity.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent, MarkerIcon } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { ChatMarkdown, REPLY_BLOCK_CLS, REPLY_TEXT_CLS } from '../detail/chat-markdown.js';
import { Segments as DocSegments, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefSegment, ChiefSubagentInfo } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { dateTimeFormat } from '../lib/date-format.js';
import { parseAttachmentTokens, splitDraft } from '../overlay/attachment-paste.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import { settingsHref } from '../settings/settings-href.js';
import { isApprovalRequest } from './approval-card-model.js';
import { ChatBlockRow } from './chat-block-row.js';
import { ChiefReportMessage } from './chief-report-row.js';
import { chiefRowRenders } from './chief-row-kinds.js';
import { isLiveNotice } from './live-notice.js';
import { MessageToolbar } from './message-toolbar.js';
import { ApprovalAnswered, QuestionReceipt } from './question-answered-line.js';
import { ReplyQuoteBlock } from './reply-quote-block.js';
import {
  REPLY_HIGHLIGHT_ATTR,
  REPLY_HIGHLIGHT_CLS,
  REPLY_SOURCE_ATTR,
  ReplySourceHighlightContext,
} from './reply-source-highlight.js';
import { channelHref, useChannelOf } from './report-route.js';
import { ResearchReportLine, ResearchReportRow } from './research-report.js';
import { SecretRequestCard } from './secret-request-card.js';
import { SentAttachments } from './sent-attachments.js';
import { TakeoverCard } from './takeover-card.js';
import type { ChannelMirror, GroupedRow } from './thread-activity.js';
import { messageStampLabel } from './time-dividers.js';
import { CardFailureContext } from './turn-failure.js';

const STAMP_CLS = 'text-caption whitespace-nowrap tabular-nums';

function MessageStamp({
  createdAt,
  fallback,
}: {
  createdAt?: number | undefined;
  fallback?: string | undefined;
}) {
  const { t, locale } = useI18n();
  const now = useMinuteClock();
  if (createdAt != null && !isUsableTimestamp(createdAt, now)) return null;
  if (createdAt == null) {
    return fallback == null ? null : (
      <span className={STAMP_CLS} data-testid="chief-msg-stamp">
        {fallback}
      </span>
    );
  }
  const absolute = dateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(createdAt);
  return (
    <time
      className={STAMP_CLS}
      data-testid="chief-msg-stamp"
      dateTime={new Date(createdAt).toISOString()}
      title={absolute}
    >
      {messageStampLabel(createdAt, Math.max(now, createdAt), locale, t)}
    </time>
  );
}

function runAttr(joinsPrev: boolean, joinsNext: boolean): string | undefined {
  if (joinsPrev && joinsNext) return 'middle';
  if (joinsPrev) return 'last';
  if (joinsNext) return 'first';
  return undefined;
}

const MSG_COL_CLS = `relative min-w-0 flex-1 ${CHAT_BODY_CLS} text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!`;
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const USER_ROW_CLS = 'mt-6';
const RUN_ROW_CLS = 'mt-1';
const EVENT_ROW_CLS = 'mt-5';
const REPLY_ROW_CLS = 'mt-6';
const REPLY_RUN_ROW_CLS = 'mt-4';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

const BUBBLE_WRAP_CLS = `group/reply-block relative w-full max-w-full font-sans ${CHAT_BODY_CLS}`;
const SAID_CLS = `${REPLY_TEXT_CLS} min-w-0 text-(--foreground)`;

function CoordinatorSaid({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
      <div className={SAID_CLS} data-testid={testId}>
        {children}
      </div>
    </MessageScrollerItem>
  );
}

function segmentsText(segments: ChiefSegment[]): string {
  return segments.map((s) => (s.todo != null ? `#${s.todo}` : (s.text ?? ''))).join('');
}

function robotText(item: {
  paragraphs?: ChiefSegment[][];
  bullets?: ChiefSegment[][];
  markdown?: string;
}): string {
  if (item.markdown != null) return item.markdown;
  const lines = (item.paragraphs ?? []).map(segmentsText);
  for (const b of item.bullets ?? []) lines.push(`- ${segmentsText(b)}`);
  return lines.join('\n');
}

function TodoSegmentLink({ seq }: { seq: number }) {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  const known = [...(glances ?? [])].find(([, glance]) => glance.seq === seq);
  return known === undefined ? (
    <span>{t('任务')}</span>
  ) : (
    <TaskChip todoId={known[0]} label={known[1].title ?? t('任务')} />
  );
}

function TaskChip({ todoId, label }: { todoId: string; label: string }) {
  return (
    <DocSegments
      codeClassName="chat-code"
      segments={[{ text: label, style: 'mention', mentionKind: 'todo', mentionId: todoId }]}
    />
  );
}

function StartedTasksLine({ todoIds }: { todoIds: readonly string[] }) {
  const { t } = useI18n();
  const glances = useContext(TodoGlanceContext);
  return (
    <div className={`${SAID_CLS} mt-2`} data-testid="chief-task-started-said">
      {t('已建任务')}
      {todoIds.map((todoId, n) => (
        <span key={todoId}>
          {n > 0 && t('、')}
          <TaskChip todoId={todoId} label={glances?.get(todoId)?.title ?? t('任务')} />
        </span>
      ))}
    </div>
  );
}

function BubbleReports({ todoIds }: { todoIds: readonly string[] }) {
  const arrived = useArrivals(todoIds);
  if (todoIds.length === 0) return null;
  return (
    <div data-slot="bubble-reports" className="mt-1 flex flex-col font-sans">
      {todoIds.map((todoId) => (
        <ResearchReportLine key={todoId} todoId={todoId} grow={arrived.has(todoId)} />
      ))}
    </div>
  );
}

const MIRROR_LINK_CLS = 'flex-none text-(--chat-link) no-underline hover:underline';

function ChannelMirrorRow({ mirror }: { mirror: ChannelMirror }) {
  const { t } = useI18n();
  const channel = useChannelOf()(mirror.fromThreadId);
  const name = t('{channel} 频道', { channel: channel?.name ?? t('项目') });
  return (
    <MessageScrollerItem
      messageId={mirror.id}
      style={SCROLLER_ITEM_STYLE}
      className={EVENT_ROW_CLS}
      data-testid="chief-channel-mirror"
    >
      <Marker variant="separator" className="gap-1.5 text-meta text-content-tertiary">
        <span className="flex min-w-0 shrink items-center gap-1.5">
          <span className="flex-none">{name}</span>
          <span aria-hidden="true">·</span>
          <span className="min-w-0 truncate text-content-secondary" title={mirror.title}>
            {mirror.title}
          </span>
          <span className="flex-none">{t(reportStatusWord(mirror))}</span>
          {channel?.projectId != null ? (
            <Link
              to={channelHref(channel.projectId)}
              aria-label={t('去{channel}', { channel: name })}
              className={MIRROR_LINK_CLS}
            >
              {t('去看')}
            </Link>
          ) : (
            <ThreadLink todoId={mirror.todoId} className={MIRROR_LINK_CLS}>
              {t('去看')}
            </ThreadLink>
          )}
        </span>
      </Marker>
    </MessageScrollerItem>
  );
}

function Segments({ segments }: { segments: ChiefSegment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.todo != null) return <TodoSegmentLink key={i} seq={s.todo} />;
        if (s.code)
          return (
            <code
              key={i}
              className="rounded-(--cds-radius-sm) bg-(--muted) px-1 py-px font-mono text-meta"
            >
              {s.text}
            </code>
          );
        return s.strong ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function TaskStartedRow({ todoId, title }: { todoId: string; title: string | null }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  return (
    <MessageScrollerItem
      style={SCROLLER_ITEM_STYLE}
      data-testid="chief-task-started"
      className={EVENT_ROW_CLS}
    >
      <div className={SAID_CLS} data-testid="chief-task-started-said">
        {t('已建任务')}
        <TaskChip todoId={todoId} label={glance?.title ?? title ?? t('任务')} />
      </div>
      {glance !== undefined && <ResearchReportRow todoId={todoId} indent="mt-2" />}
    </MessageScrollerItem>
  );
}

function HandoffRow({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  return (
    <CoordinatorSaid testId="chief-handoff">
      {t('已转给任务')} <TaskChip todoId={todoId} label={glance?.title ?? t('任务')} />
    </CoordinatorSaid>
  );
}

const LIVE_TURN_KEY = 'live-turn';

export function chiefStreamRowKeys(
  rows: readonly { item: GroupedRow['item']; i: number }[],
): (string | number)[] {
  let turn: string | number | null = null;
  let slot = 0;
  return rows.map(({ item, i }) => {
    const key = chiefStreamRowKey(item, i);
    if (item.kind === 'user') {
      turn = key;
      slot = 0;
      return key;
    }
    if (turn === null || (item.kind !== 'robot' && item.kind !== 'streaming')) return key;
    return `${turn}:reply-${slot++}`;
  });
}

export function chiefStreamRowKey(item: GroupedRow['item'], index: number): string | number {
  switch (item.kind) {
    case 'user':
      return item.outboxKey != null ? `outbox-${item.outboxKey}` : (item.id ?? index);
    case 'streaming':
      return LIVE_TURN_KEY;
    case 'robot':
      return item.id ?? (item.typing === true ? LIVE_TURN_KEY : index);
    case 'thinking':
    case 'thinking-group':
    case 'chat-block':
    case 'question':
    case 'handoff':
    case 'takeover':
    case 'secret-request':
    case 'task-card':
    case 'runner-offline':
    case 'stopped':
    case 'note':
    case 'thread-report':
    case 'thread-message':
    case 'channel-mirror':
      return item.id ?? index;
    default:
      return index;
  }
}

interface ChiefStreamRowProps {
  item: GroupedRow['item'];
  index: number;
  onCopy: (text: string) => void;
  onRewindRequest: (index: number, id: string | null) => void;
  rewindDisabled?: boolean;
  onWithdraw?: ((messageId: string, text: string) => void) | undefined;
  entering?: boolean;
  joinsPrev?: boolean;
  joinsNext?: boolean;
  latest?: boolean;
  unmentioned?: readonly string[];
  reports?: readonly string[];
}

const STEERING_BUBBLE_CLS =
  'bg-transparent text-(--text-secondary) inset-ring-1 inset-ring-(--input)';
const NO_TASKS: readonly string[] = [];
const NO_REPORTS: readonly string[] = [];

function StoppedRow({ todos }: { todos: { id: string; seq: number; title: string }[] }) {
  const { t } = useI18n();
  const stoppedLabel = t('已停止，没有建任务。');
  if (todos.length === 0) {
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className="my-3">
        <NoticeLine label={stoppedLabel} testId="chief-stopped" icon={CircleAlert} />
      </MessageScrollerItem>
    );
  }
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className="my-3">
      <Marker
        variant="separator"
        role="note"
        data-testid="chief-stopped"
        className="gap-1.5 text-meta text-content-tertiary"
      >
        <MarkerIcon>
          <CircleStop />
        </MarkerIcon>
        <MarkerContent
          data-testid="failure-marker-label"
          className="text-pretty tabular-nums group-data-[variant=separator]/marker:flex-initial"
        >
          {t('已停止。停之前已经建了任务')}
          {todos.map((todo, n) => (
            <span key={todo.id}>
              {n === 0 ? ' ' : '、'}
              <TaskChip todoId={todo.id} label={todo.title} />
            </span>
          ))}
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

const COORDINATOR_FIXES: Partial<
  Record<StepQueueBlocked['kind'], { label: string; href: string }[]>
> = {
  'runner-outdated': [{ label: '查看执行机', href: settingsHref('machines') }],
  'claude-logged-out': [{ label: '添加 Claude 订阅', href: settingsHref('routing') }],
  'devin-subscription': [{ label: '添加 Devin 订阅', href: settingsHref('routing') }],
  'antigravity-subscription': [{ label: '添加 Antigravity 订阅', href: settingsHref('routing') }],
  'coordinator-provider-missing': [
    { label: '添加服务商', href: settingsHref('routing') },
    { label: '改 Coordinator 规则', href: COORDINATOR_ROUTING_HREF },
  ],
  'coordinator-provider-no-key': [
    { label: '填写 API key', href: settingsHref('routing') },
    { label: '换 Coordinator 模型', href: COORDINATOR_ROUTING_HREF },
  ],
};

export function CoordinatorFixLinks({ kind }: { kind: StepQueueBlocked['kind'] | undefined }) {
  const { t } = useI18n();
  const fixes = kind === undefined ? undefined : COORDINATOR_FIXES[kind];
  if (fixes === undefined) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-2">
      {fixes.map((fix) => (
        <Button
          key={fix.label}
          variant="outline"
          size="sm"
          data-testid="queue-blocked-fix"
          render={<Link to={fix.href} />}
        >
          {t(fix.label)}
        </Button>
      ))}
    </span>
  );
}

const RUNNER_CHECKS_MD = [
  '1. 电脑开着，没有休眠',
  '2. 能打开 Cairn 网页（网络和到服务器的线路正常）',
  '3. 运行 `cairn status`，未在运行时运行 `cairn start`',
  '4. 仍然失败时运行 `cairn logs -f`，把最后几行发给 Coordinator 分析',
];

function RunnerOfflineRow({ notice }: { notice: RunnerOfflineContent }) {
  const { t } = useI18n();
  const now = useMinuteClock();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const [moving, setMoving] = useState(false);
  const count = (state: RunnerOfflineContent['todos'][number]['state']) =>
    notice.todos.filter((todo) => todo.state === state).length;
  const name = notice.machineName;
  if (notice.backAt !== null) {
    const queued = count('waiting');
    const moved = count('moved');
    return (
      <CoordinatorSaid testId="chief-runner-offline">
        {count('started') > 0
          ? t('{name} 已恢复，{n} 个任务已开工。', { name, n: count('started') })
          : t('{name} 已恢复。', { name })}
        {queued > 0 && t('还有 {n} 个在排队。', { n: queued })}
        {moved > 0 && t('{n} 个已改到其他执行机。', { n: moved })}
      </CoordinatorSaid>
    );
  }
  const shown = notice.todos.filter((todo) => todo.state === 'waiting' || todo.state === 'moved');
  const waiting = count('waiting');
  const alternative = notice.alternative;
  const move = async () => {
    if (alternative === null) return;
    if (!live) return;
    setMoving(true);
    let moved = 0;
    try {
      for (const todoId of alternative.todoIds) {
        await mutations.runTodoOn.mutateAsync({ todoId, machineId: alternative.machineId });
        moved += 1;
      }
      toastSuccess(t('已改在 {name} 上运行 {n} 个任务', { name: alternative.name, n: moved }));
    } catch (error) {
      toastError(t('改到 {name} 失败', { name: alternative.name }), error);
    } finally {
      setMoving(false);
    }
  };
  return (
    <CoordinatorSaid testId="chief-runner-offline">
      <p className="m-0">
        <span className="font-medium">
          {notice.lastSeenAt > 0
            ? t('{name} 离线了。', { name })
            : t('{name} 从未连接。', { name })}
          {waiting > 0
            ? t('{n} 个任务在等它。', { n: waiting })
            : t('等它的任务都已改到其他执行机。')}
        </span>
        {notice.lastSeenAt > 0 &&
          t('最后在线 {ago}。', { ago: relativeTime(notice.lastSeenAt, now, t) })}
      </p>
      {shown.length > 0 && (
        <ul className="my-2 flex list-none flex-col gap-0.5 p-0">
          {shown.map((todo) => (
            <li key={todo.id}>
              <TaskChip todoId={todo.id} label={todo.title} />
              {todo.state === 'moved' && (
                <span className="text-content-tertiary"> · {t('已改到其他执行机')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="m-0">{t('请在 {name} 上按顺序检查：', { name })}</p>
      <ChatMarkdown text={RUNNER_CHECKS_MD.map((line) => t(line)).join('\n')} />
      {alternative !== null && waiting > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 font-sans"
          disabled={moving}
          onClick={() => void move()}
        >
          {t('本次改在 {name} 上运行', { name: alternative.name })}
        </Button>
      )}
    </CoordinatorSaid>
  );
}

function subagentStatusLabel(sub: ChiefSubagentInfo, t: TFunc): string {
  switch (sub.status) {
    case 'queued':
      return t('排队中');
    case 'running':
      return t('进行中');
    case 'completed':
      return sub.partial === true ? t('已完成（部分结果）') : t('已完成');
    case 'timed_out':
      return t('已超时');
    case 'failed':
      return t('已失败');
    case 'aborted':
      return t('已停止');
  }
}

function SubagentProgressList({ items }: { items: readonly ChiefSubagentInfo[] }) {
  const { t } = useI18n();
  return (
    <ul
      data-testid="chief-subagent-progress"
      className="mt-1.5 mb-1 flex list-none flex-col gap-1 p-0 font-sans text-meta text-content-tertiary tabular-nums"
    >
      {items.map((sub, index) => {
        const statusText = subagentStatusLabel(sub, t);
        const toolText =
          sub.toolCalls > 0
            ? sub.lastTool !== undefined && (sub.status === 'running' || sub.status === 'queued')
              ? t('{n} 次工具 · {tool}', { n: sub.toolCalls, tool: sub.lastTool })
              : t('{n} 次工具', { n: sub.toolCalls })
            : null;
        return (
          <li
            key={`${index}-${sub.label}`}
            data-testid="chief-subagent-row"
            data-status={sub.status}
            className="flex min-w-0 items-center gap-2"
          >
            <span className="min-w-0 truncate text-content-secondary">{sub.label}</span>
            <span
              className={
                sub.status === 'failed' || sub.status === 'timed_out'
                  ? 'flex-none text-destructive'
                  : 'flex-none'
              }
            >
              {toolText !== null ? `${statusText} · ${toolText}` : statusText}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChiefMessageTools({
  side,
  touch = false,
  latest = false,
  testId,
  createdAt,
  fallbackAt,
  note,
  copyText,
  onCopy,
  onRewind,
  rewindDisabled = false,
  onWithdraw,
}: {
  side: 'user' | 'assistant';
  touch?: boolean;
  latest?: boolean;
  testId: string;
  createdAt: number | undefined;
  fallbackAt?: string | undefined;
  note?: ReactNode;
  copyText: string;
  onCopy: (text: string) => void;
  onRewind?: (() => void) | undefined;
  rewindDisabled?: boolean;
  onWithdraw?: (() => void) | undefined;
}) {
  const placement =
    side === 'assistant'
      ? touch
        ? 'below-start'
        : latest
          ? 'below-start-shown'
          : 'below-start-hover'
      : touch
        ? 'below-end'
        : 'left';
  return (
    <MessageToolbar
      placement={placement}
      testId={testId}
      stamp={<MessageStamp createdAt={createdAt} fallback={fallbackAt} />}
      note={touch ? undefined : note}
      onCopy={() => onCopy(copyText)}
      onRewind={onRewind}
      rewindDisabled={rewindDisabled}
      onWithdraw={onWithdraw}
    />
  );
}

export const ChiefStreamRow = memo(function ChiefStreamRow({
  item,
  index: i,
  onCopy,
  onRewindRequest,
  rewindDisabled = false,
  onWithdraw,
  entering = false,
  joinsPrev = false,
  joinsNext = false,
  latest = false,
  unmentioned = NO_TASKS,
  reports = NO_REPORTS,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
  const highlightedSource = useContext(ReplySourceHighlightContext);
  const cardFailure = useContext(CardFailureContext);
  const highlight = (id: string | undefined) =>
    id !== undefined && id === highlightedSource?.sourceMessageId
      ? { [REPLY_HIGHLIGHT_ATTR]: '' }
      : {};
  if (!chiefRowRenders(item.kind)) return null;
  if (item.kind === 'stopped') return <StoppedRow todos={item.todos} />;
  if (item.kind === 'channel-mirror') return <ChannelMirrorRow mirror={item} />;
  if (item.kind === 'thread-report' || item.kind === 'thread-message' || item.kind === 'report-ack')
    return null;
  if (item.kind === 'error') {
    if (item.id !== undefined && item.id === cardFailure) return null;
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className="my-3">
        <NoticeLine label={t('未完成')} testId="chief-turn-error" tone="danger" />
      </MessageScrollerItem>
    );
  }
  if (item.kind === 'chat-block')
    return <ChatBlockRow item={item} joinsPrev={joinsPrev} joinsNext={joinsNext} />;
  if (item.kind === 'handoff') return <HandoffRow todoId={item.todoId} />;
  if (item.kind === 'takeover') return <TakeoverCard item={item} />;
  if (item.kind === 'secret-request') return <SecretRequestCard item={item} />;
  if (item.kind === 'task-card') return <TaskStartedRow todoId={item.todoId} title={item.title} />;
  if (item.kind === 'daily-report')
    return (
      <CoordinatorSaid testId="chief-report">
        <ChiefReportMessage report={item.report} />
      </CoordinatorSaid>
    );
  if (item.kind === 'runner-offline') return <RunnerOfflineRow notice={item.notice} />;
  if (item.kind === 'note')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
        <NoticeLine layout="plain" testId="chief-note">
          {t(item.text, item.vars)}
          {item.machineName && (
            <>
              <span className="underline decoration-current/40 underline-offset-3">
                <MachineName machine={{ name: item.machineName }} compact />
              </span>
              {t(' 上')}
            </>
          )}
        </NoticeLine>
      </MessageScrollerItem>
    );
  if (item.kind === 'user') {
    const reply = parseReplyQuote(item.text);
    const shown = reply?.body ?? item.markdown;
    const split = splitDraft(shown ?? item.text);
    const sentFiles = parseAttachmentTokens(split.tokens.join('\n'));
    const bubbleText = sentFiles.length > 0 ? split.text.trim() : split.text;
    const showBubble = bubbleText !== '' || reply != null || sentFiles.length === 0;
    const sending = item.delivery === 'sending';
    const steering = item.pending === 'steering';
    const fade = sending ? 'opacity-55' : '';
    const userToolProps = {
      side: 'user' as const,
      createdAt: item.createdAt,
      fallbackAt: item.at,
      copyText: item.text,
      onCopy,
      onRewind: () => onRewindRequest(i, item.id ?? null),
      rewindDisabled,
      onWithdraw:
        steering && onWithdraw !== undefined && item.id != null
          ? () => onWithdraw(item.id ?? '', item.text)
          : undefined,
    };
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message
          className={`${joinsPrev ? RUN_ROW_CLS : USER_ROW_CLS} justify-end ${entering ? 'message-enter' : ''}`}
          data-testid="chief-msg"
          data-run={runAttr(joinsPrev, joinsNext)}
        >
          <MessageContent
            className="relative max-w-[min(85%,42rem)] flex-none items-end gap-2"
            data-testid="chief-msg-col"
          >
            {sentFiles.length > 0 && (
              <div
                className={`group/reply-block relative max-w-full ${fade}`}
                data-slot="reply-block"
              >
                <SentAttachments files={sentFiles} />
                {!showBubble && !sending && (
                  <ChiefMessageTools {...userToolProps} testId="chief-msg-tools" />
                )}
              </div>
            )}
            {showBubble && (
              <div className="group/reply-block relative max-w-full" data-slot="reply-block">
                <ChatMessageBody
                  speaker="user"
                  data-testid="chief-bubble"
                  tail={!joinsNext}
                  data-md={shown != null ? '' : undefined}
                  {...(item.id != null ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
                  {...highlight(item.id)}
                  {...(sending ? { 'data-delivery': 'sending' } : {})}
                  {...(steering ? { 'data-steering': '' } : {})}
                  className={`w-fit max-w-full [overflow-wrap:anywhere] ${REPLY_HIGHLIGHT_CLS} ${shown != null ? BUBBLE_MD_CLS : ''} ${fade} ${steering ? STEERING_BUBBLE_CLS : ''}`}
                >
                  {reply != null && <ReplyQuoteBlock quote={reply.quote} />}
                  {shown != null ? <ChatMarkdown text={bubbleText} /> : bubbleText}
                </ChatMessageBody>
                {!sending && <ChiefMessageTools {...userToolProps} testId="chief-msg-tools" />}
              </div>
            )}
            {sending ? (
              <span role="status" className="sr-only" data-testid="chief-msg-sending">
                {t('发送中')}
              </span>
            ) : (
              <ChiefMessageTools {...userToolProps} touch testId="chief-msg-tools-touch" />
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  if (item.kind === 'thinking' || item.kind === 'thinking-group')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ThinkingRow text={item.kind === 'thinking' ? item.text : item.texts} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'question' && item.status === 'pending') return null;
  if (item.kind === 'question')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            {isApprovalRequest(item.requestId) ? (
              <ApprovalAnswered item={item} />
            ) : (
              <QuestionReceipt item={item} />
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'streaming') {
    const subagents = (item.tools ?? []).flatMap((tool) =>
      tool.subagent !== undefined ? [tool.subagent] : [],
    );
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Message className={REPLY_ROW_CLS} data-testid="chief-msg">
          <MessageContent className={MSG_COL_LIVE_CLS}>
            <LiveRow
              variant="chief"
              label={item.label}
              labelVars={item.labelVars}
              notice={isLiveNotice(item.label)}
              blocked={item.blocked === true}
              blockedActions={<CoordinatorFixLinks kind={item.blockedKind} />}
            />
            {subagents.length > 0 && <SubagentProgressList items={subagents} />}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  const settled = item.typing !== true;
  const subagents = (item.tools ?? []).flatMap((tool) =>
    tool.subagent !== undefined ? [tool.subagent] : [],
  );
  const markdown = item.plain !== undefined ? t(item.plain.key, item.plain.vars) : item.markdown;
  const whole = markdown ?? robotText(item);
  const fallbackResolved =
    item.fallbackModel != null ? resolveModelClientEntry(item.fallbackModel) : null;
  const fallbackNote =
    item.fallbackModel != null && fallbackResolved !== null ? (
      <span data-testid="chief-fallback-note" className="inline-flex items-center gap-1">
        <ModelMark modelId={fallbackResolved.modelId} provider={fallbackResolved.provider} />
        <span>{t('由备用模型 {model} 回答', { model: item.fallbackModel })}</span>
      </span>
    ) : undefined;
  const assistantToolProps = {
    side: 'assistant' as const,
    latest,
    createdAt: item.createdAt,
    note: fallbackNote,
    onCopy,
  };
  const sourceHighlighted =
    highlightedSource !== null && highlightedSource.sourceMessageId === item.id;
  const quoted = highlightedSource?.quote ?? '';
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={joinsPrev ? REPLY_RUN_ROW_CLS : REPLY_ROW_CLS}
        data-testid="chief-msg"
        data-run={runAttr(joinsPrev, joinsNext)}
      >
        <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
          {subagents.length > 0 && <SubagentProgressList items={subagents} />}
          <ChatMessageBody
            speaker="assistant"
            className={BUBBLE_WRAP_CLS}
            data-testid="chief-reply"
            {...(item.id != null && settled ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
            {...(sourceHighlighted ? { [REPLY_HIGHLIGHT_ATTR]: '' } : {})}
          >
            {markdown != null ? (
              <ChatMarkdown
                text={markdown}
                streaming={!settled}
                bubbles
                bubbleFooter={<BubbleReports todoIds={reports} />}
                highlight={(group) =>
                  sourceHighlighted &&
                  (group.source.includes(quoted) || quoted.includes(group.source))
                }
              />
            ) : (
              <div className={REPLY_BLOCK_CLS} data-slot="reply-block">
                <div
                  className={REPLY_TEXT_CLS}
                  data-slot="reply-bubble"
                  data-testid="chief-reply-bubble"
                  {...(sourceHighlighted ? { [REPLY_HIGHLIGHT_ATTR]: '' } : {})}
                >
                  {(item.paragraphs ?? []).map((p, j) => (
                    <p key={j} className={j > 0 ? 'mt-3' : undefined}>
                      <Segments segments={p} />
                    </p>
                  ))}
                  {item.bullets != null && item.bullets.length > 0 && (
                    <ul className="mt-1 list-disc ps-9">
                      {item.bullets.map((b, j) => (
                        <li key={`b${j}`}>
                          <Segments segments={b} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <BubbleReports todoIds={reports} />
                </div>
              </div>
            )}
            {settled && (
              <ChiefMessageTools {...assistantToolProps} copyText={whole} testId="chief-msg-foot" />
            )}
          </ChatMessageBody>
          {item.typing === true && <TypingDots className="mt-1" />}
          {unmentioned.length > 0 && <StartedTasksLine todoIds={unmentioned} />}
          {settled && (
            <ChiefMessageTools
              {...assistantToolProps}
              touch
              copyText={whole}
              testId="chief-msg-tools-touch"
            />
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});
