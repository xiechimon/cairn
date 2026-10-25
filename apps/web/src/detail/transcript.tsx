// Chat column transcript (issue #56, extended in #57 for the deep
// states and in #75 for the r8 dynamic states): centered run stamps and
// quiet note lines, the scheduled marker, user bubbles with optional
// taskline, robot paragraphs with mono code chips / quote blocks /
// numbered findings, message action rows (copy + optional `| 完成 Ns` +
// optional chevron, r7 17/28 + r8 63/65/73), the
// chief-origin marker, the failed-run message (r8 54/73), the collapsed
// plan card, the live streaming row and the tool-call group. Row geometry
// from the r7 16/17/26/27/28/36/38 and r8 54–77 captures; CONTEXT.md canon
// names the message flow `transcript`.

import { useState } from 'react';
import { inlineSegments } from '../api/mappers.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { RobotPara, TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  FileTab,
  Terminal,
} from '../icons/index.js';
import { ChatMarkdown, TaskCard } from './chat-markdown.js';
import { Segments } from './segments.js';

/** Live step facts the streaming row discloses (#873): the panel is the one
 *  thing the row can say that the timeline does not already carry. Null =
 *  no panel, and with it no chevron. */
export interface LiveStep {
  /** Phase label of the running step (规划 / 构建 / 审核). */
  step: string;
  /** Executing machine name, when one is already known. */
  machine: string | null;
}

interface TranscriptProps {
  transcript: TranscriptItem[];
  /** #873: the running step behind the live row (null = unknown/fixture). */
  liveStep?: LiveStep | null;
  /** XMON-105: the run's executing agent — agent message rows (robot /
   *  fail / streaming / review) render this agent's avatar (avatarUrl
   *  override > dicebear displayName seed > static robot asset), the same
   *  identity the board card / team page / ⌘K rows show for it. Null =
   *  unassigned run, rows keep the static asset. */
  agent?: { displayName: string; avatarUrl: string | null } | null;
  /** #366: the collapsed plan card's open glyph activates the plan
   *  document in the right pane (doc view, plan surface). Absent = the
   *  glyph stays the inert capture form. */
  onOpenPlan?: () => void;
}

/** Elapsed label: `Ns` under a minute (r7 21s/19s), `Nm Ns` above
 *  (r8 56 plan card `完成 2m 41s`, #74 dict template). */
function formatElapsed(seconds: number, t: TFunc): string {
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return t('完成 {elapsed}', { elapsed });
}

// #945（detail.css 清零）：线程列皮肤迁 token utilities。行距律 = r7
// 16/17/26/27 捕获：用户行 18px、agent 行 21px、连续 agent 行收紧 14px
// （r7 26d result→streaming）、note 之后的行 6px——老 CSS 用 `+` 相邻
// 选择器表达，这里改由渲染序派生（行 margin 是每行首个类，无叠层竞争）。
// ghost 七通道中和（#908 裁决 3）随各钮带上。
const ROW_BASE = 'chat-row flex items-start';

/** #1009 A2：行骨架中和——原语 Item 的 [content-visibility:auto] 走 inline
 *  style 钉回 visible。离屏行不跳布局，e2e 可见性断言与探针几何采样不随滚动
 *  相位漂（determinism 优先于虚拟化收益，A1 同律）。 */
const SCROLLER_ITEM_STYLE = { contentVisibility: 'visible' } as const;

/** 行的 DOM 末节点是否 agent 行（连续 agent 收紧律的前件）：robot 无
 *  footer（有 footer 时末节点是 action 行）与 streaming 两形。 */
function endsWithAgentRow(item: TranscriptItem | undefined): boolean {
  if (item == null) return false;
  if (item.kind === 'streaming') return true;
  return item.kind === 'robot' && item.footer == null;
}

/** 现行在老相邻选择器律下的 margin-top（chat-row 族专用）。 */
function rowMargin(item: TranscriptItem, prev: TranscriptItem | undefined): string {
  // `.chat-note + .chat-row`（6px）在老文件里排最后 = 同特异度下压过
  // agent 族——渲染序派生保持同一优先级。
  if (prev?.kind === 'note') return 'mt-1.5';
  switch (item.kind) {
    case 'robot':
    case 'fail':
    case 'streaming':
    case 'review':
    case 'report':
      return endsWithAgentRow(prev) ? 'mt-3' : 'mt-5';
    case 'chief':
      return 'mt-1';
    case 'user':
      return 'mt-4';
    default:
      return '';
  }
}

/** `.chat-para + .chat-para` 的渲染序等价形——段列表/finding 容器内非首段
 *  挂 8px（4px 网格）。 */
const PARA = 'chat-para m-0';
const PARA_GAP = 'mt-2';

