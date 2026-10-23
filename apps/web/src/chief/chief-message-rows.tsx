// Chief 窗消息流行渲染器（#1126 自 chief-drawer.tsx 逐字提取）：8 个 stream
// item 种类（error/note/user/thinking/tool/question/streaming/robot）的渲染、
// 行级常量族与 Segments/robotText 助手全住这里。提取是**纯搬移**——DOM 逐字节
// 不变是验收闸：chief-body / chief-stream / chief-msg / chief-msg-col /
// chief-bubble / chief-msg-tools / chief-msg-foot / chief-turn-tools /
// chief-chip-todo / chief-chip-agent 这些 testid 被 ≥6 条 e2e spec + 单测钉住，
// 各行注释里记录的裁决（#615/#739/#742/#873/#905/#955/#1049 等）随代码随迁。
// 状态（copiedKey/toolsOpen/rewindConfirm）留在 drawer——rewind 确认层与
// composer 同住一处；行经 props 收回调。

import type { AskUserAnswer } from '@cairn/shared';
import type { CSSProperties } from 'react';
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
import type { ChiefContent, ChiefSegment, ChiefStreamItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChiefFaceDashed,
  Copy,
  FileText,
  Restore,
} from '../icons/index.js';
import { ChiefIdentity } from './chief-identity.js';
import { ChiefQuestionCard } from './chief-question-card.js';
import { AVATAR_IMG_CLS, AVATAR_SLOT_CLS } from './recipes.js';

/** 消息行 20×20 工具钮（旧 .chief-msg-tool 几何等值；hover 升
 *  surface-secondary 底 + secondary 墨；aria-expanded 涂底保留件行为、墨
 *  钉回基墨）。墨槽 dim→tertiary：#950 better-colors 实测 dim 在本面底上
 *  light 2.89:1 低于正典对 --text-dim 槽自钉的 3:1 下限（spec/22 §1.8），
 *  按 #908 裁决 2 换消费面槽引用（token 值不动）。 */
const MSG_TOOL_BTN_CLS =
  "size-5 cursor-pointer rounded-none border-none bg-transparent text-(--text-tertiary) hover:bg-(--secondary) hover:text-(--text-secondary) dark:hover:bg-(--secondary) aria-expanded:bg-muted aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

/** 回合过程折叠面（旧 .chief-turn-tools 等值：foot 下挂工具行表，
 *  surface-secondary 底 6/8 内垫，mono 名 + 秒数 + 失败徽标 dim 墨压底；
 *  行字 = text-caption 11.5px，#1398）。
 *  圆角随流面家族 = --radius-popover 12px（BUBBLE_USER_CLS 同档，A1 几何
 *  钉回原值；#1054 清点接依据，直角退役）。 */
const TURN_TOOLS_CLS =
  'mt-1.5 flex flex-col gap-1 rounded-(--radius-popover) bg-(--secondary) px-2 py-1.5';
const TURN_TOOL_ROW_CLS = 'flex items-center gap-2 font-mono text-caption text-(--text-tertiary)';
const TURN_TOOL_NAME_CLS = 'min-w-0 flex-auto truncate';

/** 消息列（旧 .chief-msg-col 等值 + #650 抽屉节奏 scoped 覆盖）：正文
 *  text-card-title 14px / 24px 行高（#1398 字号键）、primary 墨由容器 inheritance 承接（chat-markdown 块自身
 *  不带字号规则，detail.css 正本只管块距）；段距 2px 与气泡首尾块 margin
 *  归零两条覆盖的对象是 detail.css 的 unlayered 块距正典（.chat-para +
 *  .chat-para 7px、.chat-md-code 8px 上下）——CSS 级联律：unlayered 恒压
 *  layered utility，important 修饰是 utility 层赢过 unlayered 正典的唯一
 *  出口（important 声明的层序优先于一切 normal 声明）。 */
const MSG_COL_CLS =
  'min-w-0 flex-1 text-card-title leading-6 text-(--foreground) [&_.chat-para+.chat-para]:mt-0.5!';
