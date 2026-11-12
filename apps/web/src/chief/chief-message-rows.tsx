import { parseReplyQuote } from '@cairn/shared';
import { cn } from 'cn';
import { CircleAlert } from 'lucide-react';
import { type CSSProperties, memo, type ReactNode, useContext } from 'react';
import { isUsableTimestamp } from '../board/rel-time.js';
import { ThreadLink } from '../board/thread-link.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, TypingDots } from '../components/chat/live-row.js';
import { STATUS_REF_CLS, StatusLine } from '../components/chat/status-line.js';
import { TraceGroup, type TraceStepItem } from '../components/chat/trace-steps.js';
import { CHAT_BODY_CLS, UserMessageBubble } from '../components/chat/user-message-bubble.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { ChatMarkdown, REPLY_BLOCK_CLS, REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import {
  type TodoGlance,
  TodoGlanceContext,
  TodoStatus,
  taskChipClass,
} from '../detail/segments.js';
import type { ChiefSegment, ChiefStreamItem, ChiefToolRow } from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import { FileText } from '../icons/index.js';
import { dateTimeFormat } from '../lib/date-format.js';
import { spiralAvatarUrl } from '../lib/spiral-avatar.js';
import { parseAttachmentTokens, splitDraft } from '../overlay/attachment-paste.js';
import { ChiefDigestRow } from './chief-digest-row.js';
import { ChiefReportRow } from './chief-report-row.js';
import { TaskRefRow } from './chief-task-ref-row.js';
import { taskRefsOf } from './chief-task-refs.js';
import { isLiveNotice } from './live-notice.js';
import { MessageToolbar } from './message-toolbar.js';
import { QuestionAnsweredLine, QuestionAsked } from './question-answered-line.js';
import { answerLines } from './question-lifecycle.js';
import { ReplyQuoteBlock } from './reply-quote-block.js';
import {
  REPLY_HIGHLIGHT_ATTR,
  REPLY_HIGHLIGHT_CLS,
  ReplySourceHighlightContext,
} from './reply-source-highlight.js';
import type { ReplyQuoteDraft } from './selection-reply.js';
import { REPLY_SOURCE_ATTR } from './selection-reply-model.js';
import { SentAttachments } from './sent-attachments.js';
import type { ThreadActivity } from './thread-activity.js';
import { ThreadActivityRow, ThreadEventLine } from './thread-activity-row.js';
import { ThreadReportReply } from './thread-report-reply.js';
import { messageStampLabel } from './time-dividers.js';

const STAMP_CLS = 'text-caption whitespace-nowrap tabular-nums';