/** Message action row (r7 17/28, r8 63/65/73, #634 follow-up re-measured
 *  2026-10-02): optional copy button, then the optional `| 完成 Ns` elapsed
 *  tail. Every footer variant observed is a subset of this one row. With
 *  `toggle` the elapsed tail + chevron render as the tool group's
 *  expand/collapse button (#306) instead of static nodes.
 *
 *  #634 follow-up: the reference footer's copy is a REAL button (measured:
 *  robot row copies the message markdown, the user row copies the todo
 *  markdown link), and its chevron only ever exists as a group expander —
 *  the done-phase footers carry none. Our copy icon used to be inert
 *  decoration on every row and the robot/plan footers carried an inert
 *  `›`: shape without semantics. Now `copy` carries the row's human
 *  readable text (absent = no copy affordance at all) and the chevron
 *  renders only where `toggle` gives it something to expand.
 *
 *  #884: the captures also show a restore glyph beside the copy (reference
 *  hover button, r3 §3.5). It renders here no more: this product has no
 *  build-level rewind object surface to hang it on — the checkpoint data
 *  source is per-step (`step.checkpointCommit`, the merge step's landing
 *  key), the phase machine carries no reverse edge, the daemon's
 *  `reset --hard + clean -fd` restore has no server-initiated dispatch
 *  path, and the reference's own click behavior was never observed (r3
 *  §3.5 / 02 §4.2 both mark it [推断]). Same law as #634: a shape without
 *  semantics is the bug, so the glyph and its data field are gone. The
 *  chief drawer's 恢复到此处 keeps its wired chat-rewind semantics. */
function ActionRow({
  seconds,
  bare,
  copy,
  t,
  toggle,
  label,
  align = 'start',
}: {
  seconds?: number;
  /** `完成` with no seconds (reused-plan card, r8 76). */
  bare?: boolean;
  /** Clipboard payload = the row's human-readable content. Absent = the
   *  row renders no copy affordance (an icon that copies nothing is the
   *  bug this follow-up removes). */
  copy?: string;
  t: TFunc;
  /** #306: the tools group's footer doubles as the expander (collapsed
   *  r7 27 ↔ expanded 28 family, same law as 全部展开/全部收起). */
  toggle?: { expanded: boolean; onToggle: () => void };
  /** #933: the row's identity — terminal glyph + name ahead of the elapsed
   *  tail, so a collapsed group reads as a folded tool process instead of
   *  a stray pill. Only the tools group passes one. */
  label?: string;
  align?: 'start' | 'end';
}) {
  const tail = (
    <>
      {label != null && (
        <span className="inline-flex items-center gap-2 text-meta whitespace-nowrap text-(--text-secondary)">
          <Terminal width={12} height={12} />
          {label}
        </span>
      )}
      {(seconds != null || bare === true) && (
        <span className="border-l border-(--input) pl-2 text-meta whitespace-nowrap text-(--text-tertiary)">
          {seconds != null ? formatElapsed(seconds, t) : t('完成')}
        </span>
      )}
      {toggle != null &&
        (toggle.expanded ? (
          <ChevronDown
            width={10}
            height={10}
            className="chat-foot-chevron text-(--text-tertiary)"
          />
        ) : (
          <ChevronRight
            width={10}
            height={10}
            className="chat-foot-chevron text-(--text-tertiary)"
          />
        ))}
    </>
  );
  return (
    <div
      className={`chat-row-icons mt-5 flex items-center gap-3.5 text-(--text-tertiary) ${align === 'end' ? 'justify-end' : 'pl-8'}`}
      data-testid="msg-actions"
    >
      {copy != null && (
        // p-0 keeps the 13px icon box the inert span carried, so the row
        // geometry the #470 fence pins does not move. #945：.chat-copy 的
        // 无边框透明底迁 utilities（ghost hover 底双档中和，墨色走 inherit
        // = 行的 tertiary；老面无 cursor 规则，不加 cursor-pointer）。
        <Button
          variant="ghost"
          className="chat-copy h-auto justify-start rounded-none border-none bg-transparent p-0 hover:bg-transparent hover:text-inherit dark:hover:bg-transparent dark:hover:text-inherit active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
          aria-label={t('复制')}
          onClick={() => {
            void navigator.clipboard.writeText(copy);
          }}
        >
          <Copy width={13} height={13} />
        </Button>
      )}
      {toggle == null ? (
        tail
      ) : (
        // XMON-24 行图标 toggle shadcn ghost 底座不变；#945 皮肤/几何迁
        // utilities——font:inherit 灭底座字号（text/leading-[inherit]）、
        // bg transparent + 七通道中和灭 hover/aria-expanded 底、左 padding
        // 归零（#634：toggle 是行内尾段钮，行的 31px inset 只算一次）。
        <Button
          variant="ghost"
          className="chat-row-icons--toggle h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-[length:inherit] leading-[inherit] font-normal hover:bg-transparent hover:text-inherit dark:hover:bg-transparent dark:hover:text-inherit aria-expanded:bg-transparent aria-expanded:text-inherit active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
          aria-expanded={toggle.expanded}
          onClick={toggle.onToggle}
        >
          {tail}
        </Button>
      )}
    </div>
  );
}