const BUBBLE_MD_CLS = '[&>:first-child]:mt-0! [&>:last-child]:mb-0!';

/** Item 的 [content-visibility:auto] 用 inline style 钉回 visible：离屏行不跳
 *  布局，e2e 可见性断言与探针几何采样不随滚动相位漂（determinism 优先于
 *  虚拟化收益——380px 窗数十行的规模）。（#1009 A1 中和配方的一部分，其余
 *  常量留在 drawer 壳层。） */
const SCROLLER_ITEM_STYLE: CSSProperties = { contentVisibility: 'visible' };

/** 行骨架中和：Message 原语默认（gap-2）钉回现行行几何；identity chip
 *  列形 = flex-col gap-1.5（#741 参考站 assistant-message 形原值）。 */
const MSG_ROW_CLS = 'mt-3.5 gap-2.5';
const MSG_ROW_IDENTITY_CLS = 'mt-3.5 flex-col gap-1.5';
const MSG_COL_MID_CLS = `${MSG_COL_CLS} gap-0`;
const MSG_COL_LIVE_CLS = 'min-w-0 flex-1 gap-0';

/** Bubble 默认皮几何中和（票面）。user 行 = secondary 档：--secondary 底
 *  即原 BUBBLE_CLS 槽位、--secondary-foreground 双主题与 --foreground 等值
 *  （#1002 色板实测同值）；几何钉回原值（radius-popover / px-3 py-2.5 /
 *  leading-6 / 满列宽——原语 80% cap 与 w-fit 随现状面中和）。robot 行 =
 *  ghost 档：裸文本面，结构走原语、皮肤零（p-0/bg-transparent 由 ghost
 *  档父选择器承载，消费点只补 leading-6 与满宽）。 */
const BUBBLE_WRAP_CLS = 'w-full max-w-full';
// border-0：BubbleContent 原语自带 border border-transparent（不可见但吃
// 2px 几何——F-R16 的 44px 药丸 canon 是零边框面值），中和面逐像素对齐。
const BUBBLE_USER_CLS = 'w-full rounded-(--radius-popover) border-0 px-3 py-2.5 leading-6';
const BUBBLE_ROBOT_CLS = 'w-full border-0 leading-6';
/** note/error 的居中 annotation 行 = Marker 原语（上游用途本义）；字号/
 *  墨色钉回现状（text-xs + tertiary/destructive，原语 text-sm/muted 中和），
 *  error 二段面走 flex-col。 */
const MARKER_NOTE_CLS = 'my-2.5 justify-center text-center text-meta text-(--text-tertiary)';
const MARKER_ERROR_CLS =
  'my-2.5 flex-col justify-center text-center text-meta text-(--destructive)';

/** 行内 mention chip 皮肤（#950 清零，旧 .chief-chip-todo/.chief-chip-agent
 *  等值：1px/6px 内垫、4px 圆角（一次性尺寸 §3.1(a)）、2px 边距、1px 光学
 *  上抬；todo = chip-plan 令牌对，agent = seg-active 底 + 次级墨）。 */
const CHIP_INLINE_CLS =
  'mx-0.5 inline-flex items-center gap-1 rounded-[4px] px-1.5 py-px align-[1px] text-meta';

/** Inline runs → plain text（#615 复制钮的 clipboard 载荷：chip 取其label，
 *  代码段取原文——复制的是读者可见文本）。 */
function segmentsText(segments: ChiefSegment[]): string {
  return segments.map((s) => (s.todo != null ? `#${s.todo}` : (s.agent ?? s.text ?? ''))).join('');
}

/** robot 消息全文（#615 foot 复制钮载荷）：markdown 行取原文（#469
 *  transcript 同律——复制的是消息 markdown 源）；段数组行（fixture 捕获形）
 *  段落换行拼接 + bullet 行随附。 */
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

