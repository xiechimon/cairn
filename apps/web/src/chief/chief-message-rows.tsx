import type { AskUserAnswer } from '@cairn/shared';
import { type CSSProperties, useContext } from 'react';
import { Link } from 'react-router';
import { ThinkingRow, ToolActivityRow } from '../components/chat/agent-rows.js';
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
import { useI18n } from '../i18n/provider.js';
import { Check, Copy, FileText, Restore } from '../icons/index.js';
import { spiralAvatarUrl } from '../lib/spiral-avatar.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { useOpenTaskInPlace } from '../task-panel/task-panel-root.js';
import { ChiefDigestRow } from './chief-digest-row.js';
import { ChiefIdentity } from './chief-identity.js';
import { ChiefQuestionCard } from './chief-question-card.js';

const MSG_TOOL_BTN_CLS =
  "size-6 cursor-pointer rounded-none border-none bg-transparent text-(--text-tertiary) hover:bg-(--secondary) hover:text-(--text-secondary) dark:hover:bg-(--secondary) aria-expanded:bg-muted aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const TURN_NOTE_CLS = 'px-3 py-2 text-meta leading-5 text-(--text-tertiary)';

const MSG_COL_CLS =
  'min-w-0 flex-1 text-card-title text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!';
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const MSG_ROW_CLS = 'mt-3.5';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

const BUBBLE_WRAP_CLS = 'w-full max-w-full';
const BUBBLE_USER_CLS =
  'bubble-gradient w-fit max-w-full min-w-0 rounded-(--cds-radius-xl) px-3 py-2 text-card-title break-words text-(--foreground)';
const BUBBLE_ROBOT_CLS = 'w-full border-0 leading-6';
const MARKER_NOTE_CLS = 'my-2.5 text-meta text-(--text-tertiary)';
const MARKER_CONTENT_CLS = 'max-w-[85%]';
const MARKER_ERROR_CLS =
  'my-2.5 flex-col items-start gap-0.5 rounded-(--radius-card) bg-danger-soft px-3 py-2.5 text-left text-meta text-(--destructive)';

const PENDING_BTN_CLS =
  'h-7 cursor-pointer rounded-(--radius-menu-item) px-2.5 text-meta font-normal text-(--text-secondary)';

const CHIP_INLINE_CLS =
  'mx-0.5 inline-flex items-center gap-1 rounded-(--cds-radius-sm) px-1.5 py-px align-[1px] text-meta';

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
              className={`${CHIP_INLINE_CLS} bg-(--chip-plan-bg) text-(--chip-plan-fg)`}
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

function HandoffRow({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  const openInPlace = useOpenTaskInPlace();
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
      <Marker variant="separator" className={MARKER_NOTE_CLS} data-testid="chief-handoff">
        <MarkerContent className={MARKER_CONTENT_CLS}>
          {t('已转给任务')}
          <Link
            to={`/app/todo/${todoId}`}
            className={`${mentionChipClass('todo')} cursor-pointer`}
            data-phase={glance?.phase}
            onClick={(event) => openInPlace(event, todoId, glance)}
          >
            {glance != null && <TodoStatus phase={glance.phase} />}
            {glance?.seq != null ? `#${glance.seq}` : t('任务')}
          </Link>
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

export function chiefStreamRowKey(item: ChiefStreamItem, index: number): string | number {
  switch (item.kind) {
    case 'user':
    case 'robot':
    case 'thinking':
    case 'tool':
    case 'question':
    case 'handoff':
    case 'digest':
    case 'stopped':
    case 'thread-report':
      return item.id ?? index;
    default:
      return index;
  }
}

interface ChiefStreamRowProps {
  item: ChiefStreamItem;
  index: number;
  bound: ChiefContent['bound'];
  agent: ChiefContent['agent'];
  runningTool: ChiefContent['runningTool'];
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  toolsOpen: ReadonlySet<number>;
  onToggleTools: (index: number) => void;
  onRewindRequest: (index: number, id: string | null) => void;
  onAnswerQuestion?: ((input: { requestId: string; answers: AskUserAnswer[] }) => void) | undefined;
  onCancelQuestion?: ((requestId: string) => void) | undefined;
  onWithdraw?: ((messageId: string, text: string) => void) | undefined;
  onSteer?: ((messageId: string) => void) | undefined;
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
                <Link
                  key={todo.id}
                  to={`/app/todo/${todo.id}`}
                  className={`${mentionChipClass('todo')} cursor-pointer`}
                >
                  {`#${todo.seq} ${todo.title}`}
                </Link>
              ))}
            </>
          )}
        </MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

