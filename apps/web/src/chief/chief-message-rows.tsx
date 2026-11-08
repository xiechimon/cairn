import { parseReplyQuote } from '@cairn/shared';
import { type CSSProperties, createContext, memo, type ReactNode, useContext } from 'react';
import { isUsableTimestamp, relativeTime } from '../board/rel-time.js';
import { ThreadLink } from '../board/thread-link.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LivePulse, LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { TraceGroup, TraceRows, type TraceStepItem } from '../components/chat/trace-steps.js';
import { Bubble, BubbleContent } from '../components/ui/bubble.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { TodoGlanceContext, TodoStatus } from '../detail/segments.js';
import type {
  ChiefContent,
  ChiefSegment,
  ChiefStreamItem,
  ChiefToolRow,
} from '../fixtures/records.js';
import { useMinuteClock } from '../hooks/use-minute-clock.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Copy, FileText, Restore } from '../icons/index.js';
import { spiralAvatarUrl } from '../lib/spiral-avatar.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { ChiefDigestRow } from './chief-digest-row.js';
import type { ChiefQuestionItem } from './chief-question-card.js';
import { ChiefReportRow } from './chief-report-row.js';
import { QuestionAnsweredLine } from './question-answered-line.js';
import { ReplyQuoteBlock } from './reply-quote-block.js';
import { REPLY_SOURCE_ATTR } from './selection-reply-model.js';
import type { ThreadActivity } from './thread-activity.js';
import { ThreadActivityRow, ThreadEventLine } from './thread-activity-row.js';
import { ThreadReportReply } from './thread-report-reply.js';

const MSG_TOOL_BTN_CLS =
  "size-6 cursor-pointer rounded-none border-none bg-transparent text-(--text-tertiary) hover:bg-(--secondary) hover:text-(--text-secondary) dark:hover:bg-(--secondary) aria-expanded:bg-muted aria-expanded:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto";

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
  const absolute = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
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
      {relativeTime(createdAt, Math.max(now, createdAt), t)}
    </time>
  );
}

const TURN_NOTE_CLS = 'px-3 py-2 text-meta leading-5 text-(--text-tertiary)';

const MSG_COL_CLS =
  'relative min-w-0 flex-1 text-card-title text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!';
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const USER_ROW_CLS = 'mt-6';
const EVENT_ROW_CLS = 'mt-6';
const REPLY_ROW_CLS = 'mt-11';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

const BUBBLE_WRAP_CLS = 'w-full max-w-full';
const BUBBLE_USER_CLS =
  'w-fit max-w-full min-w-0 rounded-(--cds-radius-xl) bubble-gradient px-3 py-2 text-card-title [overflow-wrap:anywhere] text-(--foreground)';
const BUBBLE_ROBOT_CLS = 'w-full border-0 voice-response text-card-title';
const MARKER_NOTE_CLS = 'my-2.5 text-meta text-(--text-tertiary)';
const MARKER_CONTENT_CLS = 'max-w-[85%]';
const MARKER_ERROR_CLS =
  'my-2.5 flex-col items-start gap-0.5 rounded-(--radius-card) bg-danger-soft px-3 py-2.5 text-left text-meta text-(--destructive)';

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