function Para({ para, gap = false }: { para: RobotPara; gap?: boolean }) {
  // #945：AI-review 引用块（r8 65）= 4px 左缝 + 15px 内距 + tint 带
  // background-clip 到 content box（缝留透明）；悬挂序号 = relative +
  // 19px 左内距 + 绝对序号位。
  const quoteSkin =
    'border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 [background-clip:content-box] text-(--text-secondary)';
  if (para.quote === true) {
    return (
      <p className={`${PARA} ${quoteSkin}${gap ? ` ${PARA_GAP}` : ''}`}>
        <Segments segments={para.segments} codeClassName="chat-code" />
      </p>
    );
  }
  if (para.ordinal != null) {
    return (
      <p
        className={`${PARA} relative pl-5${gap ? ` ${PARA_GAP}` : ''}`}
        data-ordinal={para.ordinal}
      >
        <span className="absolute left-0">{para.ordinal}.</span>
        <Segments segments={para.segments} codeClassName="chat-code" />
      </p>
    );
  }
  return (
    <p className={`${PARA}${gap ? ` ${PARA_GAP}` : ''}`}>
      <Segments segments={para.segments} codeClassName="chat-code" />
    </p>
  );
}

/** XMON-105: agent message-row avatar — the executing agent's own identity
 *  (avatarUrl override > dicebear displayName seed), static Notionists
 *  asset only for unassigned runs. Same resolution as every other agent
 *  avatar surface (board card / team page / ⌘K rows), so one agent reads
 *  as one face across the app. */
function AgentRowAvatar({
  agent,
  busy = false,
}: {
  agent: { displayName: string; avatarUrl: string | null } | null;
  busy?: boolean;
}) {
  // agent 头像骑在文本行盒上方 4px（r7 26/27/36：avatar top = text top − 4，
  // 老 `.chat-row--agent .chat-avatar` 上下文规则的同值迁移）。
  return (
    <span
      className="chat-avatar -mt-1 flex-none size-5 [&_img]:block [&_img]:size-5"
      data-testid="msg-avatar"
    >
      <SeededAvatar
        className="size-5"
        name={agent?.displayName}
        src={agent?.avatarUrl}
        fallback="/avatar-robot-1.svg"
        busy={busy}
      />
    </span>
  );
}

