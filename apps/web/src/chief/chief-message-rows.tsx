import type { AskUserAnswer } from '@cairn/shared';
import { type CSSProperties, useContext } from 'react';
import { Link } from 'react-router';
import type { CurrentUser } from '../api/provider.js';
import { ThinkingRow, ToolActivityRow } from '../components/chat/agent-rows.js';
import { LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { Bubble, BubbleContent } from '../components/ui/bubble.js';
import { Button } from '../components/ui/button.js';
import { Marker, MarkerContent } from '../components/ui/marker.js';
import { Message, MessageContent } from '../components/ui/message.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { ChatMarkdown } from '../detail/chat-markdown.js';
import { TodoGlanceContext, TodoStatus } from '../detail/segments.js';
import type { ChiefContent, ChiefSegment, ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronDown, ChevronRight, Copy, FileText, Restore } from '../icons/index.js';
import { spiralAvatarUrl } from '../lib/spiral-avatar.js';
import { mentionChipClass } from '../overlay/mention-chip.js';
import { ChiefDigestRow } from './chief-digest-row.js';
import { ChiefIdentity } from './chief-identity.js';
import { ChiefQuestionCard } from './chief-question-card.js';
import { ChiefSpiralFace } from './chief-spiral-face.js';
import { AVATAR_IMG_CLS, AVATAR_SLOT_CLS } from './recipes.js';

const MSG_TOOL_BTN_CLS =
  "size-5 cursor-pointer rounded-none border-none bg-transparent text-(--text-tertiary) hover:bg-(--secondary) hover:text-(--text-secondary) dark:hover:bg-(--secondary) aria-expanded:bg-muted aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const TURN_TOOLS_CLS =
  'mt-1.5 flex flex-col gap-1 rounded-(--radius-popover) bg-(--secondary) px-2 py-1.5';
const TURN_TOOL_ROW_CLS = 'flex items-center gap-2 font-mono text-caption text-(--text-tertiary)';
const TURN_TOOL_NAME_CLS = 'min-w-0 flex-auto truncate';

const MSG_COL_CLS =
  'min-w-0 flex-1 text-card-title leading-6 text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!';
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

const MSG_ROW_CLS = 'mt-3.5 gap-2.5';
const MSG_ROW_IDENTITY_CLS = 'mt-3.5 flex-col gap-1.5';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

const BUBBLE_WRAP_CLS = 'w-full max-w-full';
const BUBBLE_USER_CLS = 'w-full rounded-(--radius-popover) border-0 px-3 py-2.5 leading-6';
const BUBBLE_ROBOT_CLS = 'w-full border-0 leading-6';
const MARKER_NOTE_CLS = 'my-2.5 justify-center text-center text-meta text-(--text-tertiary)';
const MARKER_ERROR_CLS =
  'my-2.5 flex-col justify-center text-center text-meta text-(--destructive)';

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

function HandoffRow({ todoId }: { todoId: string }) {
  const { t } = useI18n();
  const glance = useContext(TodoGlanceContext)?.get(todoId);
  return (
    <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
      <Marker className={MARKER_NOTE_CLS} data-testid="chief-handoff">
        <MarkerContent>
          {t('已转给任务')}
          <Link
            to={`/app/todo/${todoId}`}
            className={`${mentionChipClass('todo')} cursor-pointer`}
            data-phase={glance?.phase}
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
  user: CurrentUser;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  toolsOpen: ReadonlySet<number>;
  onToggleTools: (index: number) => void;
  onRewindRequest: (index: number, id: string | null) => void;
  onAnswerQuestion?: ((input: { requestId: string; answers: AskUserAnswer[] }) => void) | undefined;
  onCancelQuestion?: ((requestId: string) => void) | undefined;
}

export function ChiefStreamRow({
  item,
  index: i,
  bound,
  agent,
  runningTool,
  user,
  copiedKey,
  onCopy,
  toolsOpen,
  onToggleTools,
  onRewindRequest,
  onAnswerQuestion,
  onCancelQuestion,
}: ChiefStreamRowProps) {
  const { t } = useI18n();
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
        <Marker className={MARKER_NOTE_CLS}>
          <MarkerContent>
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
        <Message className={MSG_ROW_CLS} data-testid="chief-msg">
          <span className={AVATAR_IMG_CLS}>
            <SeededAvatar
              className="size-6"
              name={user.displayName}
              src={user.avatarUrl}
              fallback="/avatar-user.png"
            />
          </span>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <Bubble variant="secondary" className={BUBBLE_WRAP_CLS}>
              <BubbleContent
                data-testid="chief-bubble"
                data-md={item.markdown != null ? '' : undefined}
                className={`${BUBBLE_USER_CLS} ${item.markdown != null ? BUBBLE_MD_CLS : ''}`}
              >
                {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
              </BubbleContent>
            </Bubble>
            <div className="mt-2 flex gap-2.5 text-(--text-tertiary)" data-testid="chief-msg-tools">
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
  if (item.kind === 'thinking')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={`chief-msg ${MSG_ROW_CLS}`}>
          {bound && agent ? (
            <span className={AVATAR_IMG_CLS}>
              <SeededAvatar
                className="size-6"
                name={agent.displayName}
                src={agent.avatarUrl}
                fallback="/avatar-robot-1.svg"
                busy
              />
            </span>
          ) : (
            <ChiefSpiralFace size={24} busy className={AVATAR_SLOT_CLS} />
          )}
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
          <span className="w-6 shrink-0" aria-hidden="true" />
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
          {bound && agent ? (
            <span className={AVATAR_IMG_CLS}>
              <SeededAvatar
                className="size-6"
                name={agent.displayName}
                src={agent.avatarUrl}
                fallback="/avatar-robot-1.svg"
              />
            </span>
          ) : (
            <ChiefSpiralFace size={24} className={AVATAR_SLOT_CLS} />
          )}
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
  if (item.kind === 'streaming')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Message className={MSG_ROW_CLS} data-testid="chief-msg">
          {bound && agent ? (
            <span className={AVATAR_IMG_CLS}>
              <SeededAvatar
                className="size-6"
                name={agent.displayName}
                src={agent.avatarUrl}
                fallback="/avatar-robot-1.svg"
                busy
              />
            </span>
          ) : (
            <ChiefSpiralFace size={24} busy className={AVATAR_SLOT_CLS} />
          )}
          <MessageContent className={MSG_COL_LIVE_CLS}>
            <LiveRow
              variant="chief"
              label={item.label}
              labelVars={item.labelVars}
              disclosure={{ expand: '展开实时步骤', collapse: '收起实时步骤' }}
            >
              <div className={TURN_TOOLS_CLS} data-testid="chief-turn-tools">
                {runningTool != null && (
                  <div className={TURN_TOOL_ROW_CLS}>
                    <span className={TURN_TOOL_NAME_CLS}>
                      {t('正在调用 {n}', { n: runningTool })}
                    </span>
                  </div>
                )}
                {item.tools?.map((tool, k) => (
                  <div key={k} className={TURN_TOOL_ROW_CLS}>
                    <span className={TURN_TOOL_NAME_CLS}>{tool.label}</span>
                    {tool.seconds !== undefined && (
                      <span className="flex-none">{tool.seconds}s</span>
                    )}
                    {tool.error === true && (
                      <span className="flex-none text-(--destructive)">{t('失败')}</span>
                    )}
                  </div>
                ))}
                {runningTool == null &&
                  (item.tools?.length ?? 0) === 0 &&
                  item.signalAt == null && (
                    <div className={TURN_TOOL_ROW_CLS}>
                      <span className={TURN_TOOL_NAME_CLS}>{t('等待 Agent 响应…')}</span>
                    </div>
                  )}
                {item.signalAt != null && (
                  <div className={TURN_TOOL_ROW_CLS}>
                    <LiveSignal at={item.signalAt} className={TURN_TOOL_NAME_CLS} />
                  </div>
                )}
              </div>
            </LiveRow>
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  const identity =
    bound && agent ? <ChiefIdentity agent={agent} busy={item.typing === true} /> : null;
  return (
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={identity != null ? MSG_ROW_IDENTITY_CLS : MSG_ROW_CLS}
        data-testid="chief-msg"
      >
        {identity ?? (
          <ChiefSpiralFace size={24} busy={item.typing === true} className={AVATAR_SLOT_CLS} />
        )}
        <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
          <Bubble variant="ghost" className={BUBBLE_WRAP_CLS}>
            <BubbleContent className={BUBBLE_ROBOT_CLS}>
              {item.markdown != null ? (
                <ChatMarkdown text={item.markdown} />
              ) : (
                <>
                  {(item.paragraphs ?? []).map((p, j) => (
                    <p
                      key={j}
                      className={
                        j > 0 ? 'mt-0.5 text-card-title leading-6' : 'text-card-title leading-6'
                      }
                    >
                      <Segments segments={p} />
                    </p>
                  ))}
                  {item.bullets?.map((b, j) => (
                    <p key={`b${j}`} className="mt-0.5 flex gap-2 text-card-title leading-6">
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
              {(item.tools?.length ?? 0) > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={MSG_TOOL_BTN_CLS}
                  aria-label={toolsOpen.has(i) ? t('收起过程') : t('展开过程')}
                  aria-expanded={toolsOpen.has(i)}
                  onClick={() => onToggleTools(i)}
                >
                  {toolsOpen.has(i) ? (
                    <ChevronDown width={11} height={11} />
                  ) : (
                    <ChevronRight width={11} height={11} />
                  )}
                </Button>
              )}
            </div>
          )}
          {(item.tools?.length ?? 0) > 0 && toolsOpen.has(i) && (
            <div className={TURN_TOOLS_CLS} data-testid="chief-turn-tools">
              {item.tools?.map((tool, k) => (
                <div key={k} className={TURN_TOOL_ROW_CLS}>
                  <span className={TURN_TOOL_NAME_CLS}>{tool.label}</span>
                  {tool.seconds !== undefined && <span className="flex-none">{tool.seconds}s</span>}
                  {tool.error === true && (
                    <span className="flex-none text-(--destructive)">{t('失败')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}