/** Inline runs: plain text, mono chip, `#N` todo chip, agent chip. */
function Segments({ segments }: { segments: ChiefSegment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.todo != null)
          return (
            // chip 的 data-testid = #910 二级载体：spec 钉的是「实体成 chip」
            // 本身（F-R1/R3 字面漏出的对立面），纯文本载体区分不了 chip 与
            // 漏出的字面量。
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
              <ChiefFaceDashed width={11} height={11} />
              {s.agent}
            </span>
          );
        if (s.code)
          return (
            <code key={i} className="rounded-[4px] bg-(--muted) px-1 py-px font-mono text-meta">
              {s.text}
            </code>
          );
        return s.strong ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

/** map 位的 React key 律（与提取前逐行一致）：user/robot/thinking/tool/
 *  question 行有源 chief_message id 用 id（无 id 回落 index）；note/error/
 *  streaming 变体类型上就没有 id 字段，恒用 index。 */
export function chiefStreamRowKey(item: ChiefStreamItem, index: number): string | number {
  switch (item.kind) {
    case 'user':
    case 'robot':
    case 'thinking':
    case 'tool':
    case 'question':
      return item.id ?? index;
    default:
      return index;
  }
}

interface ChiefStreamRowProps {
  item: ChiefStreamItem;
  /** 行序号 i：复制回执键（`u<i>`/`r<i>`）、过程折叠开态集与 rewind 锚都按它编址。 */
  index: number;
  bound: ChiefContent['bound'];
  agent: ChiefContent['agent'];
  runningTool: ChiefContent['runningTool'];
  /** 用户行头像身份（#650/XMON-105 单源：avatarUrl 覆盖 > dicebear 种子 > 静态兜底）。 */
  user: CurrentUser;
  /** #615 复制钮瞬时回执：键 = 消息位，1.5s 后回 Copy 字形（状态留 drawer）。 */
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  /** #615 返工 foot 折叠：该回合工具行的展开态集（状态留 drawer）。 */
  toolsOpen: ReadonlySet<number>;
  onToggleTools: (index: number) => void;
  /** #615 返工恢复钮：行只提请，确认层（与幂等窗逻辑）留 drawer。 */
  onRewindRequest: (index: number, id: string | null) => void;
  /** #1049 问答卡：pending 期提交/取消回调；fixture 面缺省 = 惰性。 */
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
  // #631 失败行（chief_turn_error 投影）：居中 danger 提示 +
  // 原因原文（server 数据，不经 t()——用户/agent 内容同律）。
  // #1009 A1：居中 annotation 行 = Marker 原语（上游用途
  // 本义）；role=alert 与二段面（提示 + 原因块）原样，字号
  // 墨色中和钉回现状（MARKER_ERROR_CLS 注记）。error 行无
  // 源 message id（system 行投影），key 走 index（见 chiefStreamRowKey）。
  if (item.kind === 'error')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Marker role="alert" className={MARKER_ERROR_CLS}>
          <MarkerContent>{t('总管本轮执行失败')}</MarkerContent>
          <span className="mt-0.5 block break-all text-(--text-tertiary)">{item.text}</span>
        </Marker>
      </MessageScrollerItem>
    );
  if (item.kind === 'note')
    return (
      <MessageScrollerItem style={SCROLLER_ITEM_STYLE}>
        <Marker className={MARKER_NOTE_CLS}>
          <MarkerContent>
            {t(item.text)}
            {item.machineName && (
              <>
                {/* r5 114：`运行在 … 上` 的机器名下划线。 */}
                <span className="underline underline-offset-2">{item.machineName}</span>
                {t('上')}
              </>
            )}
          </MarkerContent>
        </Marker>
      </MessageScrollerItem>
    );
  // #1009 A1：行骨架翻 Message 原语（头像列 + 内容列），气泡翻
  // Bubble secondary 档（--secondary 底 = 原 BUBBLE_CLS 槽位，
  // 几何中和钉回原值——BUBBLE_USER_CLS 注记）；A1 行 id 贯通后
  // key/messageId 走源 chief_message id（fixture 面缺省回落 index）。
  if (item.kind === 'user')
    return (
      <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
        <Message className={MSG_ROW_CLS} data-testid="chief-msg">
          {/* #650 / XMON-105: 用户行头像接全站单源——与详情页对话
              用户行（transcript.tsx）逐字节同配方：avatarUrl 覆盖 >
              dicebear 名字种子 > 静态兜底资产。原写死的
              ChiefUserSolid 通用人形字形是全站最后一个漏网点。
              （A1：头像槽保持 recipes 单源 span——MessageAvatar 原语
              自带 bg-muted/min-w-8 皮，中性化成本高于收益，A2 再裁。） */}
          <span className={AVATAR_IMG_CLS}>
            <SeededAvatar
              className="size-6"
              name={user.displayName}
              src={user.avatarUrl}
              fallback="/avatar-user.png"
            />
          </span>
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            {/* #742：live 用户行的 markdown 槽（详情页用户行
                    transcript.tsx #612 同款配方）——经共用块级解析器
                    渲染，todo 提及 chip / 粗体 / 行内 code / 围栏不再
                    按字面漏出；md 形气泡首/尾块 margin 归零（上下
                    留白由 10px padding 承担，块自带 margin 不再叠出
                    双倍间距或尾部空转），纯文本槽（fixture 捕获形）
                    保持字面路径 DOM 与几何逐字不变。复制载荷照旧取
                    item.text 原文（#469 律），rewind 锚 id 透传不动。 */}
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
              {/* #615 C：复制翻真 clipboard 钮（local-first 面存在）。 */}
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
              {/* #615 返工（用户裁决覆盖 #306 二分律）：恢复钮闭环
                  ——aria 正词「恢复到此处」= 参考站 live 同名控件；
                  语义 = rewind 锚（截断锚后消息 + 新会话重发该条，
                  server POST chief threads rewind）。破坏性 → 确认
                  层先行；fixture 面（onRewind 缺省 / id 缺省）走
                  accept 律关窗零请求。 */}
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
  // #955 思考段行：与 robot 行同槽（绑定身份脸 / 未绑定虚线 chief 字形）+
  // 折叠式思考体，无 foot（思考不参与复制/恢复）。
  // #1033：本行与工具行是 chief.css 退役（#950）后仅存的两处
  // 死类名残留——骨架接回 robot/streaming 行同一套原语
  // （AVATAR_IMG_CLS / AVATAR_SLOT_CLS / MSG_COL_CLS，行几何
  // mt-3.5 flex gap-2.5）。`chief-msg` 类名保留：e2e 用它当
  // 选择器（chief-stream-markdown.spec F-R19/R20）。
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
              />
            </span>
          ) : (
            <ChiefFaceDashed width={24} height={24} className={AVATAR_SLOT_CLS} />
          )}
          <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
            <ThinkingRow text={item.text} />
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    );
  // #955 流式期工具行：mapper 只在回合在飞（activeRun 非空）时
  // 产出，与文本段按序交错；收口后回到 robot 行的折叠面。
  // #1033：同思考行——骨架接回原语，`chief-msg` 类名保留。
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
  // #1049 问答卡：头像槽同思考行（绑定身份脸/虚线字形），内容列
  // = ChiefQuestionCard（选项可点/多选/自由文本；pending 期答/取
  // 消回调 = surface mutations；答毕 SSE 重取翻面）。
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
            <ChiefFaceDashed width={24} height={24} className={AVATAR_SLOT_CLS} />
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
  // #739 在飞存在行：回合在飞但首 token 未至的静默窗口——头像槽
  // 复用 robot 行的 agent 身份脸（bound = 绑定 Agent，未 bound =
  // 虚线 chief 字形），右侧 = loading-dev Atom + `处理中...`，与
  // 详情页对话区 streaming 行同一套词汇（transcript.tsx 正典）。
  // 不挂秒数（#471），首 delta 到达即被 typing 行取代。
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
              />
            </span>
          ) : (
            <ChiefFaceDashed width={24} height={24} className={AVATAR_SLOT_CLS} />
          )}
          {/* #873：行骨架/展开律/走秒律全部收进共享 LiveRow
              （components/chat/live-row）——与详情页 streaming 行
              同一份行为源。本面只提供皮肤（SKIN.chief utility，
              #950 起住 live-row 本体）与展开面内容（#822 的过程
              披露：正在调用的工具 + 本轮已落库工具行）。
              秒数不挂：本面没有真实起点（activeRun 封套不带时间戳），
              没有起点就不摆数字（#471 律），而不是摆一个冻结的数。 */}
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
                {/* 兜底行 = 零信号窗口的存在证明（#739）；
                        #905 活动信号在位时行首标签已给出相位，
                        兜底行退场避免语义重复（interface-review
                        收尾发现）。 */}
                {runningTool == null &&
                  (item.tools?.length ?? 0) === 0 &&
                  item.signalAt == null && (
                    <div className={TURN_TOOL_ROW_CLS}>
                      <span className={TURN_TOOL_NAME_CLS}>{t('等待 Agent 响应…')}</span>
                    </div>
                  )}
                {/* #905：最近信号新鲜度与详情披露面同源
                        （LiveSignal 走表）；无信号不渲染该行。 */}
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
  // XMON-105: a bound chief answers as its agent — the stream
  // row carries that agent's identity; unbound keeps the dashed
  // chief glyph. #741: the bound identity is a chip (avatar +
  // name, whole chip → the agent's settings page) heading the
  // row, content full-width below it (reference assistant-
  // message form) — the row flips to a column. The dashed form
  // keeps the old side-avatar slot, byte-identical DOM.
  const identity = bound && agent ? <ChiefIdentity agent={agent} /> : null;
  return (
    // #741：绑定形行翻列（identity chip 头 + 全宽正文，参考站
    // assistant-message 形）；虚线未绑定形保持侧头像槽，
    // DOM 逐字不变。gap：identity 形 6（[设计] 2/7/10 档中值），
    // 侧头像形 10。
    // #1009 A1：骨架翻 Message 原语，正文包 Bubble ghost 档
    // （裸文本面——结构走原语、皮肤零：p-0/bg-transparent/
    // rounded-none 由 ghost 档父选择器承载）；定稿行 key/
    // messageId 走源 chief_message id（打字尾行无 id 回落 index）。
    <MessageScrollerItem messageId={item.id} style={SCROLLER_ITEM_STYLE}>
      <Message
        className={identity != null ? MSG_ROW_IDENTITY_CLS : MSG_ROW_CLS}
        data-testid="chief-msg"
      >
        {identity ?? <ChiefFaceDashed width={24} height={24} className={AVATAR_SLOT_CLS} />}
        <MessageContent className={MSG_COL_MID_CLS} data-testid="chief-msg-col">
          <Bubble variant="ghost" className={BUBBLE_WRAP_CLS}>
            <BubbleContent className={BUBBLE_ROBOT_CLS}>
              {item.markdown != null ? (
                // #650: live 回复原文走共用块级解析器（chat-markdown，
                // transcript robot 行 #469 同律）——bold / 行内 code /
                // mention / 列表 / 代码栅栏与详情页同形；抽屉节奏
                // （14px/24px、段距 2px）由 MSG_COL_CLS 的容器
                // inheritance + scoped 覆盖承载（正本注释见常量）。
                // #651 typing 尾行同源同渲染——增量面与终稿面同形，
                // 收敛不跳变。
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
          {/* #651: typing 打字面是未定稿行——foot（复制/完成/过程
              折叠）只属定稿行，打字行不渲染。 */}
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
              {/* live 面 seconds 空串（mapChiefStream 无耗时数据源）
                不再渲染空「完成」行；fixture canon 44s 照旧。 */}
              {item.seconds !== '' && <span>{t('完成 {n}', { n: item.seconds })}</span>}
              {/* #615 返工（用户裁决覆盖 #306 二分律）：foot 折叠箭头
                闭环 = 该回合过程披露（Multica OuterProcessFold 同
                族：chevron + 展开内容 = 工具步；r5 114 捕获位 = 完
                成 Ns 之后的 ›）。展开面 = 被流主呈现滤掉的工具调
                用行（chief_message toolcall 投影，DB 既有零新后端）；
                无工具行的回合不渲染触发器（无可披露内容）。 */}
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
