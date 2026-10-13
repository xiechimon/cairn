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

import { useEffect, useRef, useState } from 'react';
import { activityLabel } from '../api/activity.js';
import { clockTimeHms, inlineSegments } from '../api/mappers.js';
import { ThinkingRow } from '../components/chat/agent-rows.js';
import { LiveRow, LiveSignal } from '../components/chat/live-row.js';
import { Button } from '../components/ui/button.js';
import { CopyButton } from '../components/ui/copy-button.js';
import { MessageScrollerItem } from '../components/ui/message-scroller.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { RobotPara, TranscriptItem } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  FileTab,
  Puzzle,
  Terminal,
} from '../icons/index.js';
import { ChatMarkdown } from './chat-markdown.js';
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
      return endsWithAgentRow(prev) ? 'mt-[14px]' : 'mt-[21px]';
    case 'chief':
      return 'mt-1';
    case 'user':
      return 'mt-[18px]';
    default:
      return '';
  }
}

/** `.chat-para + .chat-para`（r7 38：多段机器人消息行距 27 = 20 + 7）的
 *  渲染序等价形——段列表/finding 容器内非首段挂 7px。 */
const PARA = 'chat-para m-0';
const PARA_GAP = 'mt-[7px]';

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
  clock,
  insetCls = 'pl-[31px]',
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
  /** 2026-10-13 dsh MessageIconActions clock='end' 位：答复行的消息时刻，
   *  渲染在动作簇尾段之后（tertiary 12px tabular）。缺省不摆。 */
  clock?: string;
  /** 左衬档：行级上下文（plan/tools/elapsed，自列左缘起算）= 31px 默认；
   *  列包裹上下文（robot/review/fail 的正文列内）= 11px（包裹已坐在头像
   *  右缘，31px 会双计头像宽）。 */
  insetCls?: string;
}) {
  const tail = (
    <>
      {label != null && (
        <span className="inline-flex items-center gap-2 text-xs leading-4 whitespace-nowrap text-(--text-secondary)">
          <Terminal width={12} height={12} />
          {label}
        </span>
      )}
      {(seconds != null || bare === true) && (
        <span className="border-l border-(--input) pl-[9px] text-xs leading-4 whitespace-nowrap text-(--text-tertiary)">
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
      className={`chat-row-icons mt-5 flex items-center gap-3.5 ${insetCls} text-(--text-tertiary)`}
      data-testid="msg-actions"
    >
      {copy != null && (
        // 2026-10-13 复制钮单源化（用户 review 钉：复制钮全家不一致）：
        // CopyButton（components/ui/copy-button）= 唯一行为源——28px 盒 /
        // 15px 字形 / 复制→对勾 1s 换回 / hover 淡底。可见性 = 新近律
        // （motion.css .chat-copy 规则随行）。秒数/完成尾段是信息不是操作，
        // 不参与隐现。
        <CopyButton text={copy} />
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
      {/* dsh clock='end' 位（2026-10-13）：答复时刻在动作簇尾段之后
          （信息不是操作，不参与新近律隐现）。 */}
      {clock != null && (
        <span className="ml-2 text-[12px] leading-4 whitespace-nowrap tabular-nums">{clock}</span>
      )}
    </div>
  );
}

/** 2026-10-12 dsh 用户行解剖（MessageItem UserStyleBubble + MessageIconActions
 *  源码实测）：气泡下贴右缘的动作行——时钟（tertiary 13px，clock='start'
 *  位 = 钟在图标前）+ 复制图标钮（28px 盒 / 15px 字形 / rounded-md hover
 *  底）。可见性 = 新近律（motion.css .chat-copy 规则：只有最新一条带动作
 *  行的回合静置露出，更早的 hover/focus 浮现，触屏恒显）。时钟缺省
 *  （fixture 捕获形 / 发送乐观回声）= 不摆假时刻。 */
function UserActions({ copy, clock }: { copy: string; clock?: string }) {
  return (
    <div
      className="chat-row-icons mt-1.5 flex items-center justify-end gap-2 text-(--text-tertiary)"
      data-testid="msg-actions"
    >
      {clock != null && (
        // 时钟面与答复行同一副（dsh MessageIconActions 时刻 = 12px tertiary
        // tabular）：用户行/答复行/方案卡/失败面全站一张时刻脸。
        <span className="text-[12px] leading-4 whitespace-nowrap tabular-nums">{clock}</span>
      )}
      {/* 2026-10-13 复制钮单源化：CopyButton（components/ui/copy-button）=
          唯一行为源；新近律随行（.chat-copy 类随件挂）。 */}
      <CopyButton text={copy} />
    </div>
  );
}

/** 2026-10-13 dsh 回合过程折叠（TurnProcessNodeView 源码实测值）：落定回合
 *  的过程行（thinking/tools 连段，mapper 收成 process 组）折叠成单行
 *  「过程 · 完成 Ns」——全宽行、0.5px 底缝（dsh root 的 border-b l2）、
 *  tertiary 墨 hover 升 secondary、chevron 14px 展开转 180°/100ms、秒数走
 *  tabular-nums。在飞回合（item.live）不挂折叠行、过程区铺开；落定一刻
 *  （live→false）折叠行出现、过程区 160ms 收拢滑行（grid-rows 1fr→0fr，
 *  motion.css .process-region）——dsh 的「header 出现与 body 关闭同一拍」。
 *  部件保持挂载（折叠只裁视觉：组内工具组/思考行的展开态不随折叠丢）。 */
function ProcessGroup({
  item,
  prev,
  t,
  agent,
  liveStep,
  onOpenPlan,
}: {
  item: Extract<TranscriptItem, { kind: 'process' }>;
  prev: TranscriptItem | undefined;
  t: TFunc;
  agent: { displayName: string; avatarUrl: string | null } | null;
  liveStep: LiveStep | null;
  onOpenPlan?: () => void;
}) {
  // 落定收拢：live→false 翻转一刻闭合（滑行由 region 承担）。页面加载即落定
  // 的组初始 open=false——装载不播动画。wasLive = 「本组曾在飞过」——折叠行
  // 的长入动画只在落定一刻播（dsh fold clock 律），装载即落定的组不播。
  const [open, setOpen] = useState(item.live);
  const wasLive = useRef(item.live);
  useEffect(() => {
    if (item.live) wasLive.current = true;
    else setOpen(false);
  }, [item.live]);
  const parts = item.parts.map((part, j) => (
    <Row
      key={('id' in part && part.id) || j}
      item={part}
      prev={j === 0 ? prev : item.parts[j - 1]}
      t={t}
      agent={agent}
      liveStep={liveStep}
      onOpenPlan={onOpenPlan}
    />
  ));
  return (
    <div>
      {!item.live && (
        // 折叠行的横缝（0.5px border-b）= dsh TurnProcessNodeView 的全宽
        // 底缝；文字起点压内容列（pl-[31px]，与 avatar 列对齐——用户实测
        // 「排版不协调」即本行裸压左缘与内容列错位）。
        <div className="border-b-[0.5px] border-(--border)">
          <button
            type="button"
            className={`flex h-[33px] w-full cursor-pointer items-center border-none bg-transparent pb-2 pl-[31px] text-left text-[13px] leading-6 text-(--text-tertiary) transition-colors duration-100 hover:text-(--text-secondary)${
              wasLive.current ? ' process-fold-row--enter' : ''
            }`}
            aria-expanded={open}
            data-testid="process-fold"
            onClick={() => setOpen((v) => !v)}
          >
            <span className="min-w-0 truncate tabular-nums">
              {t('过程 · {n}', { n: formatElapsed(item.seconds, t) })}
            </span>
            <ChevronDown
              width={14}
              height={14}
              className={`ml-1 flex-none transition-transform duration-100 ease-(--ease-standard)${
                open ? ' rotate-180' : ''
              }`}
            />
          </button>
        </div>
      )}
      <div className="process-region" data-open={open || undefined}>
        <div className="process-region-inner">{parts}</div>
      </div>
    </div>
  );
}

function Para({ para, gap = false }: { para: RobotPara; gap?: boolean }) {
  // #945：AI-review 引用块（r8 65）= 4px 左缝 + 15px 内距 + tint 带
  // background-clip 到 content box（缝留透明）；悬挂序号 = relative +
  // 19px 左内距 + 绝对序号位。
  const quoteSkin =
    'border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-[15px] [background-clip:content-box] text-(--text-secondary)';
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
        className={`${PARA} relative pl-[19px]${gap ? ` ${PARA_GAP}` : ''}`}
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
}: {
  agent: { displayName: string; avatarUrl: string | null } | null;
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
        <div className="flex-none text-center text-xs leading-4 text-(--text-tertiary)">
          {item.at != null && <div>{item.at}</div>}
          {item.machine != null && (
            <div className="mt-1 text-[11px] leading-3 text-(--text-tertiary) [&_span]:underline">
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
            <div className="chat-stamp-cancelled mt-1 text-[11px] leading-3 text-(--fail-fg)">
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
          className="chat-note mx-auto mt-5 max-w-[68ch] text-center text-xs leading-4 text-(--text-tertiary)"
          data-testid="transcript-note"
        >
          {t(item.text)}
        </div>
      );
    case 'scheduled':
      return (
        <div className="chat-scheduled mt-3.5 flex items-center gap-1.5 text-xs leading-4 text-(--text-tertiary)">
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
          className="chat-note mx-auto mt-3.5 flex max-w-[68ch] flex-wrap items-baseline justify-center gap-x-1.5 text-center text-xs leading-4 text-(--text-tertiary)"
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
          <span className="ml-[11px] text-xs leading-4 text-(--text-tertiary)">
            {t('由总管发起')}
          </span>
        </div>
      );
    case 'user':
      // 2026-10-12 dsh 用户行解剖（MessageItem.module.css 源码实测）：用户话
      // = 贴右缘的列（userRow: flex column items-end），无头像——自己的话不
      // 需要自报身份（agent 头像保留：多 agent 会话里它是身份载体，dsh 单
      //  agent 会话才不挂）。气泡几何 = dsh 42px 药丸律（dsh 14px/22px + py
      //  10px；本面字阶 15px/24px + py 9px，同落 42px），宽上限 = 列宽 70%
      // （dsh userStack 的 0.702 列宽比）与 68ch 阅读上限取窄。动作行 =
      //  UserActions（时钟 + 复制）贴右。DOM 序 = 气泡行 / taskline / 动作
      //  行，动作行收尾（turn 边界探针钉 Item 末节点 = msg-actions）。
      return (
        <>
          <div className={`${margin} flex justify-end`} data-row="user">
            {/* #612：真实用户话语带 markdown 槽（live mapper 设置；robot 行
                #469 同款渲染期解析）——围栏/列表/标题不再按字面裸排。纯文本
                槽 = fixture 捕获形，DOM 与几何保持不变。气泡 = 卡族
                rounded-2xl（18px），与 composer 输入卡同材质。 */}
            <span
              className={`chat-bubble min-w-0 max-w-[min(70%,68ch)] rounded-2xl bg-(--secondary) px-4 py-[9px] text-[15px] leading-6 break-words text-(--foreground) ${
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
              <span className="flex h-[18px] flex-none items-center rounded-[4px] bg-(--muted) px-[7px] text-[11px] leading-4 text-(--text-secondary)">
                #{item.seq}
              </span>
              <span className="ml-[5px] min-w-0 break-words text-[15px] leading-5 font-semibold text-(--foreground)">
                {item.title}
              </span>
            </div>
          )}
          {/* #634 follow-up: the user row's copy is real too — the bubble's
              own text (the reference copies its todo markdown link here;
              our share surface for that is the 更多 menu's 复制链接). */}
          <UserActions copy={item.markdown ?? item.text} clock={item.clock} />
        </>
      );
    case 'robot':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          {/* 2026-10-13 动作行归位（dsh MessageIconActions 律 = 内容**下方**）：
              正文与动作行收进列包裹——此前 ActionRow 是 ROW_BASE 的 flex
              兄弟件，横排在正文右侧（时钟骑首行旁）。包裹列 flex-1 min-w-0
              吃剩余宽；正文 span 的 68ch 上限与 -mt-px 原样。 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="chat-text -mt-px ml-[11px] max-w-[68ch] min-w-0 text-[15px] leading-[1.6] break-words text-(--foreground)"
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
            {/* 2026-10-13 答复行动作行普惠（用户 review 钉：「对方没有」=
                动作行此前只挂带 footer 的行）：每条落库答复行都带 复制 +
                尾部时钟（dsh MessageIconActions 每条 assistant 消息同款）。
                例外 = 在飞打字行（无 id 无 footer）：dsh 的动作尾也在落定才
                出现——流式中途不摆半成品动作。左衬 11px = 正文同列（包裹列
                已坐在头像右缘，31px 的行级衬在此会双计）。 */}
            {(item.footer != null || item.id != null) && (
              <ActionRow
                seconds={item.footer?.seconds}
                copy={robotCopyText(item)}
                t={t}
                clock={item.clock}
                insetCls="pl-[11px]"
              />
            )}
          </div>
        </div>
      );
    case 'thinking':
      // #1034 同源缺陷：本行曾只挂死类名（chat-row / chat-text 零规则）——
      // 既无 flex 也无宽度上限，20px 头像槽（-mt-1 骑顶设计）直接压在文字上。
      // 对齐 robot 行工具类（:419）：ROW_BASE 供 flex 骨架，chat-text 挂
      // ml-[11px] 头文间距 + max-w-[68ch] min-w-0 宽度上限——上限是行内
      // ThinkingRow 截断律（#772）能生效的前提。
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <span className="chat-text -mt-px ml-[11px] max-w-[68ch] min-w-0 text-[15px] leading-[1.6] break-words text-(--foreground)">
            <ThinkingRow text={item.text} />
          </span>
        </div>
      );
    case 'fail':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="chat-text -mt-px ml-[11px] max-w-[68ch] min-w-0 text-[15px] leading-[1.6] break-words text-(--foreground)"
              data-testid="agent-text"
            >
              <p className={`${PARA} chat-para--fail text-(--fail-fg)`}>{item.title}</p>
              <p className={`${PARA} ${PARA_GAP} text-(--text-tertiary)`}>{item.body}</p>
              {/* 老相邻律：links 行同为 .chat-para 兄弟，7px 行距压过自身
                  margin:0（(0,2,0) > (0,1,0)），迁移显式带上。 */}
              <p
                className={`${PARA} ${PARA_GAP} flex gap-3 text-xs leading-[15px] text-(--text-tertiary)`}
              >
                {item.links.map((link) => (
                  <span key={link}>{link}</span>
                ))}
              </p>
            </span>
            <ActionRow
              copy={[item.title, item.body, ...item.links].join('\n')}
              t={t}
              clock={item.clock}
              insetCls="pl-[11px]"
            />
          </div>
        </div>
      );
    case 'streaming':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
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
            lastSignalAt={item.lastSignalAt}
            disclosure={
              liveStep != null ? { expand: '展开实时步骤', collapse: '收起实时步骤' } : null
            }
            // 2026-10-13 用户 review 钉「准备中也不知道准备个啥，要一条一条
            // 看见（跟 dsh 思考行一样）」：相位时间线默认可见、随到随显，
            // 不再藏在披露点击后面（仍可手动收起）。
            defaultExpanded
          >
            {liveStep != null && (
              // #873 活行展开面：同一行文字族的暗色小字，左对齐、无底、无
              // 边框，展开时挂该行下方（不撑行高）。
              <div className="mt-1 flex flex-col gap-0.5 pl-[31px] text-xs leading-4 text-(--text-tertiary)">
                <span className="[overflow-wrap:anywhere]">
                  {t('本步：{n}', { n: liveStep.step })}
                </span>
                {/* 2026-10-13 发送黑盒拆除：过程时间线——本步相位迁移逐行
                    （HH:mm:ss 相位名），「只有最新标签」的黑盒拆成可见过程；
                    冻结在长相位时最后一行就是它已停留的起点。无历史不渲染。 */}
                {(item.phases ?? []).map((p, i) => {
                  const phaseLabel = activityLabel(p);
                  return (
                    <span
                      key={`${p.at}:${i}`}
                      className="[overflow-wrap:anywhere]"
                      data-testid="live-phase-line"
                    >
                      {clockTimeHms(p.at)} {t(phaseLabel.label, phaseLabel.vars)}
                    </span>
                  );
                })}
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
          <div className="chat-plan mt-3.5 flex items-center pl-[31px] text-xs leading-4 text-(--text-secondary) [&_svg]:text-(--text-tertiary)">
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
          <div className="chat-preview mt-2 max-h-10 flex-none overflow-hidden pl-[31px] pr-[22px] text-xs leading-5 text-(--text-tertiary)">
            {item.preview}
          </div>
          <ActionRow
            seconds={item.seconds}
            bare={item.seconds == null}
            copy={`${item.title}\n${item.preview}`}
            t={t}
            clock={item.clock}
          />
        </>
      );
    case 'tools':
      return <ToolsRow item={item} t={t} />;
    case 'process':
      return (
        <ProcessGroup
          item={item}
          prev={prev}
          t={t}
          agent={agent}
          liveStep={liveStep}
          onOpenPlan={onOpenPlan}
        />
      );
    case 'skills':
      // 2026-10-12 dsh ContextInjectionRow 形（用户点名「这种 context 的注入」
      // 排版）：居中灰通知 → 流内左列行——14px 图标 + 标题 + 2px 点隔 +
      // 名单副题（tertiary 13px/24px）。不挂 chevron：名单即全部事实，展开
      // 背后没有更多内容（#634 形必须带义）。#918 持久汇总语义不变（活行
      // 披露面是瞬态，本行随消息重取常在）。
      return (
        <div className="mt-5 flex h-6 items-center" data-testid="skills-summary">
          <Puzzle width={14} height={14} className="flex-none text-(--text-tertiary)" />
          <span className="ml-1.5 flex-none text-[13px] leading-6 text-(--text-secondary)">
            {t('技能注入')}
          </span>
          {item.read.length > 0 && (
            <>
              <span
                aria-hidden="true"
                className="mx-2 size-0.5 flex-none rounded-[1px] bg-(--text-tertiary)"
              />
              <span className="min-w-0 truncate text-[13px] leading-6 text-(--text-tertiary)">
                {item.read.join(', ')}
              </span>
            </>
          )}
          {item.denied.length > 0 && (
            <>
              <span
                aria-hidden="true"
                className="mx-2 size-0.5 flex-none rounded-[1px] bg-(--text-tertiary)"
              />
              <span className="min-w-0 truncate text-[13px] leading-6 text-(--text-tertiary)">
                {t('挡下：{n}', { n: item.denied.join(', ') })}
              </span>
            </>
          )}
        </div>
      );
    case 'elapsed':
      return <ActionRow seconds={item.seconds} t={t} />;
    case 'review':
      return (
        <div className={`${ROW_BASE} chat-row--agent ${margin}`} data-row="agent">
          <AgentRowAvatar agent={agent} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="chat-text -mt-px ml-[11px] max-w-[68ch] min-w-0 text-[15px] leading-[1.6] break-words text-(--foreground)"
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
                  className={`chat-review-tag flex-shrink-0 rounded-[4px] bg-(--chip-plan-bg) px-1.5 py-px text-[11px] leading-[1.5] font-semibold text-(--chip-plan-fg)${
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
                    className={`${PARA} relative pl-[19px]`}
                    data-ordinal={Number.parseInt(f.id, 10) || 0}
                  >
                    <span className="absolute left-0">{f.id}.</span>
                    <span
                      className={`ml-1.5 inline-block text-[11px] font-semibold ${
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
                      <Segments
                        segments={inlineSegments(f.description)}
                        codeClassName="chat-code"
                      />
                    </p>
                  )}
                  {(f.file !== undefined || f.line !== undefined) && (
                    <p
                      className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-[15px] text-xs [background-clip:content-box] text-(--text-secondary)`}
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
                      className={`${PARA} ${PARA_GAP} border-l-4 border-(--border) bg-(--muted) pt-1.5 pr-2 pb-1.5 pl-[15px] text-xs [background-clip:content-box] text-(--text-secondary)`}
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
            <ActionRow copy={reviewCopyText(item)} t={t} clock={item.clock} insetCls="pl-[11px]" />
          </div>
        </div>
      );
  }
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
/** 单次工具调用行（2026-10-12 dsh 对齐，dsh GenericCommandCard 同族）：
 *  每条调用 = 一行 disclosure 位（图标 + mono 名 + 有输出时右侧 chevron），
 *  整行 hover 微染；有输出的行可展开，输出 mono 块缩进挂在行下。
 *  无输出的行不是按钮（不可展开就不渲染 affordance——#634 形必带义）。 */
function ToolCallRow({ name, output }: { name: string; output?: string | null }) {
  const [open, setOpen] = useState(false);
  const hasBody = output != null && output !== '';
  const face =
    'chat-tool-pill flex h-6 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] leading-5 whitespace-nowrap text-(--text-dim) transition-colors duration-(--dur-fast) ease-(--ease-standard)';
  if (!hasBody) {
    return (
      <div className={face} data-testid="tool-pill">
        <Terminal width={12} height={12} className="flex-none" />
        <span className="min-w-0 flex-auto truncate font-[var(--font-mono)]">{name}</span>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <button
        type="button"
        className={`${face} cursor-pointer hover:bg-(--seg-hover)`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="tool-pill"
      >
        <Terminal width={12} height={12} className="flex-none" />
        <span className="min-w-0 flex-auto truncate font-[var(--font-mono)]">{name}</span>
        <ChevronRight
          width={10}
          height={10}
          className={`flex-none transition-transform duration-(--dur-fast) ease-(--ease-standard)${open ? ' rotate-90' : ''}`}
        />
      </button>
      {open && (
        // 输出块缩进 26px = 行内 icon(12) + gap(8) + px-2 的列对齐；
        // 终端内容孪生（#469）：pre-wrap 不横滚，240px 封顶内滚。
        <pre
          className="mt-1 mr-[5px] mb-1 ml-[26px] max-h-60 overflow-auto rounded-md border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-[11px] leading-4 break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
          data-testid="tool-output"
        >
          {output}
        </pre>
      )}
    </div>
  );
}

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
          {/* 2026-10-12 dsh 对齐：展开态的满宽 pill 列换成逐调用 disclosure
              行（ToolCallRow，dsh GenericCommandCard 同族）——图标 + mono 名 +
              整行 hover 微染 + 有输出的行自带 chevron 展开。组间距 4px。 */}
          <div className="mt-[13px] flex flex-col gap-1 pl-[31px] pr-[5px]">
            {item.pills.map((pill, i) => {
              // #469: the call's stdout/stderr rides index-aligned in
              // `outputs`; the row expands to show it instead of flattening
              // into a bare block.
              const output = item.outputs?.[i];
              return <ToolCallRow key={`${i}-${pill}`} name={pill} output={output} />;
            })}
          </div>
          {/* XMON-24 收起钮 shadcn ghost 底座不变；#945 皮肤迁 utilities
              （透明底 + tertiary 墨 + 七通道中和；svg 16px 强制豁免——
              属性 10px）。chevron 翻 180° 走 TW v4 rotate 属性载体
              （#943 抬升卡判例：computed 载体是独立 rotate 属性）。 */}
          <Button
            variant="ghost"
            className="chat-collapse mt-3.5 ml-[31px] flex h-auto cursor-pointer items-center gap-0.5 justify-start rounded-none border-none bg-transparent p-0 text-xs leading-4 font-normal text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent dark:hover:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
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
          <MessageScrollerItem
            key={id ?? i}
            messageId={id}
            className="group"
            style={SCROLLER_ITEM_STYLE}
          >
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