function Segments({ segments }: { segments: ChiefSegment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.todo != null)
          return (
            <span
              key={i}
              data-testid="chief-chip-todo"
              className={`${CHIP_INLINE_CLS} bg-secondary text-content-secondary`}
            >
              <FileText width={11} height={11} />
              {s.todo}
            </span>
          );
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

function turnToolSteps(tools: ChiefToolRow[] | undefined, runningVerb?: string): TraceStepItem[] {
  return (tools ?? []).map((tool, k) => {
    const running = runningVerb !== undefined && tool.running === true;
    return {
      id: k,
      step: {
        kind: 'tool',
        ...(running ? { verb: runningVerb } : {}),
        name: tool.label,
        status: tool.error === true ? 'failed' : running ? 'running' : 'done',
        ...(tool.seconds !== undefined ? { secs: tool.seconds } : {}),
      },
    };
  });
}

export const HandoffCardContext = createContext<((todoId: string) => ReactNode) | null>(null);

function HandoffRow({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  const renderCard = useContext(HandoffCardContext);
  const card = renderCard?.(todoId);
  if (card != null) {
    return (
      <MessageScrollerItem
        style={SCROLLER_ITEM_STYLE}
        data-testid="chief-handoff-card"
        className="pb-3"
      >
        {card}
      </MessageScrollerItem>
    );
  }
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
      <Marker variant="separator" className={MARKER_NOTE_CLS} data-testid="chief-handoff">
        <MarkerContent className={MARKER_CONTENT_CLS}>
          {t('已转给任务')}
          <ThreadLink
            todoId={todoId}
            className={`${mentionChipClass('todo')} cursor-pointer`}
            data-phase={glance?.phase}
          >
            {glance != null && <TodoStatus phase={glance.phase} />}
            {glance?.seq != null ? `#${glance.seq}` : t('任务')}
          </ThreadLink>
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

export function chiefStreamRowKey(
  item: ChiefStreamItem | ThreadActivity,
  index: number,
): string | number {
  switch (item.kind) {
    case 'user':
    case 'robot':
    case 'thinking':
    case 'question':
    case 'handoff':
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
  latest: boolean;
  replyable?: boolean;
  runningTool: ChiefContent['runningTool'];
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  toolsOpen: ReadonlySet<number>;
  onToggleTools: (index: number) => void;
  onRewindRequest: (index: number, id: string | null) => void;
  pendingQuestion?: ((item: ChiefQuestionItem) => ReactNode) | undefined;
}

function StoppedRow({ todos }: { todos: { id: string; seq: number; title: string }[] }) {
  const { t } = useI18n();
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
      <Marker variant="separator" className={MARKER_NOTE_CLS} data-testid="chief-stopped">
        <MarkerContent className={MARKER_CONTENT_CLS}>
          {todos.length === 0 ? (
            t('已停止，没有建任务。')
          ) : (
            <>
              {t('已停止。停之前已经建了任务')}
              {todos.map((todo) => (
                <ThreadLink
                  key={todo.id}
                  todoId={todo.id}
                  className={`${mentionChipClass('todo')} cursor-pointer`}
                >
                  {`#${todo.seq} ${todo.title}`}
                </ThreadLink>
              ))}
            </>
          )}
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

const messageToolsReveal = (latest: boolean) =>
  latest
    ? 'opacity-100'
    : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100';

const messageToolsPlace = (side: 'left' | 'right') =>
  `absolute top-full z-10 ${side === 'right' ? 'right-0' : 'left-0'}`;

export const ChiefStreamRow = memo(function ChiefStreamRow({
  item,
  index: i,
  latest,
  replyable = false,
  runningTool,
  copiedKey,
  onCopy,
  toolsOpen,
  onToggleTools,
  onRewindRequest,
  pendingQuestion,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
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
        <Marker role="alert" className={MARKER_ERROR_CLS}>
          <MarkerContent>{t('Coordinator 本轮执行失败')}</MarkerContent>
          <span className="mt-0.5 block break-all text-(--text-tertiary)">{item.text}</span>
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'handoff') return <HandoffRow todoId={item.todoId} />;
  if (item.kind === 'digest')
    return <ChiefDigestRow reason={item.reason} madeAt={item.madeAt} items={item.items} />;
  if (item.kind === 'daily-report') return <ChiefReportRow report={item.report} />;
  if (item.kind === 'note')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Marker variant="separator" className={MARKER_NOTE_CLS}>
          <MarkerContent className={MARKER_CONTENT_CLS}>
            {t(item.text)}
            {item.machineName && (
              <>
                <span className="underline underline-offset-2">{item.machineName}</span>
                {t('上')}
              </>
            )}
          </MarkerContent>
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'user') {
    const reply = parseReplyQuote(item.text);
    const shown = reply?.body ?? item.markdown;
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`${USER_ROW_CLS} justify-end`} data-testid="chief-msg">
          <MessageContent
            className="relative max-w-[min(85%,42rem)] flex-none items-end gap-0"
            data-testid="chief-msg-col"
          >
            <div
              data-testid="chief-bubble"
              data-md={shown != null ? '' : undefined}
              {...(item.id != null ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
              className={`${BUBBLE_USER_CLS} ${shown != null ? BUBBLE_MD_CLS : ''}`}
            >
              {reply != null && <ReplyQuoteBlock quote={reply.quote} />}
              {shown != null ? <ChatMarkdown text={shown} conversational /> : item.text}
            </div>
            <div
              className={`${messageToolsPlace('right')} flex items-center gap-1 text-(--text-tertiary) ${messageToolsReveal(latest)}`}
              data-testid="chief-msg-tools"
            >
              <MessageStamp createdAt={item.createdAt} fallback={item.at} />
              <Button
                variant="ghost"
                size="icon"
                className={MSG_TOOL_BTN_CLS}
                aria-label={t('复制')}
                onClick={() => onCopy(`u${i}`, item.text)}
              >
                {copiedKey === `u${i}` ? (
                  <Check width={13} height={13} />
                ) : (
                  <Copy width={13} height={13} />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={MSG_TOOL_BTN_CLS}
                aria-label={t('恢复到此处')}
                onClick={() => onRewindRequest(i, item.id ?? null)}
              >
                <Restore width={13} height={13} />
              </Button>
            </div>
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
  if (item.kind === 'question' && item.status === 'pending') {
    const inline = pendingQuestion?.(item) ?? null;
    if (inline === null) return null;
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            {inline}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  if (item.kind === 'question')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${REPLY_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <QuestionAnsweredLine item={item} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'streaming') {
    const callRunning = item.tools?.some((tool) => tool.running === true) === true;
    const liveSteps: TraceStepItem[] = [
      ...(runningTool != null && !callRunning
        ? [
            {
              id: 'running',
              step: {
                kind: 'tool' as const,
                verb: t('正在调用'),
                name: runningTool,
                status: 'running' as const,
              },
            },
          ]
        : []),
      ...turnToolSteps(item.tools, t('正在调用')),
    ];
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
              disclosure={{ expand: '展开实时步骤', collapse: '收起实时步骤' }}
            >
              <div data-testid="chief-turn-tools">
                {liveSteps.length > 0 && <TraceRows density="compact" steps={liveSteps} />}
                {liveSteps.length === 0 && item.signalAt == null && (
                  <p className={`m-0 ${TURN_NOTE_CLS}`}>{t('等待 Agent 响应…')}</p>
                )}
                {item.signalAt != null && (
                  <p className={`m-0 ${TURN_NOTE_CLS}`}>
                    <LiveSignal at={item.signalAt} className="min-w-0 truncate" />
                  </p>
                )}
              </div>
            </LiveRow>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  }
  const tools = turnToolSteps(item.tools);
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message className={REPLY_ROW_CLS} data-testid="chief-msg">
        <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
          {tools.length > 0 && (
            <TraceGroup
              density="compact"
              steps={tools}
              open={toolsOpen.has(i)}
              onOpenChange={() => onToggleTools(i)}
              summaryTestId="chief-tools-toggle"
              cardTestId="chief-turn-tools"
            />
          )}
          <Bubble variant="ghost" className={BUBBLE_WRAP_CLS}>
            <BubbleContent
              className={BUBBLE_ROBOT_CLS}
              {...(item.id != null && item.typing !== true ? { [REPLY_SOURCE_ATTR]: item.id } : {})}
            >
              {item.markdown != null ? (
                <ChatMarkdown text={item.markdown} conversational />
              ) : (
                <>
                  {(item.paragraphs ?? []).map((p, j) => (
                    <p key={j} className={j > 0 ? 'mt-0.5 text-card-title' : 'text-card-title'}>
                      <Segments segments={p} />
                    </p>
                  ))}
                  {item.bullets?.map((b, j) => (
                    <p key={`b${j}`} className="mt-0.5 flex gap-2 text-card-title">
                      <span className="flex-none">•</span>
                      <span>
                        <Segments segments={b} />
                      </span>
                    </p>
                  ))}
                </>
              )}
            </BubbleContent>
          </Bubble>
          {item.typing === true && <LivePulse className="mt-1 ml-0.5" />}
          {item.typing !== true && (
            <div
              className={`${messageToolsPlace('left')} flex items-center gap-2 text-meta text-(--text-tertiary) ${messageToolsReveal(latest)}`}
              data-testid="chief-msg-foot"
            >
              <Button
                variant="ghost"
                size="icon"
                className={MSG_TOOL_BTN_CLS}
                aria-label={t('复制')}
                onClick={() => onCopy(`r${i}`, robotText(item))}
              >
                {copiedKey === `r${i}` ? (
                  <Check width={13} height={13} />
                ) : (
                  <Copy width={13} height={13} />
                )}
              </Button>
              <MessageStamp createdAt={item.createdAt} />
              {item.fallbackModel != null && (
                <span data-testid="chief-fallback-note">
                  {t('由备用模型 {model} 回答', { model: item.fallbackModel })}
                </span>
              )}
            </div>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
});