export function ChiefStreamRow({
  item,
  index: i,
  bound,
  agent,
  runningTool,
  copiedKey,
  onCopy,
  toolsOpen,
  onToggleTools,
  onRewindRequest,
  onAnswerQuestion,
  onCancelQuestion,
  onWithdraw,
  onSteer,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
  if (item.kind === 'stopped') return <StoppedRow todos={item.todos} />;
  if (item.kind === 'thread-report')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Marker variant="separator" className={MARKER_NOTE_CLS} data-testid="thread-report-marker">
          <MarkerContent className={MARKER_CONTENT_CLS}>
            <Link to={`/app/todo/${item.todoId}`} className="hover:underline">
              {t('来自任务 #{n} {title} 的消息', { n: item.seqNum, title: item.title })}
            </Link>
          </MarkerContent>
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'error')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Marker role="alert" className={MARKER_ERROR_CLS}>
          <MarkerContent>{t('总管本轮执行失败')}</MarkerContent>
          <span className="mt-0.5 block break-all text-(--text-tertiary)">{item.text}</span>
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'handoff') return <HandoffRow todoId={item.todoId} />;
  if (item.kind === 'digest')
    return <ChiefDigestRow reason={item.reason} madeAt={item.madeAt} items={item.items} />;
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
  if (item.kind === 'user')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message
          className={`${MSG_ROW_CLS} justify-end ${item.pending != null ? 'opacity-80' : ''}`}
          data-testid={item.pending != null ? 'chief-pending' : 'chief-msg'}
          data-pending={item.pending}
        >
          <MessageContent
            className="max-w-[min(85%,42rem)] flex-none items-end gap-0"
            data-testid="chief-msg-col"
          >
            <div
              data-testid="chief-bubble"
              data-md={item.markdown != null ? '' : undefined}
              className={`${BUBBLE_USER_CLS} ${item.markdown != null ? BUBBLE_MD_CLS : ''}`}
            >
              {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
            </div>
            {item.pending != null ? (
              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1.5 text-meta text-(--text-tertiary)">
                <span className="mr-auto">
                  {item.pending === 'held'
                    ? t('已存下，总管恢复后会处理')
                    : t('排队中，总管回完上一条就看')}
                </span>
                {item.pending === 'queued' && item.id != null && onSteer != null && (
                  <Button
                    variant="outline"
                    className={PENDING_BTN_CLS}
                    onClick={() => onSteer(item.id ?? '')}
                  >
                    {t('现在插话')}
                  </Button>
                )}
                {item.id != null && onWithdraw != null && (
                  <Button
                    variant="outline"
                    className={PENDING_BTN_CLS}
                    onClick={() => onWithdraw(item.id ?? '', item.text)}
                  >
                    {t('撤回')}
                  </Button>
                )}
              </div>
            ) : (
              <div
                className="mt-1 flex items-center gap-1 text-(--text-tertiary) opacity-0 transition-opacity duration-(--dur-fast) group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100"
                data-testid="chief-msg-tools"
              >
                {item.at != null && (
                  <span className="mr-1.5 text-caption tabular-nums" data-testid="chief-msg-stamp">
                    {item.at}
                  </span>
                )}
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
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'thinking')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${MSG_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ThinkingRow text={item.text} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'tool')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${MSG_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ToolActivityRow
              name={item.label}
              {...(item.startedAt !== undefined ? { startedAt: item.startedAt } : {})}
              {...(item.seconds !== undefined ? { seconds: item.seconds } : {})}
              {...(item.running !== undefined ? { running: item.running } : {})}
              {...(item.error !== undefined ? { error: item.error } : {})}
            />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'question')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${MSG_ROW_CLS}`}>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ChiefQuestionCard
              item={item}
              {...(onAnswerQuestion ? { onAnswer: onAnswerQuestion } : {})}
              {...(onCancelQuestion ? { onCancel: onCancelQuestion } : {})}
            />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  if (item.kind === 'streaming') {
    const liveSteps: TraceStepItem[] = [
      ...(runningTool != null
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
      ...turnToolSteps(item.tools),
    ];
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Message className={MSG_ROW_CLS} data-testid="chief-msg">
          <MessageContent className={MSG_COL_LIVE_CLS}>
            <LiveRow
              variant="chief"
              label={item.label}
              labelVars={item.labelVars}
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
  const identity =
    bound && agent ? <ChiefIdentity agent={agent} busy={item.typing === true} /> : null;
  const tools = turnToolSteps(item.tools);
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message className={MSG_ROW_CLS} data-testid="chief-msg">
        <MessageContent
          className={identity != null ? `${MSG_COL_MID_CLS} gap-1.5` : MSG_COL_MID_CLS}
          data-testid="chief-msg-col"
        >
          {identity}
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
            <BubbleContent className={BUBBLE_ROBOT_CLS}>
              {item.markdown != null ? (
                <ChatMarkdown text={item.markdown} />
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
              className="mt-2 flex items-center gap-2 text-meta text-(--text-tertiary)"
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
              {item.seconds !== '' && <span>{t('完成 {n}', { n: item.seconds })}</span>}
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
}