function MessageStamp({ createdAt, fallback }: { createdAt?: number; fallback?: string }) {
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

const NO_GLANCES: ReadonlyMap<string, TodoGlance> = new Map();

const MSG_COL_CLS = `relative min-w-0 flex-1 ${CHAT_BODY_CLS} text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!`;
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const USER_ROW_CLS = 'mt-6';
const RUN_ROW_CLS = 'mt-1';
const EVENT_ROW_CLS = 'mt-5';
const REPLY_ROW_CLS = 'mt-6';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

const BUBBLE_WRAP_CLS = `w-full max-w-full font-sans ${CHAT_BODY_CLS}`;
const MARKER_ERROR_CLS = 'my-2.5 gap-1.5 text-meta text-(--destructive)';

const CHIP_INLINE_CLS =
  'mx-0.5 inline-flex items-center gap-1 rounded-(--cds-radius-sm) px-1.5 py-px align-[1px] font-sans text-meta';

function segmentsText(segments: ChiefSegment[]): string {
  return segments.map((s) => (s.todo != null ? `#${s.todo}` : (s.agent ?? s.text ?? ''))).join('');
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

function TodoSegmentChip({ seq }: { seq: number }) {
  const glances = useContext(TodoGlanceContext);
  const known = [...(glances ?? [])].find(([, glance]) => glance.seq === seq);
  const chip = (
    <>
      {known !== undefined ? (
        <TodoStatus phase={known[1].phase} />
      ) : (
        <FileText width={11} height={11} />
      )}
      {seq}
    </>
  );
  const cls = `${CHIP_INLINE_CLS} bg-secondary text-content-secondary`;
  return known === undefined ? (
    <span data-testid="chief-chip-todo" className={cls}>
      {chip}
    </span>
  ) : (
    <ThreadLink
      todoId={known[0]}
      data-testid="chief-chip-todo"
      data-phase={known[1].phase}
      className={cn(cls, taskChipClass(known[1].phase))}
    >
      {chip}
    </ThreadLink>
  );
}

function TaskRefRows({
  source,
  started,
}: {
  source: Parameters<typeof taskRefsOf>[0];
  started: readonly string[];
}) {
  const glances = useContext(TodoGlanceContext);
  const refs = taskRefsOf(source, glances ?? NO_GLANCES, started);
  if (refs.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col gap-0.5" data-testid="chief-task-refs">
      {refs.map((ref) => (
        <TaskRefRow key={ref.todoId} taskRef={ref} />
      ))}
    </div>
  );
}

function Segments({ segments }: { segments: ChiefSegment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.todo != null) return <TodoSegmentChip key={i} seq={s.todo} />;
        if (s.agent != null)
          return (
            <span
              key={i}
              data-testid="chief-chip-agent"
              className={`${CHIP_INLINE_CLS} bg-(--seg-active) text-(--text-secondary)`}
            >
              <img src={spiralAvatarUrl(s.agent)} alt="" className="size-3 rounded-full" />
              {s.agent}
            </span>
          );
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

function turnToolSteps(tools: ChiefToolRow[] | undefined): TraceStepItem[] {
  return (tools ?? []).map((tool, k) => ({
    id: k,
    step: {
      kind: 'tool',
      name: tool.label,
      status: tool.error === true ? 'failed' : 'done',
      ...(tool.seconds !== undefined ? { secs: tool.seconds } : {}),
    },
  }));
}

function TaskStartedRow({
  todoId,
  seq,
  title,
}: {
  todoId: string;
  seq: number | null;
  title: string | null;
}) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  if (glance !== undefined) {
    return (
      <MessageScrollerItem
        style={SCROLLER_ITEM_STYLE}
        data-testid="chief-task-started"
        className={EVENT_ROW_CLS}
      >
        <TaskRefRow
          elbow={false}
          taskRef={{
            todoId,
            seq: glance.seq ?? seq,
            title: glance.title ?? title,
            phase: glance.phase,
          }}
        />
      </MessageScrollerItem>
    );
  }
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
      <StatusLine testId="chief-task-created">
        {t('已建任务')}{' '}
        <ThreadLink todoId={todoId} className={STATUS_REF_CLS}>
          {seq != null ? `#${seq}` : t('任务')}
        </ThreadLink>
        {title != null ? ` ${title}` : null}
      </StatusLine>
    </MessageScrollerItem>
  );
}

function HandoffRow({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
      <StatusLine testId="chief-handoff">
        {t('已转给任务')}{' '}
        <ThreadLink todoId={todoId} className={STATUS_REF_CLS} data-phase={glance?.phase}>
          {glance?.seq != null ? `#${glance.seq}` : t('任务')}
        </ThreadLink>
      </StatusLine>
    </MessageScrollerItem>
  );
}

export function chiefStreamRowKey(
  item: ChiefStreamItem | ThreadActivity,
  index: number,
): string | number {
  switch (item.kind) {
    case 'user':
      return item.outboxKey != null ? `outbox-${item.outboxKey}` : (item.id ?? index);
    case 'robot':
    case 'thinking':
    case 'question':
    case 'handoff':
    case 'task-card':
    case 'digest':
    case 'stopped':
    case 'thread-report':
    case 'thread-message':
    case 'thread-activity':
      return item.id ?? index;
    default:
      return index;
  }
}

interface ChiefStreamRowProps {
  item: ChiefStreamItem | ThreadActivity;
  index: number;
  replyable?: boolean;
  onCopy: (text: string) => void;
  toolsOpen: ReadonlySet<number>;
  onToggleTools: (index: number) => void;
  onRewindRequest: (index: number, id: string | null) => void;
  onReply?: ((draft: ReplyQuoteDraft) => void) | undefined;
  entering?: boolean;
  onRetry?: (() => void) | undefined;
  joinsPrev?: boolean;
  joinsNext?: boolean;
  startedTasks?: readonly string[];
}

const NO_STARTED_TASKS: readonly string[] = [];
const NO_TEXT = {};

function StoppedRow({ todos }: { todos: { id: string; seq: number; title: string }[] }) {
  const { t } = useI18n();
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
      <StatusLine testId="chief-stopped">
        {todos.length === 0 ? (
          t('已停止，没有建任务。')
        ) : (
          <>
            {t('已停止。停之前已经建了任务')}
            {todos.map((todo, n) => (
              <span key={todo.id}>
                {n === 0 ? ' ' : '、'}
                <ThreadLink todoId={todo.id} className={STATUS_REF_CLS}>
                  {`#${todo.seq} ${todo.title}`}
                </ThreadLink>
              </span>
            ))}
          </>
        )}
      </StatusLine>
    </MessageScrollerItem>
  );
}

