import type { RunnerOfflineContent, StepQueueBlocked } from '@cairn/shared';
import { CircleAlert, CircleStop } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useContext, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations, useProviders } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { relativeTime } from '../board/rel-time.js';
import { reportStatusWord } from '../board/status-words.js';
import { ThreadLink } from '../board/thread-link.js';
import { LiveRow, TypingDots } from '../components/chat/live-row.js';
import {
  type BubbleRun,
  CHAT_BODY_CLS,
  MESSAGE_COL_MAX_CLS,
  MessageBubble,
} from '../components/chat/message-bubble.js';
import { MessageMeta } from '../components/chat/message-meta.js';
import type { MessageActions } from '../components/chat/message-press-menu.js';
import { NoticeLine } from '../components/chat/notice-line.js';
import { useArrivals } from '../components/growth.js';
import { MachineName } from '../components/machine-label.js';
import { ModelMark, resolveModelClientEntry } from '../components/model-identity.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent, MarkerIcon } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { Segments as DocSegments, TodoGlanceContext } from '../detail/segments.js';
import type { ChiefSegment, ChiefSubagentInfo } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { parseAttachmentTokens, splitDraft } from '../overlay/attachment-paste.js';
import { DoubaoQrLoginCard } from '../resources/doubao-qr-login.js';
import { COORDINATOR_ROUTING_HREF } from '../resources/hrefs.js';
import { RunTraceLink, turnRunIdOf } from '../runs/run-trace-link.js';
import { settingsHref } from '../settings/settings-href.js';
import { isApprovalRequest } from './approval-card-model.js';
import { ChatBlockRow } from './chat-block-row.js';
import { PendingQuestion } from './chief-question.js';
import { ChiefReportMessage } from './chief-report-row.js';
import { chiefRowShows } from './chief-row-kinds.js';
import { TaskTrunk } from './chief-task-trunk.js';
import { isLiveNotice } from './live-notice.js';
import { ApprovalAnswered, QuestionReceipt } from './question-answered-line.js';
import { plainQuestionText } from './question-item.js';
import { QuotedReplies } from './reply-quote-block.js';
import {
  parseSentReply,
  REPLY_HIGHLIGHT_ATTR,
  REPLY_SOURCE_ATTR,
  ReplySourceHighlightContext,
} from './reply-source-highlight.js';
import { channelHref, useChannelOf } from './report-route.js';
import { ResearchReportLine, ResearchReportRow } from './research-report.js';
import { SecretRequestCard } from './secret-request-card.js';
import { SentAttachments } from './sent-attachments.js';
import { TakeoverCard } from './takeover-card.js';
import type { ChannelMirror, GroupedRow } from './thread-activity.js';
import { CardFailureContext, turnErrorDetail } from './turn-failure.js';

function runAttr(joinsPrev: boolean, joinsNext: boolean): BubbleRun | undefined {
  if (joinsPrev && joinsNext) return 'middle';
  if (joinsPrev) return 'last';
  if (joinsNext) return 'first';
  return undefined;
}

const MSG_COL_CLS = `relative min-w-0 flex-1 ${CHAT_BODY_CLS} text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!`;
const BUBBLE_COL_CLS = `relative ${MESSAGE_COL_MAX_CLS} flex-none gap-0`;
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const EVENT_ROW_CLS = 'mt-5';
const REPLY_ROW_CLS = 'mt-6';

function messageRowCls(joinsPrev: boolean): string {
  return joinsPrev ? 'mt-0.5' : 'mt-6';
}
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;