function Row({
  item,
  prev,
  t,
  onOpenPlan,
  agent,
  liveStep,
}: {
  item: TranscriptItem;
  /** 前一条目——行距律（18/21/14/6px）的相邻判定输入（#945）。 */
  prev: TranscriptItem | undefined;
  t: TFunc;
  onOpenPlan?: () => void;
  agent: { displayName: string; avatarUrl: string | null } | null;
  liveStep: LiveStep | null;
}) {
  const margin = rowMargin(item, prev);
  switch (item.kind) {
    case 'run':
      return (
        <div className="flex-none text-center text-meta text-(--text-tertiary)">
          {item.at != null && <div>{item.at}</div>}
          {item.machine != null && (
            <div className="mt-1 text-caption leading-3 text-(--text-tertiary) [&_span]:underline">
              {t('运行在 {m} 上', { m: item.machine ?? '' })
                .split(item.machine ?? '')
                .map((part, i) =>
                  i === 0 ? (
                    <span key={i}>
                      {part}
                      <span>{item.machine}</span>
                    </span>
                  ) : (
                    <span key={i}>{part}</span>
                  ),
                )}
            </div>
          )}
          {item.cancelled === true && (
            <div className="chat-stamp-cancelled mt-1 text-caption leading-3 text-(--fail-fg)">
              {t('已取消')}
            </div>
          )}
        </div>
      );
    case 'note':
      // #634: note text is data (daemon/system prose or mapper labels like
      // 记忆已更新) — route it through t() so en-dict entries apply; unknown
      // keys fall back to the zh original (translate.ts law).
      // #470：68ch 行宽 cap + auto 侧 margin（宽列下居中不 mid-token 折行）。
      return (
        <div
          className="chat-note mx-auto mt-5 max-w-[68ch] text-center text-meta text-(--text-tertiary)"
          data-testid="transcript-note"
        >
          {t(item.text)}
        </div>
      );
    case 'scheduled':
      return (
        <div className="chat-scheduled mt-3.5 flex items-center gap-1.5 text-meta text-(--text-tertiary)">
          <Clock width={13} height={13} />
          {t('由定时发起')}
        </div>
      );
    case 'injected-skills':
      // #1106 注入选择回查行（note 同视觉族，居中 tertiary 小字）：每技能
      // 一段 `id（原因）`，零命中 = 单行「未注入」占位。独立 testid 供
      // 探针定位；原因 = 服务端 reason 原文（数据，不走 t()——同 note 的
      // #634 例外：t() 只管 label 模板）。
      return (
        <div
          className="chat-note mx-auto mt-3.5 flex max-w-[68ch] flex-wrap items-baseline justify-center gap-x-1.5 text-center text-meta text-(--text-tertiary)"
          data-testid="injected-skills"
        >
          {item.skills.length > 0 ? (
            <>
              <span>{t('注入技能：')}</span>
              {item.skills.map((s) => (
                <span key={s.id} className="[overflow-wrap:anywhere]">
                  {s.id}
                  <span className="text-(--text-tertiary)">（{s.reason}）</span>
                </span>
              ))}
            </>
          ) : (
            <span>{t('未注入技能（任务文本未命中任何技能）')}</span>
          )}
        </div>
      );
    case 'chief':
      return (
        <div className={`${ROW_BASE} chat-row--chief ${margin}`}>
          <span
            className="chat-avatar flex-none size-5 [&_img]:block [&_img]:size-5"
            data-testid="msg-avatar"
          >
            <img src="/avatar-robot-2.svg" alt="" />
          </span>
          <span className="ml-3 text-meta text-(--text-tertiary)">{t('由总管发起')}</span>
        </div>
      );
    case 'user':
      return (
        <>
          <div className={`${ROW_BASE} chat-row--user justify-end ${margin}`}>
            <span
              className={`chat-bubble anim-message-fade-up mt-1 min-h-6 min-w-0 max-w-[min(80%,56ch)] rounded-(--radius-bubble) rounded-br-[6px] bg-(--secondary) px-3.5 py-1 text-card-title leading-6 break-words text-(--foreground) ${
                item.markdown != null
                  ? 'whitespace-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0'
                  : 'whitespace-pre-wrap'
              }`}
              data-testid="user-bubble"
              {...(item.markdown != null ? { 'data-md': 'true' } : {})}
            >
              {item.markdown != null ? <ChatMarkdown text={item.markdown} /> : item.text}
            </span>
          </div>
          {item.seq != null && item.title != null && (
            <div className="mt-1.5 flex items-center justify-end" data-testid="taskline">
              <span className="flex h-5 flex-none items-center rounded-[4px] bg-(--muted) px-2 text-caption text-(--text-secondary)">
                #{item.seq}
              </span>
              <span className="ml-1 min-w-0 break-words text-card-title leading-5 font-medium text-(--foreground)">
                {item.title}
              </span>
            </div>
          )}
          {/* #634 follow-up: the user row's copy is real too — the bubble's
              own text (the reference copies its todo markdown link here;
              our share surface for that is the 更多 menu's 复制链接). */}
          <ActionRow copy={item.markdown ?? item.text} t={t} align="end" />
        </>
      );
    case 'robot':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            {item.markdown != null ? (
              // #469: block markdown reply — parsed + rendered at render
              // time (headings / nested lists / code fences); inline code
              // chips stay `.chat-code`.
              <ChatMarkdown text={item.markdown} />
            ) : (
              (item.paragraphs ?? []).map((raw, i) => (
                // fixture order is stable; paragraphs carry no ids
                <Para key={i} para={Array.isArray(raw) ? { segments: raw } : raw} gap={i > 0} />
              ))
            )}
          </span>
          {item.footer != null && (
            <ActionRow seconds={item.footer.seconds} copy={robotCopyText(item)} t={t} />
          )}
        </div>
      );
    case 'report':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="info-report"
          >
            <ChatMarkdown text={item.markdown} />
          </span>
        </div>
      );
    case 'thinking':
      // #1034 同源缺陷：本行曾只挂死类名（chat-row / chat-text 零规则）——
      // 既无 flex 也无宽度上限，20px 头像槽（-mt-1 骑顶设计）直接压在文字上。
      // 对齐 robot 行工具类（:419）：ROW_BASE 供 flex 骨架，chat-text 挂
      // ml-3 头文间距 + max-w-[68ch] min-w-0 宽度上限——上限是行内
      // ThinkingRow 截断律（#772）能生效的前提。
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)">
            <ThinkingRow text={item.text} />
          </span>
        </div>
      );
    case 'agent-todo':
      return (
        <div className="mt-3.5 max-w-[68ch] pl-8" data-testid="agent-todo">
          <TaskCard
            items={item.items.map((it) => ({
              state: it.state,
              segments: inlineSegments(it.text),
            }))}
          />
        </div>
      );
    case 'fail':
      return <FailRow item={item} margin={margin} t={t} agent={agent} />;
    case 'streaming':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} busy />
          {/* #873: the row itself is the shared live row (components/chat/
              live-row) — same skeleton, same disclosure rule and same honest
              clock as the chief drawer's in-flight row. What differs per
              surface is the skin and what the panel discloses: here it is
              the running step (which step, on which machine), which is the
              only thing this surface knows that the timeline does not
              already show. No panel data = no panel, and then no chevron
              either (#634: a shape must carry semantics). */}
          <LiveRow
            variant="detail"
            label={item.label}
            labelVars={item.labelVars}
            startedAt={item.startedAt}
            seconds={item.seconds}
            disclosure={
              liveStep != null ? { expand: '展开实时步骤', collapse: '收起实时步骤' } : null
            }
          >
            {liveStep != null && (
              // #873 活行展开面：同一行文字族的暗色小字，左对齐、无底、无
              // 边框，展开时挂该行下方（不撑行高）。
              <div className="mt-1 flex flex-col gap-0.5 pl-8 text-meta text-(--text-tertiary)">
                <span className="[overflow-wrap:anywhere]">
                  {t('本步：{n}', { n: liveStep.step })}
                </span>
                {liveStep.machine != null && (
                  <span className="[overflow-wrap:anywhere]">
                    {t('执行机器：{n}', { n: liveStep.machine })}
                  </span>
                )}
                {/* #918：本步技能事实（activity 事件随行，mapper 已按在跑步
                    stepId 过滤）——每条一行 `▶ skill: <名>`；被 deny 挡下的
                    同线可见（`✕ …（已挡下）`），与「看不见」可区分。 */}
                {(item.skills ?? []).map((s) => (
                  <span
                    key={`${s.name}:${s.denied ? 'x' : 'r'}`}
                    className="[overflow-wrap:anywhere]"
                    data-testid="skill-line"
                  >
                    {s.denied
                      ? t('✕ skill: {n}（已挡下）', { n: s.name })
                      : t('▶ skill: {n}', { n: s.name })}
                  </span>
                ))}
                {/* #905：「在动 vs 卡住」判据——最近活动信号的走表新鲜度；
                    无信号（fixture / 旧 server / 静默期）整行缺席不摆死数。 */}
                <LiveSignal at={item.signalAt} className="[overflow-wrap:anywhere]" />
              </div>
            )}
          </LiveRow>
        </div>
      );
    case 'plan':
      return (
        <>
          <div className="chat-plan mt-3.5 flex items-center pl-8 text-meta text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
            <FileTab width={14} height={14} />
            <span className="chat-plan-title ml-1.5">{item.title}</span>
            {onOpenPlan != null ? (
              // XMON-24 打开方案钮 shadcn ghost 底座不变；#945 皮肤迁
              // utilities（透明底 + tertiary 墨 + 七通道中和）。字号/行高还原
              // 裸钮 preflight 的 font:inherit，svg 免底座强制 16（属性
              // 12px）。span 态不在此列。
              <Button
                variant="ghost"
                className="ml-auto mr-1.5 flex h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-[length:inherit] leading-[inherit] font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                aria-label={t('打开方案')}
                onClick={onOpenPlan}
              >
                <ExternalLink width={12} height={12} />
              </Button>
            ) : (
              <span className="ml-auto mr-1.5 flex">
                <ExternalLink width={12} height={12} />
              </span>
            )}
          </div>
          {/* r7 26/27：preview 行距 20（12px/20），首行距 plan 标题行 8px；
              两行截断走 max-height（line-clamp 在 headless 上算成 flow-root
              零高，不可用）；flex-none 防溢出行压扁本项。 */}
          <div className="chat-preview mt-2 max-h-10 flex-none overflow-hidden pl-8 pr-6 text-meta leading-5 text-(--text-tertiary) [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
            {item.preview}
          </div>
          <ActionRow
            seconds={item.seconds}
            bare={item.seconds == null}
            copy={`${item.title}\n${item.preview}`}
            t={t}
          />
        </>
      );
    case 'tools':
      return <ToolsRow item={item} t={t} />;
    case 'skills':
      // #918 技能事实汇总行（详情页的持久一份）：活行披露面的 activity 事实
      // 是瞬态（步终态即清），本行从落库 toolcall 行派生、随消息重取常在。
      // note 行同视觉族（居中 tertiary 小字），独立 testid 供探针定位。
      return (
        <div
          className="chat-note mx-auto mt-5 flex max-w-[68ch] flex-wrap items-baseline justify-center gap-x-1.5 text-center text-meta text-(--text-tertiary)"
          data-testid="skills-summary"
        >
          {item.read.length > 0 && <span>{t('技能：{n}', { n: item.read.join(', ') })}</span>}
          {item.read.length > 0 && item.denied.length > 0 && <span aria-hidden="true">·</span>}
          {item.denied.length > 0 && <span>{t('挡下：{n}', { n: item.denied.join(', ') })}</span>}
        </div>
      );
    case 'elapsed':
      return <ActionRow seconds={item.seconds} t={t} />;
    case 'review':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            {/* 结论先行（r8 §3.1 60）：单段总结 — paragraph chip "审核结论"
                + 文本。#700：extractionError 在位 = daemon verdict 提取失败
                —— chip 换「判定提取失败」（danger 色，与 blocking finding
                同色系），正文 = daemon 原因；与「审核未返回结论」兜底（旧
                daemon 无信号）在审核面上一眼可分辨——提取器失败不是审核
                没结论。 */}
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-[4px] bg-(--chip-plan-bg) px-1.5 py-px text-caption leading-[1.5] font-semibold text-(--chip-plan-fg)${
                  item.extractionError !== undefined
                    ? ' chat-review-tag--error bg-(--danger-soft) text-destructive'
                    : ''
                }`}
              >
                {t(item.extractionError !== undefined ? '判定提取失败' : '审核结论')}
              </span>
              <Segments
                segments={inlineSegments(item.extractionError ?? item.conclusion)}
                codeClassName="chat-code"
              />
            </p>
            {/* 编号 findings（r8 §3.1 60/61）：每条 = 严重度后缀 + 标题 +
                描述 + 引用位（文件:行）+ 可选建议。沿用悬挂序号样式（与
                既有 finding fixture 同族）；严重度染左侧 3px 缝颜色（老
                修饰类规则的 data-* 无关迁移；chat-para--num 等零引用别名
                已随 #1036 终摘，chat-review-finding 族 = verify 驱动脚本
                定位别名原位保留）。 */}
            {item.findings.map((f) => (
              <div
                key={f.id}
                className={`chat-review-finding chat-review-finding--${f.severity} mt-1 mb-2 border-l-[3px] pl-2.5 ${
                  f.severity === 'blocking'
                    ? '[border-left-color:var(--destructive)]'
                    : f.severity === 'suggestion'
                      ? '[border-left-color:var(--badge-attention)]'
                      : '[border-left-color:var(--border)]'
                }`}
              >
                <p
                  className={`${PARA} relative pl-5`}
                  data-ordinal={Number.parseInt(f.id, 10) || 0}
                >
                  <span className="absolute left-0">{f.id}.</span>
                  <span
                    className={`ml-1.5 inline-block text-caption font-semibold ${
                      f.severity === 'blocking'
                        ? 'text-destructive'
                        : f.severity === 'suggestion'
                          ? 'text-(--badge-attention)'
                          : 'text-(--text-secondary)'
                    }`}
                  >
                    {t(`(${f.severity})` as '(blocking)' | '(suggestion)' | '(info)')}
                  </span>
                  <Segments segments={inlineSegments(f.summary)} codeClassName="chat-code" />
                </p>
                {f.description !== undefined && f.description !== '' && (
                  <p className={`${PARA} ${PARA_GAP}`}>
                    <Segments segments={inlineSegments(f.description)} codeClassName="chat-code" />
                  </p>
                )}
                {(f.file !== undefined || f.line !== undefined) && (
                  <p
                    className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                  >
                    <Segments
                      segments={inlineSegments(
                        `${f.file ?? ''}${f.line !== undefined ? `:${f.line}` : ''}`,
                      )}
                      codeClassName="chat-code"
                    />
                  </p>
                )}
                {f.suggestion !== undefined && f.suggestion !== '' && (
                  <p
                    className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                  >
                    <Segments
                      segments={inlineSegments(t('建议：{body}', { body: f.suggestion }))}
                      codeClassName="chat-code"
                    />
                  </p>
                )}
              </div>
            ))}
          </span>
          <ActionRow copy={reviewCopyText(item)} t={t} />
        </div>
      );
    case 'verify':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span
            className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
            data-testid="agent-text"
          >
            {/* 结论先行（review verdict 同族）：chip = pass/fail 徽标（pass 绿
                / fail 红）或「判定提取失败」（extractionError 在位，review 同
                律）。passed=false 是有效结论——fail 徽标不是错误态。 */}
            <p className={`${PARA} mb-1.5 flex items-baseline gap-2`}>
              <span
                className={`chat-review-tag flex-shrink-0 rounded-[4px] px-1.5 py-px text-caption leading-[1.5] font-semibold ${
                  item.extractionError !== undefined
                    ? 'bg-(--danger-soft) text-destructive'
                    : item.passed
                      ? 'bg-(--chip-plan-bg) text-(--chip-plan-fg)'
                      : 'bg-(--danger-soft) text-destructive'
                }`}
              >
                {t(
                  item.extractionError !== undefined
                    ? '判定提取失败'
                    : item.passed
                      ? '验证通过'
                      : '验证未通过',
                )}
              </span>
              <Segments
                segments={inlineSegments(item.extractionError ?? item.conclusion)}
                codeClassName="chat-code"
              />
            </p>
            {/* 证据条目（#1250）：path 等宽块 + 可选注记——证据的可点入仓路径
                是验证面的核心交付，读 verdict 即知证据落哪。 */}
            {item.evidence.map((e) => (
              <p
                key={e.path}
                className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-4 text-meta [background-clip:content-box] text-(--text-secondary)`}
                data-testid="verify-evidence"
              >
                <Segments
                  segments={inlineSegments(e.note !== undefined ? `${e.path} — ${e.note}` : e.path)}
                  codeClassName="chat-code"
                />
              </p>
            ))}
          </span>
          <ActionRow copy={verifyCopyText(item)} t={t} />
        </div>
      );
  }
}