export const ChiefStreamRow = memo(function ChiefStreamRow({
  item,
  index: i,
  replyable = false,
  onCopy,
  toolsOpen,
  onToggleTools,
  onRewindRequest,
  onReply,
  entering = false,
  onRetry,
  joinsPrev = false,
  joinsNext = false,
  startedTasks = NO_STARTED_TASKS,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
  const highlightedSource = useContext(ReplySourceHighlightContext);
  const highlight = (id: string | undefined) =>
    id !== undefined && id === highlightedSource?.sourceMessageId
      ? { [REPLY_HIGHLIGHT_ATTR]: '' }
      : {};
  if (item.kind === 'stopped') return <StoppedRow todos={item.todos} />;
  if (item.kind === 'thread-report' || item.kind === 'thread-message')
    return (
      <MessageScrollerItem
        messageId={item.id}
        style={SCROLLER_ITEM_STYLE}
        className={EVENT_ROW_CLS}
      >
        <ThreadEventLine item={item} />
        {item.kind === 'thread-report' && item.phase === 'needs-you' && replyable && (
          <ThreadReportReply todoId={item.todoId} />
        )}
      </MessageScrollerItem>
    );
  if (item.kind === 'thread-activity')
    return (
      <MessageScrollerItem
        messageId={item.id}
        style={SCROLLER_ITEM_STYLE}
        className={EVENT_ROW_CLS}
      >
        <ThreadActivityRow activity={item} />
      </MessageScrollerItem>
    );
  if (item.kind === 'error')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Marker role="alert" className={MARKER_ERROR_CLS} title={item.text}>
          <CircleAlert aria-hidden="true" className="flex-none" />
          <MarkerContent data-testid="chief-turn-error">{t('这一轮没有完成')}</MarkerContent>
          {onRetry !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              data-testid="chief-turn-retry"
              className="text-foreground"
              onClick={onRetry}
            >
              {t('重试')}
            </Button>
          )}
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'handoff') return <HandoffRow todoId={item.todoId} />;
  if (item.kind === 'task-card')
    return <TaskStartedRow todoId={item.todoId} seq={item.seq} title={item.title} />;
  if (item.kind === 'digest')
    return <ChiefDigestRow reason={item.reason} madeAt={item.madeAt} items={item.items} />;
  if (item.kind === 'daily-report') return <ChiefReportRow report={item.report} />;
  if (item.kind === 'note')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE} className={EVENT_ROW_CLS}>
        <StatusLine testId="chief-note">
          {t(item.text)}
          {item.machineName && (
            <>
              <span className="underline decoration-current/40 underline-offset-3">
                {item.machineName}
              </span>
              {t('上')}
            </>
          )}
        </StatusLine>
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
    const fade = sending ? 'opacity-55' : '';
    const userTools = (placement: 'left' | 'below-end', testId: string) => (
      <MessageToolbar
        placement={placement}
        testId={testId}
        stamp={<MessageStamp createdAt={item.createdAt} fallback={item.at} />}
        onReply={
          onReply !== undefined && item.id != null
            ? () => onReply({ sourceMessageId: item.id ?? '', quote: reply?.body ?? item.text })
            : undefined
        }
        onCopy={() => onCopy(item.text)}
        onRewind={() => onRewindRequest(i, item.id ?? null)}
      />
    );
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
                {!showBubble && !sending && userTools('left', 'chief-msg-tools')}
              </div>
            )}
            {showBubble && (
              <div className="group/reply-block relative max-w-full" data-slot="reply-block">
                <UserMessageBubble
                  data-testid="chief-bubble"
                  tail={!joinsNext}
                  data-md={shown != null ? '' : undefined}
                  {...(item.id != null ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
                  {...highlight(item.id)}
                  {...(sending ? { 'data-delivery': 'sending' } : {})}
                  className={`w-fit max-w-full [overflow-wrap:anywhere] ${REPLY_HIGHLIGHT_CLS} ${shown != null ? BUBBLE_MD_CLS : ''} ${fade}`}
                >
                  {reply != null && <ReplyQuoteBlock quote={reply.quote} />}
                  {shown != null ? <ChatMarkdown text={bubbleText} /> : bubbleText}
                </UserMessageBubble>
                {!sending && userTools('left', 'chief-msg-tools')}
              </div>
            )}
            {sending ? (
              <span role="status" className="sr-only" data-testid="chief-msg-sending">
                {t('发送中')}
              </span>
            ) : (
              userTools('below-end', 'chief-msg-tools-touch')
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  if (item.kind === 'thinking')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ThinkingRow text={item.text} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'question' && item.status === 'pending') return null;
  if (item.kind === 'question') {
    if (item.status === 'cancelled')
      return (
        <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
          <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
            <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
              <QuestionAnsweredLine item={item} />
            </MessageContent>
          </Message>
        </MessageScrollerItem>
      );
    const answers = answerLines(item);
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message
          className={joinsPrev ? RUN_ROW_CLS : REPLY_ROW_CLS}
          data-testid="chief-msg"
          data-run={joinsPrev ? 'last' : undefined}
        >
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <QuestionAsked item={item} onCopy={onCopy} />
            {answers.length === 0 && (
              <div className="mt-2">
                <QuestionAnsweredLine item={item} />
              </div>
            )}
          </MessageContent>
        </Message>
        {answers.length > 0 && (
          <Message
            className={`${USER_ROW_CLS} justify-end`}
            data-testid="chief-msg"
            data-run={joinsNext ? 'first' : undefined}
          >
            <MessageContent
              className="relative max-w-[min(85%,42rem)] flex-none items-end gap-2"
              data-testid="chief-msg-col"
            >
              <UserMessageBubble
                data-testid="chief-bubble"
                data-question-answer={item.requestId}
                tail={!joinsNext}
                className="w-fit max-w-full [overflow-wrap:anywhere] whitespace-pre-line"
              >
                {answers.join('\n')}
              </UserMessageBubble>
            </MessageContent>
          </Message>
        )}
      </MessageScrollerItem>
    );
  }
  if (item.kind === 'streaming')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Message className={REPLY_ROW_CLS} data-testid="chief-msg">
          <MessageContent className={MSG_COL_LIVE_CLS}>
            <LiveRow
              variant="chief"
              label={item.label}
              labelVars={item.labelVars}
              labelDetail={item.labelDetail}
              waiting={item.waiting === true}
              notice={isLiveNotice(item.label, item.labelDetail)}
            />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  const tools = turnToolSteps(item.tools);
  const settled = item.typing !== true;
  const whole = robotText(item);
  const fallbackNote =
    item.fallbackModel != null ? (
      <span data-testid="chief-fallback-note">
        {t('由备用模型 {model} 回答', { model: item.fallbackModel })}
      </span>
    ) : undefined;
  const robotTools = (
    placement: 'right' | 'below-start',
    quote: string,
    testId: string,
    withNote = true,
  ): ReactNode =>
    settled ? (
      <MessageToolbar
        placement={placement}
        testId={testId}
        stamp={<MessageStamp createdAt={item.createdAt} />}
        note={withNote ? fallbackNote : undefined}
        onReply={
          onReply !== undefined && item.id != null
            ? () => onReply({ sourceMessageId: item.id ?? '', quote })
            : undefined
        }
        onCopy={() => onCopy(quote)}
        onSteps={tools.length > 0 ? () => onToggleTools(i) : undefined}
      />
    ) : null;
  const sourceHighlighted =
    highlightedSource !== null && highlightedSource.sourceMessageId === item.id;
  const quoted = highlightedSource?.quote ?? '';
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={joinsPrev ? RUN_ROW_CLS : REPLY_ROW_CLS}
        data-testid="chief-msg"
        data-run={runAttr(joinsPrev, joinsNext)}
      >
        <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
          {tools.length > 0 && toolsOpen.has(i) && (
            <TraceGroup
              density="compact"
              steps={tools}
              open
              onOpenChange={() => onToggleTools(i)}
              summaryTestId="chief-tools-toggle"
              cardTestId="chief-turn-tools"
            />
          )}
          <TaskRefRows source={settled ? item : NO_TEXT} started={startedTasks} />
          <div
            className={BUBBLE_WRAP_CLS}
            data-testid="chief-reply"
            {...(item.id != null && settled ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
            {...(sourceHighlighted ? { [REPLY_HIGHLIGHT_ATTR]: '' } : {})}
          >
            {item.markdown != null ? (
              <ChatMarkdown
                text={item.markdown}
                bubbles
                bubbleTools={(group, n) =>
                  robotTools(
                    'right',
                    group.source,
                    n === 0 ? 'chief-msg-foot' : 'chief-msg-block-tools',
                  )
                }
                highlight={(group) =>
                  sourceHighlighted &&
                  (group.source.includes(quoted) || quoted.includes(group.source))
                }
              />
            ) : (
              <div className={REPLY_BLOCK_CLS} data-slot="reply-block">
                <div
                  className={REPLY_BUBBLE_CLS}
                  data-slot="reply-bubble"
                  data-testid="chief-reply-bubble"
                  {...(sourceHighlighted ? { [REPLY_HIGHLIGHT_ATTR]: '' } : {})}
                >
                  {(item.paragraphs ?? []).map((p, j) => (
                    <p key={j} className={j > 0 ? `mt-1 ${CHAT_BODY_CLS}` : CHAT_BODY_CLS}>
                      <Segments segments={p} />
                    </p>
                  ))}
                  {item.bullets != null && item.bullets.length > 0 && (
                    <ul className={`mt-1 list-disc ps-9 ${CHAT_BODY_CLS}`}>
                      {item.bullets.map((b, j) => (
                        <li key={`b${j}`}>
                          <Segments segments={b} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {robotTools('right', whole, 'chief-msg-foot')}
              </div>
            )}
          </div>
          {item.typing === true && <TypingDots className="mt-1" />}
          {robotTools('below-start', whole, 'chief-msg-tools-touch', false)}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});