function CoordinatorSaid({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
      <MessageBubble side="coordinator" className="max-w-[min(85%,42rem)]" data-testid={testId}>
        {children}
      </MessageBubble>
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
          <span className="min-w-0 max-w-[50%] shrink-0 truncate" title={name}>
            {name}
          </span>
          <span className="flex-none" aria-hidden="true">
            ·
          </span>
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
              translate="no"
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
      {glance !== undefined ? (
        <>
          <TaskTrunk todoIds={[todoId]} rooted={false} />
          <ResearchReportRow todoId={todoId} indent="mt-2" />
        </>
      ) : (
        <span className="text-ui text-foreground">
          <TaskChip todoId={todoId} label={title ?? t('任务')} />
        </span>
      )}
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
    case 'error':
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
  onWithdraw?: ((messageId: string, text: string) => void) | undefined;
  entering?: boolean;
  joinsPrev?: boolean;
  joinsNext?: boolean;
  started?: readonly string[];
  reports?: readonly string[];
  glancesReady?: boolean;
}

const NO_TASKS: readonly string[] = [];
const NO_REPORTS: readonly string[] = [];

function StoppedRow({
  id,
  todos,
}: {
  id: string | undefined;
  todos: { id: string; seq: number; title: string }[];
}) {
  const runId = turnRunIdOf(id);
  const link = runId === null ? null : <RunTraceLink runId={runId} />;
  const { t } = useI18n();
  const stoppedLabel = t('已停止，没有建任务。');
  if (todos.length === 0) {
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className="my-3">
        <NoticeLine label={stoppedLabel} testId="chief-stopped" icon={CircleAlert} actions={link} />
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
          {link !== null && <span className="ml-1 inline-flex align-middle">{link}</span>}
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

const COORDINATOR_FIXES: Partial<
  Record<StepQueueBlocked['kind'], { label: string; href: string }[]>
> = {
  'runner-outdated': [{ label: '查看执行机', href: settingsHref('machines') }],
  'github-push-missing': [{ label: '查看执行机', href: settingsHref('machines') }],
  'claude-logged-out': [{ label: '添加 Claude 订阅', href: settingsHref('routing') }],
  'devin-subscription': [{ label: '添加 Devin 订阅', href: settingsHref('routing') }],
  'antigravity-subscription': [{ label: '添加 Antigravity 订阅', href: settingsHref('routing') }],
  'doubao-subscription': [{ label: '添加豆包订阅', href: settingsHref('routing') }],
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

function ChiefDoubaoQrActions({ waitingFor }: { waitingFor: { machineId: string; name: string } }) {
  const { live, teamId } = useLiveData();
  const providersQ = useProviders(teamId, live);
  return (
    <DoubaoQrLoginCard
      teamId={teamId}
      machineId={waitingFor.machineId}
      machineName={waitingFor.name}
      autoStart
      canManage={!live || providersQ.data?.canTestConnection === true}
    />
  );
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

export const ChiefStreamRow = memo(function ChiefStreamRow({
  item,
  onWithdraw,
  entering = false,
  joinsPrev = false,
  joinsNext = false,
  started = NO_TASKS,
  reports = NO_REPORTS,
  glancesReady = true,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
  const highlightedSource = useContext(ReplySourceHighlightContext);
  const cardFailure = useContext(CardFailureContext);
  const highlight = (id: string | undefined) =>
    id !== undefined && id === highlightedSource?.sourceMessageId
      ? { [REPLY_HIGHLIGHT_ATTR]: '' }
      : {};
  if (!chiefRowShows(item, cardFailure)) return null;
  if (item.kind === 'stopped') return <StoppedRow id={item.id} todos={item.todos} />;
  if (item.kind === 'channel-mirror') return <ChannelMirrorRow mirror={item} />;
  if (item.kind === 'error') {
    const runId = turnRunIdOf(item.id);
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className="my-3">
        <NoticeLine
          label={t('未完成')}
          testId="chief-turn-error"
          tone="danger"
          detail={
            item.error === undefined
              ? { lines: [], raw: item.text }
              : turnErrorDetail(item.error, t)
          }
          detailTestId="chief-turn-error-raw"
          actions={runId === null ? undefined : <RunTraceLink runId={runId} />}
        />
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
        <NoticeLine icon={null} testId="chief-note">
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
    const reply = parseSentReply(item.text);
    const shown = reply?.body ?? item.markdown;
    const split = splitDraft(shown ?? item.text);
    const sentFiles = parseAttachmentTokens(split.tokens.join('\n'));
    const bubbleText = sentFiles.length > 0 ? split.text.trim() : split.text;
    const showBubble = bubbleText !== '' || reply !== null || sentFiles.length === 0;
    const sending = item.delivery === 'sending';
    const steering = item.pending === 'steering';
    const actions: MessageActions = {
      at: item.createdAt,
      fallbackAt: item.at,
      text: item.text,
      onWithdraw:
        steering && onWithdraw !== undefined && item.id != null
          ? () => onWithdraw(item.id ?? '', item.text)
          : undefined,
    };
    const bubble = (
      <MessageBubble
        side="owner"
        data-testid="chief-bubble"
        run={runAttr(joinsPrev, joinsNext)}
        data-md={shown != null ? '' : undefined}
        {...(item.id != null ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
        {...highlight(item.id)}
        {...(sending ? { 'data-delivery': 'sending' } : {})}
        {...(steering ? { 'data-steering': '' } : {})}
        className={shown != null ? BUBBLE_MD_CLS : undefined}
      >
        {reply !== null && <QuotedReplies quotes={reply.quotes} />}
        {shown != null ? bubbleText !== '' && <ChatMarkdown text={bubbleText} /> : bubbleText}
      </MessageBubble>
    );
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message
          className={`${messageRowCls(joinsPrev)} justify-end ${entering ? 'message-enter' : ''}`}
          data-testid="chief-msg"
          data-run={runAttr(joinsPrev, joinsNext)}
        >
          <MessageContent className={`${BUBBLE_COL_CLS} items-end`} data-testid="chief-msg-col">
            {sentFiles.length > 0 && (
              <div className={`relative max-w-full ${showBubble ? 'mb-2' : ''}`}>
                <SentAttachments files={sentFiles} />
              </div>
            )}
            {showBubble && (
              <MessageMeta side="owner" actions={actions} disabled={sending}>
                {bubble}
              </MessageMeta>
            )}
            {sending && (
              <span role="status" className="sr-only" data-testid="chief-msg-sending">
                {t('发送中')}
              </span>
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  const asked = item.kind === 'question' ? plainQuestionText(item) : null;
  if (item.kind === 'question' && asked !== null)
    return (
      <ChiefStreamRow
        item={{
          kind: 'robot',
          id: item.id,
          markdown: asked,
          seconds: '',
          ...(item.createdAt !== undefined ? { createdAt: item.createdAt } : {}),
        }}
        joinsPrev={joinsPrev}
        joinsNext={joinsNext}
      />
    );
  if (item.kind === 'question')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            {item.status === 'pending' ? (
              <PendingQuestion item={item} />
            ) : isApprovalRequest(item.requestId) ? (
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
          <MessageContent className={BUBBLE_COL_CLS} data-testid="chief-msg-col">
            {subagents.length > 0 && <SubagentProgressList items={subagents} />}
            <TaskTrunk todoIds={started} live ready={glancesReady} />
            <LiveRow
              variant="chief"
              label={item.label}
              labelVars={item.labelVars}
              notice={isLiveNotice(item.label)}
              blocked={item.blocked === true}
              blockedActions={
                item.blockedKind === 'doubao-login-required' && item.waitingFor !== undefined ? (
                  <ChiefDoubaoQrActions waitingFor={item.waitingFor} />
                ) : (
                  <CoordinatorFixLinks kind={item.blockedKind} />
                )
              }
            />
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
  const sourceHighlighted =
    highlightedSource !== null && highlightedSource.sourceMessageId === item.id;
  const quoted = highlightedSource?.quote ?? '';
  const actions: MessageActions = { at: item.createdAt, text: whole };
  const replyRun = runAttr(joinsPrev && started.length === 0, joinsNext);
  const bubble =
    markdown != null ? (
      <div
        data-testid="chief-reply"
        data-run={replyRun}
        className="relative w-fit max-w-full font-sans text-ui leading-5 text-(--foreground)"
        {...(item.id != null && settled ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
      >
        <ChatMarkdown
          text={markdown}
          fileMessageId={settled && item.workspaceFileLinks === true ? item.id : undefined}
          filePaths={item.workspaceFilePaths}
          streaming={!settled}
          bubbles
          run={replyRun}
          surface={(children, surfaceRun) => (
            <MessageBubble side="coordinator" run={surfaceRun} className="max-w-full">
              {children}
            </MessageBubble>
          )}
          bubbleFooter={<BubbleReports todoIds={reports} />}
          highlight={(group) =>
            sourceHighlighted && (group.source.includes(quoted) || quoted.includes(group.source))
          }
        />
      </div>
    ) : (
      <MessageBubble
        side="coordinator"
        run={replyRun}
        data-testid="chief-reply"
        {...(item.id != null && settled ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
      >
        <div
          data-slot="reply-bubble"
          data-testid="chief-reply-bubble"
          className="rounded-sm data-reply-highlight:bg-(--reply-bubble-highlight)"
          {...(sourceHighlighted ? { [REPLY_HIGHLIGHT_ATTR]: '' } : {})}
        >
          {(item.paragraphs ?? []).map((p, j) => (
            <p key={j} className={j > 0 ? 'mt-3' : undefined}>
              <Segments segments={p} />
            </p>
          ))}
          {item.bullets != null && item.bullets.length > 0 && (
            <ul className="mt-1 list-disc ps-5">
              {item.bullets.map((b, j) => (
                <li key={`b${j}`}>
                  <Segments segments={b} />
                </li>
              ))}
            </ul>
          )}
          <BubbleReports todoIds={reports} />
        </div>
      </MessageBubble>
    );
  const hasBody = whole.trim() !== '' || reports.length > 0;
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={messageRowCls(joinsPrev && started.length === 0)}
        data-testid="chief-msg"
        data-run={runAttr(joinsPrev, joinsNext)}
      >
        <MessageContent className={BUBBLE_COL_CLS} data-testid="chief-msg-col">
          {subagents.length > 0 && <SubagentProgressList items={subagents} />}
          <TaskTrunk todoIds={started} live={!settled} ready={glancesReady} />
          {hasBody && (
            <MessageMeta
              side="coordinator"
              actions={actions}
              note={settled ? fallbackNote : undefined}
              streaming={!settled}
            >
              {bubble}
            </MessageMeta>
          )}
          {settled && item.detailsTodoId !== undefined && (
            <ThreadLink
              todoId={item.detailsTodoId}
              data-testid="chief-reply-details"
              className="mt-1 self-start text-meta text-content-tertiary no-underline hover:text-foreground hover:underline"
            >
              {t('详情')}
            </ThreadLink>
          )}
          {item.typing === true && <TypingDots className="mt-1" />}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});