/** Failed-run row (r8 54/73): orange title + guidance + the raw-error
 *  affordance. #1258 接线裁决——捕获形的链接行是两个无语义 span（#634：形
 *  不带义即 bug），本票拆成两半各归其位：
 *  - 查看原始错误 = 真按钮，开 dialog 族常规面（DialogShell），正文 = 行
 *    title 全文。title 就是终态错误文本的唯一载体（build.errorMessage，全仓
 *    无 rawError 字段，daemon 侧封顶 2000 字）——行内已渲染全文，弹窗给长文
 *    一个独占可读面（#193 封顶滚动，等宽 pre-wrap 保换行）。行本身由 mapper
 *    闸（errorMessage 非空 + phase failed）才产出，按钮结构性不存在「无内容」
 *    态；title 剥转义后为空的脏行，链接行整行不渲染（无内容 = 不渲染，不是
 *    置灰死形）。
 *  - 排查指南 = 不渲染：仓内无「构建失败排查」文档节（docs/ = 工程规范/调研/
 *    验证证据，非用户文档），无文档站可链（#136「查看文档」wontfix 同律）；
 *    死链是本票要修的 bug，不是要保留的形——links 字段随 #884 律整个出账
 *    （records.ts 注同源）。 */
function FailRow({
  item,
  margin,
  t,
  agent,
}: {
  item: Extract<TranscriptItem, { kind: 'fail' }>;
  margin: string;
  t: TFunc;
  agent: { displayName: string; avatarUrl: string | null } | null;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  return (
    <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
      <AgentRowAvatar agent={agent} />
      <span
        className="chat-text -mt-px ml-3 max-w-[68ch] min-w-0 text-card-title leading-[1.6] break-words text-(--foreground)"
        data-testid="agent-text"
      >
        <p className={`${PARA} chat-para--fail text-(--fail-fg)`}>{item.title}</p>
        <p className={`${PARA} ${PARA_GAP} text-(--text-tertiary)`}>{t(item.body)}</p>
        {/* 老相邻律：links 行同为 .chat-para 兄弟，7px 行距压过自身
            margin:0（(0,2,0) > (0,1,0)），迁移显式带上。 */}
        {item.title !== '' && (
          <p className={`${PARA} ${PARA_GAP} flex gap-3 text-meta text-(--text-tertiary)`}>
            {/* XMON-24 收起钮同族配方（ghost 底座 + #945 皮肤中和）：透明底、
                tertiary 墨、h-auto/p-0 钉回 span 行盒——链接行几何不漂。 */}
            <Button
              variant="ghost"
              className="h-auto cursor-pointer justify-start rounded-none border-none bg-transparent p-0 text-meta font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0"
              onClick={() => setRawOpen(true)}
            >
              {t('查看原始错误')}
            </Button>
          </p>
        )}
      </span>
      <ActionRow copy={[item.title, item.body].join('\n')} t={t} />
      {/* 原始错误全文弹窗：dialog 族常规面（#68 三路关闭、#389 焦点回陷触发
          钮、#193 封顶滚动）；正文 = tool-output 同款 mono 块，无自身 max-h
          ——长文由 dialog 体滚动承载。 */}
      <DialogShell title={t('原始错误')} open={rawOpen} onClose={() => setRawOpen(false)} size="l">
        <pre
          className="m-0 rounded-[3px] border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-caption break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
          data-testid="fail-raw-error"
        >
          {item.title}
        </pre>
      </DialogShell>
    </div>
  );
}

/** #634 follow-up copy payloads — the row's human-readable content, the
 *  reference footer copy's measured law (robot row copies the message
 *  markdown verbatim). */
function robotCopyText(item: Extract<TranscriptItem, { kind: 'robot' }>): string {
  if (item.markdown != null) return item.markdown;
  return (item.paragraphs ?? [])
    .map((raw) => (Array.isArray(raw) ? raw : raw.segments).map((seg) => seg.text).join(''))
    .join('\n\n');
}

function reviewCopyText(item: Extract<TranscriptItem, { kind: 'review' }>): string {
  return [
    item.extractionError ?? item.conclusion,
    ...item.findings.map((f) => `${f.id}. (${f.severity}) ${f.summary}`),
  ].join('\n');
}

function verifyCopyText(item: Extract<TranscriptItem, { kind: 'verify' }>): string {
  return [
    item.extractionError ?? `${item.passed ? 'PASS' : 'FAIL'} ${item.conclusion}`,
    ...item.evidence.map((e) => (e.note !== undefined ? `${e.path} — ${e.note}` : e.path)),
  ].join('\n');
}

function toolsCopyText(item: Extract<TranscriptItem, { kind: 'tools' }>): string {
  return item.pills
    .map((pill, i) => {
      const output = item.outputs?.[i];
      return output != null && output !== '' ? `${pill}\n${output}` : pill;
    })
    .join('\n');
}

/** Tool-call group (r7 27 collapsed `完成 Ns ▸` / 28 pills + 收起): the
 *  expansion is pure client state (#306 接真) — the fixture/live mapper
 *  freezes the arrival state, the collapsed footer row expands, the 收起
 *  link collapses. Row state rides the row instance (index-keyed like the
 *  rest of the transcript; live appends land after the group).
 *  #933: the collapsed row used to be a zero-context bare pill — the footer
 *  now names the group (工具过程 + terminal glyph, the #615 过程 word family)
 *  and the copy affordance rides the expanded state only, where the text it
 *  copies is actually on screen. */
function ToolsRow({ item, t }: { item: Extract<TranscriptItem, { kind: 'tools' }>; t: TFunc }) {
  const [expanded, setExpanded] = useState(item.expanded);
  return (
    <>
      <ActionRow
        seconds={item.seconds}
        copy={expanded ? toolsCopyText(item) : undefined}
        label={t('工具过程')}
        t={t}
        toggle={{ expanded, onToggle: () => setExpanded((v) => !v) }}
      />
      {expanded && (
        <>
          {/* r7 28：完成 Ns ▾ 头下的满宽 pill 列（组间 8px）。 */}
          <div className="mt-3 flex flex-col gap-2 pl-8 pr-1">
            {item.pills.map((pill, i) => {
              // #469: the call's stdout/stderr rides index-aligned in
              // `outputs`; render it as its own left-aligned mono block
              // under the pill instead of flattening into `.chat-note`.
              const output = item.outputs?.[i];
              return (
                <div key={`${i}-${pill}`} className="flex min-w-0 flex-col gap-1">
                  <div
                    className="chat-tool-pill flex h-5 items-center gap-2 overflow-hidden rounded-[3px] border border-(--border) bg-(--secondary) pl-2.5 font-mono text-caption whitespace-nowrap text-(--text-secondary) [&_svg]:flex-none"
                    data-testid="tool-pill"
                  >
                    <Terminal width={12} height={12} />
                    <span className="truncate">{pill}</span>
                  </div>
                  {output != null && output !== '' && (
                    // 工具 stdout/stderr 独立块（#469）：左对齐 mono 正常
                    // 对比度——.chat-code 的终端内容孪生；pre-wrap 保留换行
                    // 不横滚，240px 封顶内滚。
                    <pre
                      className="m-0 max-h-60 overflow-auto rounded-[3px] border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-caption break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
                      data-testid="tool-output"
                    >
                      {output}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
          {/* XMON-24 收起钮 shadcn ghost 底座不变；#945 皮肤迁 utilities
              （透明底 + tertiary 墨 + 七通道中和；svg 16px 强制豁免——
              属性 10px）。chevron 翻 180° 走 TW v4 rotate 属性载体
              （#943 抬升卡判例：computed 载体是独立 rotate 属性）。 */}
          <Button
            variant="ghost"
            className="chat-collapse mt-3.5 ml-8 flex h-auto cursor-pointer items-center gap-0.5 justify-start rounded-none border-none bg-transparent p-0 text-meta font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
            onClick={() => setExpanded(false)}
          >
            {t('收起')}
            <ChevronDown width={10} height={10} className="rotate-180" />
          </Button>
        </>
      )}
    </>
  );
}

export function Transcript({
  transcript,
  agent = null,
  onOpenPlan,
  liveStep = null,
}: TranscriptProps) {
  const { t } = useI18n();
  return (
    <>
      {transcript.map((item, i) => {
        // #1009 A2：行骨架翻 MessageScrollerItem——live 面 messageId = 源
        // message id（原语锚面），fixture 捕获形与合成行无 id → 无锚、key
        // 回落 index。fixture order is stable。
        const id = 'id' in item ? item.id : undefined;
        return (
          <MessageScrollerItem key={id ?? i} messageId={id} style={SCROLLER_ITEM_STYLE}>
            <Row
              item={item}
              prev={transcript[i - 1]}
              t={t}
              onOpenPlan={onOpenPlan}
              agent={agent}
              liveStep={liveStep}
            />
          </MessageScrollerItem>
        );
      })}
    </>
  );
}
