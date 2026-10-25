// Chief window (issue #72; form re-ruled by ADR 0013, superseding the
// #447/ADR 0004 docked column): the 总管面板 is a Multica-style floating
// window — 380×600 anchored 8px from the content area's bottom-right
// corner, radius 12px, opaque card ground, --floating-shadow, non-modal,
// no scrim. It is an overlay again, not a layout citizen: nothing yields
// (0004 D2/D7/D8 retired), the root layout hosts the single persistent
// instance (chief-root.tsx, D6), and closing minimizes — Base UI
// keepMounted parks the popup in the DOM with the draft, scroll and thread
// state intact: the `hidden` attribute stays (a11y tree / focus removal,
// browser-native) while app.css neutralises its display:none side effect
// into a visibility/opacity park, so the scroll position survives the
// minimize (#1067). Header = thread chip + model row + icon
// buttons (Minimize, no X — D3); body = gate bar (unbound) or hero
// examples / thread message flow; composer pinned at the bottom. The
// switcher popover (116) and the view swap to 总管设置 are real state so
// the surface is clickable in dev; fixture captures never click, so the
// fixture alone decides the captured state.
// 文件名/标识符 chief-drawer 是 ADR 0013 D13 记录的残留（GLOSSARY avoid
// 列），更名随 #1009 A0 施工面统一走，原型阶段不动（e2e/探针载体重钉同批）。
// #615 四连报闭环：模型行由纯显示 span 翻成控制件（button → 主模型覆盖
// dialog，PATCH chief model 槽落库回显）；行首 = 运行时标记（pi 出 RuntimePi
// 块状 π、claude-code 出 RuntimeClaudeCode 品牌星标——正本 = 参考站
// providers 运行时 tab SVG，用户返工裁决：要运行时 SVG 不要 Agent 头像；
// FAB / 消息流的 Agent 头像脸在各自面继续生效）；消息行复制
// glyph 翻真 clipboard 钮（local-first 面存在），恢复/foot 折叠 chevron 无
// 后端面按 #306/#146 二分律移除不渲染；gear 各族可达（非 board 面落 board
// 设置视图深链，根 host 兜底后结构上恒在——chief-root.tsx 的 onSettings
// 路由分派，ADR 0013 D9）。
//
// #732（2026-10-03 用户裁决全开，翻案 #146 隐藏裁决）：composer 行开闸渲染
// 附件 + 提及工具（detail composer 同款交互面——内联 @ 补全 #728、剪贴板图片
// 粘贴 #729、工具条 attach + mention 钮）。#146 的 local-first 无后端面前提
// 已被落地的 grant/upload/read 链与提及 wire  retire——只开交互面，不加新后端
// 面。语音输入维持 wontfix 不渲染（#304 C5，本票不含）。
// #306 wontfix 出账：r8 随拍在线程视图头部多出的「更多」（⋮）钮——原站
// 菜单内容从未点开无正典（r8-chief-panel-adhoc §3），cairn server chief
// 面亦无线程管理 mutation（GET/POST threads 外无删除/重命名端点），无
// local-first 对象面，按 M7 处置二分律移除不渲染；头部三钮双视图同律。
// #645：头部 +（新主题）挂裸键 N（抽屉作用域——overlays/hotkeys 的
// useChiefNewThreadHotkey，enabled 门 = 开态；输入态守卫 = _plain_ 可编辑
// 律，composer 聚焦时 n 归打字员）；钮载 Tooltip+Kbd 的 N 悬浮提示（below 落位）
// + aria-keyshortcuts；键与钮同 handler（触发 + 收切换器 popover）。

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import {
  type AskUserAnswer,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
} from '@cairn/shared';
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useMachines, useMembers, useProjects, useSkills, useTodos } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { FadeScrollerViewport } from '../components/chat/fade-scroller-viewport.js';
import { FOLLOW_THRESHOLD, JumpToLatestButton } from '../components/chat/jump-to-latest.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Kbd } from '../components/ui/kbd.js';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../components/ui/message-scroller.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import type { ChiefContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChiefFolder,
  ChiefGear,
  ChiefHash,
  ChiefUserPlus,
  Grid2x2,
  Minus,
  Paperclip,
  Plus,
  RuntimeClaudeCode,
  RuntimePi,
} from '../icons/index.js';
import { uploadMessageAttachments } from '../overlay/attachment-paste.js';
import { AttachmentStrip } from '../overlay/attachment-strip.js';
import { useComposerWire } from '../overlay/composer-wire.js';
import { type MentionGroups, MentionInline, MentionPicker } from '../overlay/mention-picker.js';
import { SlashHelp, SlashMenu } from '../overlay/slash-menu.js';
import { useChiefNewThreadHotkey } from '../overlays/hotkeys.js';
import { ChiefStreamRow, chiefStreamRowKey } from './chief-message-rows.js';

/** 悬浮窗壳（ADR 0013 D2/D10：几何皮肤整套采 Multica 原值——默认
 *  380×600、距内容区右/下各 8px、圆角 12px、--floating-shadow、不透明卡底
 *  非玻璃、无模态无 scrim；包含块 = 视口（内容区铺满视口右缘，侧栏在左，
 *  「不压侧栏」由角落锚定自然成立）。发丝环走仓内 #139 正典 --edge-ring
 *  （inset shadow spread，分数缩放不断线）与投影合成一条 shadow。z 档 =
 *  --z-floating 新 rung（#688 律：常驻伴随面压 in-flow 内容、让位一切
 *  活动层）。max-w/max-h 夹取 = 视口小于窗时的可用性护栏（非形态分支，
 *  D2「窄窗不做特殊形态」的边界兜底）。圆角走 --radius-window token
 *  （A0 实审裁决 3 提 token；值 = Multica rounded-xl 12px 原值，不消费
 *  #983 退役面的 --radius-popover，ADR 0012 D4 明令）；窗是唯一消费点。
 *  类名 chief-drawer 保留为零规则机制钩子：
 *  overlays/hotkeys.ts 的 ⌘J 守卫走 closest('.chief-drawer')，e2e 以它做
 *  面板 scope 锚（更名随施工面载体重钉批，D13）。 */
const WINDOW_CLS =
  'chief-drawer fixed right-2 bottom-2 z-(--z-floating) flex h-150 max-h-[calc(100dvh-1rem)] w-95 max-w-[calc(100dvw-1rem)] flex-col overflow-hidden rounded-(--radius-window) bg-(--card) shadow-[var(--edge-ring),var(--floating-shadow)]';

/** 进出场腿（ADR 0013 D7：fade + scale 0.95→1、transformOrigin bottom
 *  right——窗从 FAB 角长出；shadcn/Base UI 默认动效家族（dropdown/popover
 *  同款 animate-in/out + fade/zoom-95 词表），零自定义曲线（ADR 0009 收敛
 *  律），时长走 --dur-overlay 200ms（Multica 实测 scale 0.2s 同值）；
 *  0004 D4 的 translateX 滑入退役。reduced-motion 降级走 motion.css 全站
 *  法（tw-animate-css keyframe 含）。
 *  #1266 两件防闪件：① data-closed:fill-mode-forwards——exit keyframe 缺省
 *  fill:none，动画收尾帧一摘除、计算 opacity 即弹回基值 1，而 Base UI 的
 *  hidden 停靠在同一拍才提交；停靠态是 visibility 泊位（#1067，盒子仍在
 *  渲染），这一帧弹回会被真实绘制 = 关窗瞬间整窗复亮再消（用户报的闪）。
 *  forwards 让退场终值（opacity 0 / scale 0.95）驻留到 data-closed 摘除，
 *  弹回无从发生；重开时 data-open 换上 enter keyframe，驻留随类摘除。
 *  ② transition-none——duration-* 工具类在设 --tw-duration（喂 animation
 *  时长）的同时副产 transition-duration，而 transition-property 的浏览器
 *  缺省是 all：本件因此背着一条没人声明过的 transition:all 200ms，正是它
 *  把 ①的弹回放大成 200ms 重绘淡出。本件动效契约 = 纯 keyframe（ADR
 *  0009），显式归零 transition 通道，副产过渡不再有机会参与进出场。 */
const WINDOW_MOTION_CLS =
  'origin-bottom-right duration-(--dur-overlay) transition-none data-closed:fill-mode-forwards data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

/** 头部 icon 钮（旧 .chief-head-actions button 元素选择器等值：20×20 /
 *  零装饰 / tertiary 墨 / 无 hover 反馈——旧 unlayered 规则恒压 ghost 件
 *  配方，迁移后按七通道律显式钉回）。 */
const HEAD_ICON_BTN_CLS =
  "size-5 cursor-pointer justify-center rounded-none border-none bg-transparent p-0 text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

/** composer 工具钮（旧 .chief-tool 几何等值：20×20 / hover 只升墨——底色
 *  hover 是 ghost 件既有行为，旧面未覆写，保留；圆角随件档）。墨槽
 *  dim→tertiary 同 MSG_TOOL_BTN_CLS 注（light 2.73:1 < 3；该常量与注已随
 *  #1126 迁 ./chief-message-rows.js）。 */
const TOOL_BTN_CLS =
  "size-5 cursor-pointer text-(--text-tertiary) hover:text-(--text-secondary) dark:hover:text-(--text-secondary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

const SEND_BTN_CLS =
  'ml-auto cursor-pointer rounded-md border-0 bg-transparent text-(--text-tertiary) hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0';
const SEND_ON_CLS =
  'bg-(--card-button) text-(--text-on-accent) hover:bg-(--card-button) hover:text-(--text-on-accent)';

/** #1009 A1：chat 原语换装的消费点中和配方（五件原语文件保持 pristine——
 *  registry 账本 hash 零触碰，中和全走消费点 className/style）。滚动模型 =
 *  MessageScroller 原生 autoScroll（#873 跟随律的原语实现，阈值 40px（CDS PR-6）、
 *  发送跳最新 scrollToEnd、开窗关武装——Provider 注记见壳层）。
 *  SCROLLER_ITEM_STYLE 随行渲染器迁 ./chief-message-rows.js（#1126）。 */
const SCROLLER_ROOT_CLS = 'h-auto min-h-0 flex-1';
/** Content 的 block + gap-0：行距语义保持在行自身的 margin 上（现状
 *  mt-3.5 / my-2.5 的块级折叠律逐字存活），原语默认 flex gap-6 会双倍行距。 */
const SCROLLER_CONTENT_CLS = 'block gap-0 px-4 pt-3.5';

const EXAMPLE_ICONS = {
  'user-plus': ChiefUserPlus,
  folder: ChiefFolder,
  grid: Grid2x2,
  bars: BarChart3,
} as const;

/** 草稿持久化键（#1056，Multica 对齐面）：composer 草稿跨整页刷新回显——
 *  D6 常驻契约（最小化/路由切换/SPA 导航全保）是内存面的保，整页刷新原本
 *  即丢；Multica 的草稿随键写穿存储（packages/core/chat/store.ts
 *  setInputDraft，onUpdate 每键落盘），同律。单槽纯文本、只保活动线程的
 *  composer 现文（不按线程 id 分键）：本窗会话内草稿就是单槽跨线程切换持
 *  续（wire 态从不随切换换槽），按线程分键会改写这条已验行为；Multica 的
 *  新聊草稿同哲学——身份是「未创建的会话」单槽而非按发送目标分键
 *  （store.ts DRAFT_NEW_SESSION 注，MUL-4864）。空稿删键不留残
 *  （store.ts writeDrafts 的 removeItem 同律）；发送成功清稿即清键，被拒
 *  保留（#631 契约，持久化是加载面不是发送面）。品牌前缀纪律照
 *  cairn.chief-open 先例（use-chief-surface.ts）。fixture 面永不读写
 *  （采集确定性——scenario 的 chief.draft 是捕获形草稿唯一来源）。 */
export const CHIEF_DRAFT_STORAGE_KEY = 'cairn.chief-draft';

function readStoredChiefDraft(): string {
  try {
    return localStorage.getItem(CHIEF_DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return ''; // 隐私模式等 Storage 不可用——回落空稿（chief-open 读面同兜底）
  }
}

interface DrawerProps {
  /** 常驻窗的开态旗（ADR 0013 D6）：关闭 = 最小化——Base UI keepMounted
   *  把窗以 hidden 属性停驻在 DOM，草稿/滚动/线程态全保（#1067：hidden 的
   *  display:none 副作用被 app.css 中和成 visibility 停靠，scrollTop 跨
   *  最小化存活）；退场动画 outlives the minimize（transition-status）。 */
  open?: boolean;
  chief: ChiefContent;
  /** Opens 总管设置: board route = content swap (r5 101–104); 非 board 路由
   *  走 `?chief=settings` 深链导航（#615）——chief-root 单挂载点按路由分派
   *  （D9 设置面承载不变：内容交换，不进悬浮窗）。缺省 = 齿轮不渲染。 */
  onSettings?: () => void;
  /** 最小化（ADR 0013 D3 的唯一收起动作之一，另一个是 ⌘J）：窗退回右下
   *  角 FAB，不是销毁式关闭。 */
  onClose: () => void;
  /** M5 live 面：composer 可写 + 发送回调（POST chief 线程消息，r5 §3.6）；
   * 缺省 = fixture 静态面（readOnly draft，发送钮惰性）。返回 Promise =
   * 异步发送（#631：rejected 时 draft 保留不丢字，detail composer 同契）；
   * 同步 void = 发后即清（原语义）。 */
  onSend?: (text: string) => void | Promise<void>;
  /** 主题切换（live 面 threads popover 行点击）。 */
  onThread?: (title: string, index: number) => void;
  /** 新主题（头部 +，#146）：落回新线程视图，下一次发送开新 chief 线程
   * （threadId null = 新主题，wire 注记见 shared chief send schema）；
   * 缺省 = fixture 静态面，钮惰性。 */
  onNewThread?: () => void;
  /** #615 返工 live 面：恢复钮确认后 = POST chief threads rewind（截断锚后
   *  消息 + 新会话重发）；缺省 = fixture 律（确认层 accept 关窗零请求）。 */
  onRewind?: (messageId: string) => void;
  /** #1049 live 面：问答卡提交回答（POST questions/{requestId}/answer）；
   *  缺省 = 惰性（fixture 律，提交/取消钮 disabled）。 */
  onAnswerQuestion?: (input: { requestId: string; answers: AskUserAnswer[] }) => void;
  /** #1049 live 面：问答卡取消提问（POST questions/{requestId}/cancel）。 */
  onCancelQuestion?: (requestId: string) => void;
}

interface InnerProps extends DrawerProps {
  /** 主题切换器开态（壳层提升：Root onOpenChange 的 Esc 分层代收要读写它，
   *  内容列整体住 Provider 之下——同组件 hook 吃不到自己渲染树的 context）。 */
  threadsOpen: boolean;
  setThreadsOpen: Dispatch<SetStateAction<boolean>>;
}

export function ChiefDrawer(props: DrawerProps) {
  const { open = true, chief } = props;
  const { t } = useI18n();
  const [threadsOpen, setThreadsOpen] = useState(chief.threadsOpen ?? false);
  // #1067 跟随武装位（atBottom）：读者贴最新端才跟随新消息——最小化/离底
  // 阅读期间 autoScroll 关死，重开不抢滚动条（停泊载体保留的位置原样交回）。
  const [atBottom, setAtBottom] = useState(true);
  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      // 外点不关（Multica 同律，0004 现状继承）；Esc **永不关面板**（ADR
      // 0013 D3——#146「分层第二按关抽屉」契约随贴右竖板退役，对 #168
      // dialog 家族关闭律的自觉背离照 #443 先例记 0013 D3），只收面板内层
      // 弹层：主题切换器在此代收，模型 popover 是 Base UI layer 栈自收。
      disablePointerDismissal
      onOpenChange={(next: boolean, details?: { reason?: string }) => {
        if (next) return;
        if (details?.reason === 'escape-key' && threadsOpen) setThreadsOpen(false);
      }}
    >
      {/* D6/D10：Portal 回 body（dock 行发现随让位退役），keepMounted 承载
          「关 = 在 DOM 但 inert」的常驻契约——Base UI 把关态 Popup 以
          hidden 属性停驻（可及树/焦点剔除由属性原生承载），app.css 的
          .chief-drawer[hidden] 规则把 preflight 的 display:none 中和成
          visibility/opacity 停靠（#1067：不塌缩布局盒，滚动位置跨最小化
          保留），草稿/滚动/线程态全保；退场动画仍先播（transition-status），
          播完才落 hidden。「关」的可观测契约 = 在 DOM 但 hidden/inert（D6，
          e2e count-0 断言族按 0012 D6 载体重钉，行为语义不变）。 */}
      <DialogPrimitive.Portal keepMounted>
        <DialogPrimitive.Popup
          // render 令 Popup 即 aside（悬浮窗本体）；fade+scale 进出场落在
          // aside 上，origin bottom-right = 窗从 FAB 角长出（D7）。
          render={<aside className={`${WINDOW_CLS} ${WINDOW_MOTION_CLS}`} aria-label={t('总管')} />}
          initialFocus={false}
          finalFocus={false}
        >
          {/* #1009 A1：MessageScroller Provider 包住整列窗内容——滚动律单源
              从 useChatFollow 换成原语原生 autoScroll，#873 语义逐条保留：
              贴底阈值 40px = FOLLOW_THRESHOLD（scrollEdgeThreshold；CDS PR-6）、
              打开落底 = chat 面通行律（defaultScrollPosition="end"，仅初次
              挂载跑一次）、发送跳最新 = scrollToEnd()（实审裁决 2：不采
              scrollAnchor 逐条锚定）。#1067 起跟随武装位 = 读者贴底
              （autoScroll={open && atBottom}，ChiefFollowArmed 读表）：
              停泊载体让滚动位置跨最小化存活后，「重开钉回最新」不再是
              载体副作用而是 armed 门的行为——贴底时重开/新消息照旧跟随，
              离底阅读位置原样交回。消费点（composer wire 的 onSend 与切
              线程 effect）住内容列 hook 里，必须整体下沉到 Provider 之下
              ——拆分点即此。 */}
          <MessageScrollerProvider
            autoScroll={open && atBottom}
            scrollEdgeThreshold={FOLLOW_THRESHOLD}
            defaultScrollPosition="end"
          >
            <ChiefFollowArmed onAtBottom={setAtBottom} />
            <ChiefDrawerInner
              {...props}
              threadsOpen={threadsOpen}
              setThreadsOpen={setThreadsOpen}
            />
          </MessageScrollerProvider>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * #1067 跟随武装位的读表腿：消费 stateStore（stateFrame 同步面）取「读者
 * 是否贴底」。Provider 与消费者不能同组件（context 拿不到自己渲染树），
 * 故挂在 ChiefDrawer 之下、内容列之上。
 */
function ChiefFollowArmed({ onAtBottom }: { onAtBottom: (atBottom: boolean) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onAtBottom(!scrollable.end);
  }, [scrollable.end, onAtBottom]);
  return null;
}

function ChiefDrawerInner({
  chief,
  open = true,
  onSettings,
  onClose,
  onSend,
  onThread,
  onNewThread,
  onRewind,
  onAnswerQuestion,
  onCancelQuestion,
  threadsOpen,
  setThreadsOpen,
}: InnerProps) {
  const { t } = useI18n();
  // #650 / XMON-105: 用户行头像身份单源（live = /api/user/me；fixture =
  // canon 常量，avatarUrl 覆盖 > dicebear 名字种子 > 静态兜底）。
  const { live, teamId, user } = useLiveData();
  // #732：live 面的提及数据源（todo-detail-page / new-task-surface 同五源
  // 投影 canon；enabled=live，fixture 面查询静默 → 空组 → wire EMPTY_GROUPS
  // → inline 永不开、popover 零计数开面）。
  const todosQ = useTodos(teamId, live);
  const membersQ = useMembers(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const skillsQ = useSkills(teamId, live);
  const machinesQ = useMachines(teamId, live);
  const mentionGroups: MentionGroups = {
    todo: (todosQ.data ?? []).map((td) => ({
      id: td.id,
      label: `#${td.seqNum} ${td.title}`,
      seq: td.seqNum,
      subtitle: td.phase,
    })),
    agent: (membersQ.data ?? [])
      .filter((m) => m.memberType === 'agent')
      .map((m) => ({
        id: m.actorId,
        label: (m.actor as { displayName?: string } | undefined)?.displayName ?? m.actorId,
        subtitle:
          (m.actor as { description?: string | null } | undefined)?.description ?? undefined,
      })),
    project: (projectsQ.data ?? []).map((p) => ({ id: p.id, label: p.name })),
    skill: (skillsQ.data ?? []).map((s) => ({
      id: s.id,
      label: s.name,
      subtitle: s.description ?? undefined,
    })),
    machine: (machinesQ.data ?? []).map((m) => ({ id: m.id, label: m.name })),
  };
  // #732：live 面的附件委托——逐文件 grant + upload 循环 #1127 起收编进
  // overlay/attachment-paste.js 的 uploadMessageAttachments（与详情页
  // composer 同源：失败 toast 点名 + 成功 token 仍落、draft 不动；token
  // 注入由 wire hook 行原子做）。fixture 面无委托 → wire 附件链全惰。
  const onAttachment =
    onSend != null ? (files: File[]) => uploadMessageAttachments(files, t) : undefined;
  // #651 → #1009 A1 滚动模型替换：真滚动容器 = MessageScroller Viewport
  // （data-testid chief-body 载体随迁；overflowY auto 面由原语承载），贴底
  // 跟随/打开落底 = Provider 原生 autoScroll + defaultScrollPosition（壳层
  // 注记）；本层只剩「切线程落底」一条 effect——旧 useChatFollow 的
  // resetDep 语义等价迁移（threadTitle 变 = 换线程 = 落底看最新；标题守卫
  // 防无关重渲触发）。发送跳最新 = scrollToEnd（下方 wire.onSend）。
  // #1009 A2：详情页对话列也已换骑原语，useChatFollow 整件退役（#873 单源律
  // 由 MessageScroller 承接）。
  const { scrollToEnd } = useMessageScroller();
  const prevThreadRef = useRef(chief.threadTitle);
  useEffect(() => {
    if (prevThreadRef.current === chief.threadTitle) return;
    prevThreadRef.current = chief.threadTitle;
    if (open) scrollToEnd();
  }, [chief.threadTitle, open, scrollToEnd]);
  // #615 返工：恢复钮确认层锚（stream 行 index + live 消息 id）与过程折叠开态集。
  const [rewindConfirm, setRewindConfirm] = useState<{ index: number; id: string | null } | null>(
    null,
  );
  const [toolsOpen, setToolsOpen] = useState<Set<number>>(() => new Set());
  // #822→#873 在飞存在行的展开态由共享 LiveRow 自持：typing 行接管那一帧
  // streaming 分支整棵卸载，展开态随之清零（取代 race 不再需要抽屉级护栏）。
  // #615 复制钮的瞬时回执：键 = 消息位（u<i> / r<i>），1.5s 后回 Copy 字形。
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyText = (key: string, text: string) => {
    const clip = navigator.clipboard; // 非安全上下文无 clipboard：静默不回执
    if (!clip) return;
    void clip.writeText(text).then(
      () => {
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
      },
      () => {},
    );
  };
  // #615 返工 foot 折叠的开态翻转（行渲染器 #1126 迁出后的回调入口）。
  const toggleTools = (i: number) =>
    setToolsOpen((cur) => {
      const next = new Set(cur);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  // #1056 草稿持久化：live 面草稿从 wire 内部态提为本层受控态（wire 的
  // controlled mode，todo-detail-page liveDraft 同配方），存储读写骑这份
  // 态——初值 = 存储回显（挂载即恢复，整页刷新不丢稿；持久化开态的加载
  // 不抢焦点律不破，初值不经任何 focus 路径），写回 = 每键写穿（Multica
  // setInputDraft 同律），空稿删键。fixture 面初值恒空 + effect 不跑 =
  // 零读写（采集确定性，static 面的 chief.draft 展示不经这份态）。
  const [liveDraft, setLiveDraft] = useState(() => (live ? readStoredChiefDraft() : ''));
  useEffect(() => {
    if (!live) return;
    try {
      if (liveDraft === '') localStorage.removeItem(CHIEF_DRAFT_STORAGE_KEY);
      else localStorage.setItem(CHIEF_DRAFT_STORAGE_KEY, liveDraft);
    } catch {
      // Storage 不可用（隐私模式）——持久化静默降级，会话内行为不变
      //（chief-open 持久化写面同兜底，use-chief-surface.ts）
    }
  }, [live, liveDraft]);
  // #625：输入逻辑层单源——draft / 发送（异步被拒保留 draft，#631 契约）/
  // 提及 / 附件 wire 住 overlay/composer-wire 的 useComposerWire，detail
  // composer 消费同一 hook；本文件只剩抽屉皮肤（节点、几何、占位双态）。
  // live 面 = 受控态草稿（editable，#1056 持久化上提，见 liveDraft）；
  // fixture 面 = 静态只读回显（static mode，无 setter）。#732（#146 隐藏
  // 裁决翻案）：live 面把数据源两件都传进去——mentionGroups（五源 live
  // 投影；fixture 面查询静默 → 空组）与 onAttachment（逐文件 grant +
  // upload 委托）；fixture 面两件皆缺省 → inline 永不开、picker 零计数、
  // 粘贴/选件链全惰。
  const wire = useComposerWire({
    editable: onSend != null,
    draft: onSend != null ? liveDraft : (chief.draft ?? ''),
    onDraftChange: onSend != null ? setLiveDraft : undefined,
    // #873：读者自己发出去的那条必须看得见——跳最新端与详情面同一规则
    // （A1 起机制 = useMessageScroller().scrollToEnd，语义 = 旧
    // requestFollow 的「读者自己的发送恒赢」律），四个分流出口之外的通用
    // 发送面。
    onSend:
      onSend == null
        ? undefined
        : (text: string) => {
            scrollToEnd();
            return onSend(text);
          },
    onAttachment,
    mentionGroups,
    // #841 `/` slash completion（detail composer #731 同 registry；正本对照
    // detail/composer.tsx `slash:` 块）。抽屉面无 AI 审核 / 停止句柄（工具条本
    // 就没这两钮），reviewAvailable / stopAvailable 双 false → 两条按 rule 47
    // 条件隐藏，菜单只剩 clear / attach / mention / help + 团队技能；`clear`
    // 语义与 detail 同 = 清空输入框（执行反馈走 wire 内 toast）。
    slash: {
      reviewAvailable: false,
      stopAvailable: false,
    },
    // #860: textarea follows the content up to 6 lines (20px), scrolling
    // internally beyond it (the XMON-102 fixed-height law is superseded).
    growCap: 120,
  });
  const {
    handlePaste,
    handleCaretMoved,
    handleCompositionEnd,
    handleBlur,
    fileInputRef,
    openFilePicker,
    attaching,
    pendingAttachments,
    onPickFiles,
    pickerOpen,
    togglePicker,
    closePicker,
    closeInline,
    inlineOpen,
    inlineCaret,
    inlineQuery,
    inlineRows,
    inlineHighlight,
    setInlineHighlight,
    inlineListboxId,
    inlineListboxRef,
    insertToken,
    insertTokens,
    insertFile,
    groups,
    // #841 `/` slash menu state（detail composer 同款解构；复用同一 hook
    // 面，故校验/语义零分叉）。
    slashOpen,
    slashQuery,
    slashCaret,
    slashSections,
    slashHighlight,
    setSlashHighlight,
    slashListboxId,
    slashListboxRef,
    closeSlash,
    acceptSlashRow,
    helpOpen,
    closeHelp,
    helpRows,
    helpSkillCount,
  } = wire;
  // #773：抽屉收起联动收弹层——切换器 / 提及 picker / 内联补全 / 恢复
  // 确认的 open 态都自持在抽屉内部，抽屉只收容器时它们跟着失活
  //（FloatingShell 的 portal 锚随容器走）却不清零，重开即带回 stale 开
  // 态。X / Esc / ⌘J 同走 open=false，这里一处收敛。
  useEffect(() => {
    if (open) return;
    setThreadsOpen(false);
    setRewindConfirm(null);
    closePicker();
    closeInline();
    closeSlash();
    closeHelp();
  }, [open, closePicker, closeInline, closeSlash, closeHelp]);
  // Esc 分层由 Base UI 壳代收（见下 onOpenChange）：Base UI 处理 Esc 时会
  // 拦下事件，窗口监听（旧 useEscapeClose）收不到。ADR 0013 D6 后不再有
  // dock 行发现——Portal 回 body，窗是 fixed 角落锚定（D10）。
  // #389 → ADR 0013 D5（MUL-5522 同律）：autofocus 只认 closed→open 迁移
  // ——持久化开态的加载（挂载即 open=true）不抢焦点；keepMounted 让节点
  // 常驻后，「OverlayMount 滞后一帧、首焦由 ref callback 承载」的旧径退役
  // （重开节点不脱离，迁移 effect 单点即可）。⌘J 热键呼出与 FAB 点击同路。
  const { textareaRef } = wire;
  const prevOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    // keepMounted 关态 = hidden 属性驻 DOM（app.css 把 display:none 中和成
    // visibility 停靠，#1067）：重开瞬间有两段瞬态窗体还不可聚焦——Base UI
    // 摘 hidden 的提交时机晚于本 effect，且进场首帧 aside 仍带
    // data-starting-style（tw v4 对该属性生成 visibility:hidden，进场动画
    // 首帧起播时摘除，实测 focus() 打在两种状态上都静默失败）——帧重试到
    // 节点既脱离 [hidden] 祖先、祖先又不再带 data-starting-style 再落焦
    // （有界 12 帧 ≈ 200ms 动画周期；中途关窗则 closest 命中 hidden 自然放弃）。
    let frames = 0;
    const tryFocus = () => {
      const node = textareaRef.current;
      if (node == null) return;
      const shell = node.closest('[hidden], [data-starting-style]');
      if (shell == null) {
        node.focus({ preventScroll: true });
        return;
      }
      if (frames < 12) {
        frames += 1;
        requestAnimationFrame(tryFocus);
      }
    };
    requestAnimationFrame(tryFocus);
  }, [open, textareaRef]);
  const attachComposer = useCallback(
    (node: HTMLTextAreaElement | null) => {
      textareaRef.current = node;
    },
    [textareaRef],
  );
  // #645: N = 新主题（抽屉作用域裸键）——与头部 + 钮同一 handler（触发 + 收
  // 切换器 popover）。enabled 门 = 开态且 live 面（fixture 面钮惰性，键同惰）；
  // 守卫与输入冲突律归 hotkeys 模块（composer 聚焦时 n 归打字员）。
  const newThread = useCallback(() => {
    if (onNewThread == null) return;
    onNewThread();
    setThreadsOpen(false);
  }, [onNewThread]);
  useChiefNewThreadHotkey(open && onNewThread != null, newThread);
  // A1 拆分：Dialog 壳（Root/Portal/Popup/aside）与 MessageScroller Provider
  // 住外层 ChiefDrawer；本组件 = Provider 之下的整列窗内容（header/body/
  // composer/弹层），hook 面得以消费 useMessageScroller。
  return (
    <>
      <header className="relative px-4 pt-1 pb-3">
        <div className="flex items-center">
          {/* XMON-23→#950：ghost 原语 + 头部 chip 皮肤 utility（零装饰 /
                tertiary 墨 / gap 6 / 可点）。标题 = 弹窗标题同档（#1398：
                16px 衬线 500，DESIGN.md「弹窗与菜单」）。中和件：h-auto（原语
                h-8 会撑高标题行）、leading-[inherit]（原语 text-sm 的定值
                20px 行高会压掉标题继承的行高）、shrink（chip 须收缩让 title
                省略号生效）、hover/expanded 涂底钉回透明、svg size-auto
                （ChiefHash 13px 属性尺寸）。 */}
          <Button
            variant="ghost"
            className="h-auto min-w-0 shrink cursor-pointer gap-1.5 rounded-none border-none bg-transparent p-0 leading-[inherit] text-(--text-tertiary) hover:bg-transparent hover:text-(--text-tertiary) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
            aria-label={t('主题')}
            onClick={() => setThreadsOpen((v) => !v)}
          >
            <ChiefHash />
            <span className="max-w-52 truncate font-heading text-heading font-medium text-(--foreground)">
              {t(chief.threadTitle)}
            </span>
            <ChevronDown width={12} height={12} />
          </Button>
          <div className="ml-auto flex items-center gap-3.5">
            {/* 头部三钮：ghost/icon 收编 + HEAD_ICON_BTN_CLS（旧
                  .chief-head-actions button 元素选择器等值，七通道归零）。 */}
            {/* #645/#1008: N 悬浮提示（kbd-hint 族第四消费点）——kbd-hint
                  退役（#983 判决）→ 官网 Tooltip+Kbd 组合（A0 已在 chief-root
                  的 ⌘J 面移植同款，本钮随形）；side=bottom sideOffset=8 =
                  旧 below 落位（头部贴视口顶，above 会落屏外）。 */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`relative ${HEAD_ICON_BTN_CLS}`}
                    aria-label={t('新主题')}
                    aria-keyshortcuts="N"
                    onClick={onNewThread != null ? newThread : undefined}
                  />
                }
              >
                <Plus width={18} height={18} />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                <Kbd>N</Kbd>
              </TooltipContent>
            </Tooltip>
            {onSettings != null && (
              <Button
                variant="ghost"
                size="icon"
                className={HEAD_ICON_BTN_CLS}
                aria-label={t('总管设置')}
                onClick={onSettings}
              >
                <ChiefGear />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className={HEAD_ICON_BTN_CLS}
              // ADR 0013 D3：关闭模型对齐 Multica——唯一的收起动作是
              // Minimize（Minus 字形，最小化心智，无 X）；语义 = 窗退
              // 回右下角 FAB，面板状态全保留（GLOSSARY「最小化」正名，
              // 「关闭」在悬浮窗语境入 avoid 列）。⌘J 再按同收。
              aria-label={t('最小化')}
              onClick={onClose}
            >
              <Minus width={16} height={16} />
            </Button>
          </div>
        </div>
        {/* 模型行（旧 .chief-model 等值：12px tertiary、gap 5、3 上距）。
                  #1260 总管降级：chief 无模型覆盖槽——行 = 绑定 Agent 自身
                  模型的只读展示（行首运行时标记同前：pi 块状 π / claude-code
                  品牌星标）；改模型去 Agent 设置面。 */}
        {chief.bound && (
          <div
            className="mt-1 flex items-center gap-1 text-meta text-(--text-tertiary)"
            data-testid="chief-model-row"
          >
            <span className="flex min-w-0 items-center gap-1 px-1">
              <span className="inline-flex flex-none items-center">
                {(chief.modelProvider ?? 'pi') === 'claude-code' ? (
                  <RuntimeClaudeCode width={12} height={12} />
                ) : (
                  <RuntimePi width={12} height={12} />
                )}
              </span>
              <span className="min-w-0 truncate">{chief.modelSlot}</span>
            </span>
          </div>
        )}
        {threadsOpen && (
          // 主题切换器（r5 116）：头部锚定绝对位、264 宽、drawer-local
          // z 5——#688 阶梯外，收编于抽屉 stacking context 只压内部内容。
          // 面 = Paper 菜单（#1398，DESIGN.md「弹窗与菜单」）：白底、
          // --radius-popover、4px 内衬、--shadow-popover；行 32 高、13.5px。
          // #1094：长列表封顶 + 纵向滚动——无上限的子元素撞上窗体
          // WINDOW_CLS 的 overflow-hidden 时尾部行不可达。上限照 slash-menu
          // 的绝对定位列表先例取 220px（max-h-55）；registry 侧的
          // max-h-(--available-height) 不适用——该变量由 Base UI
          // Positioner 注入，本容器不在 Positioner 里，变量恒未定义。
          <div
            className="absolute top-8 left-3 z-[5] max-h-55 w-66 overflow-y-auto rounded-(--radius-popover) bg-(--popover) p-1 shadow-(--shadow-popover)"
            role="menu"
          >
            {(chief.threads ?? []).map((thread, index) => (
              // #950 裸控件收编：行钮 = Button ghost + 七通道归零（旧
              // .chief-switcher-row 等值：30 行 / 13px 次级墨 / 方角
              // 透明底）；当前主题态载体 = aria-current（旧 .is-active
              // 类退役，#910 裁定 3——surface-hover 底随条件挂）。
              <Button
                variant="ghost"
                role="menuitem"
                key={thread.title}
                aria-current={thread.active ? 'true' : undefined}
                className="h-8 w-full cursor-pointer justify-start gap-2 rounded-sm border-none bg-transparent px-2 text-left text-ui font-normal text-(--text-secondary) hover:bg-(--menu-hover) hover:text-(--foreground) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent aria-[current=true]:bg-(--menu-hover) aria-[current=true]:font-medium aria-[current=true]:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                onClick={
                  onThread != null
                    ? () => {
                        onThread(thread.title, index);
                        setThreadsOpen(false);
                      }
                    : undefined
                }
              >
                <ChiefHash width={11} height={11} className="flex-none text-(--text-tertiary)" />
                <span className="truncate">{t(thread.title)}</span>
              </Button>
            ))}
          </div>
        )}
      </header>

      {/* gate / hero 移出滚动区（#1009 A1）：两面只在无流状态出场
                （未绑定 gate / 空线程 hero），移出后视觉等价；滚动区自此
                纯消息流。gate 在位（= 未绑定）时 hero 上距 64，否则 56
                ——条件类随 JSX 状态切换（旧 .chief-hero 兄弟选择器等值）。 */}
      {!chief.bound && (
        /* gate 横幅 = Paper 卡（#1398）：--radius-card + 1px line 环，
           不铺底色；右侧一个墨色主按钮。 */
        <div
          data-testid="chief-gate"
          className="mx-4 flex h-14 flex-none items-center gap-3 rounded-(--radius-card) bg-(--card) pr-3 pl-4 text-ui text-(--text-secondary) ring-1 ring-(--border)"
        >
          <span>{t('请先为总管选择一个 Agent。')}</span>
          {/* 主按钮 = shadcn Button default 档（墨底 32 高 8 圆角，
              DIALOG_PRIMARY_BUTTON），靠右。 */}
          <Button
            className={`ml-auto cursor-pointer ${DIALOG_PRIMARY_BUTTON}`}
            onClick={onSettings}
          >
            {t('设置')}
          </Button>
        </div>
      )}
      {chief.examples && (
        <div className="flex-none">
          <h2
            className={`text-center font-heading text-heading font-medium text-(--foreground) ${
              chief.bound ? 'mt-14' : 'mt-16'
            }`}
          >
            {t('选择一个主题开始')}
          </h2>
          <div className="mx-8 mt-3 grid grid-cols-2 gap-2.5" data-testid="chief-examples">
            {chief.examples.map((ex) => {
              const Icon = EXAMPLE_ICONS[ex.icon];
              return (
                // #146: 点击即发预置词进 chief 线程（live 面走 onSend，
                // 等同用户键入发送；zh 权威 canon 串上行，r5 111 逐字）。
                // #631：onSend 异步化（被拒保留 draft）后 hero 面消费
                // fire-and-forget——失败 toast 归 surface，此处无 draft
                // 可保，不悬挂未处理 promise。
                // 示例卡 = Paper 卡（#1398，DESIGN.md「卡片圆角：一个角」）：
                // 64 高、--radius-card、白底 + 1px line 环、hover menu-hover；
                // 行首图标裸放 ink-3（不垫色块）。中和件：justify-start/
                // whitespace-normal/font-normal（原语居中+nowrap+medium 会破
                // 卡内左对齐换行文案）、active 位移、svg size-auto（字形
                // 16px 属性尺寸）。
                <Button
                  variant="ghost"
                  className="h-16 w-full cursor-pointer justify-start gap-3 rounded-(--radius-card) border-none bg-(--card) px-3 text-left whitespace-normal font-normal ring-1 ring-(--border) hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
                  key={ex.text}
                  onClick={onSend != null ? () => void onSend(ex.text) : undefined}
                >
                  <span className="flex size-6 flex-none items-center justify-center text-(--text-tertiary)">
                    <Icon width={16} height={16} />
                  </span>
                  {/* 12px: r5 100 wraps 帮我组建 Agent 团/队 but keeps
                              帮我创建一个新项目 on one line inside the
                              170-wide card */}
                  <span className="text-meta leading-5 text-(--text-secondary)">{t(ex.text)}</span>
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {/* #651 → #1009 A1 滚动模型替换：真滚动容器 = MessageScroller
                Viewport（原语 overflow-y-auto 承载 F-R6/R8 的 chief-body
                pin 面）；Root 中和 h-auto（原语 size-full 的 h-full 在
                header/composer 兄弟列里会顶爆 flex 链）；Content 中和
                block + gap-0（行距留在行 margin 上，注记见常量）。
                chief-body / chief-stream 两 testid 载体随迁。 */}
      <MessageScroller className={SCROLLER_ROOT_CLS}>
        <FadeScrollerViewport data-testid="chief-body">
          <MessageScrollerContent className={SCROLLER_CONTENT_CLS} data-testid="chief-stream">
            {chief.stream?.map((item, i) => (
              // 行渲染器住 ./chief-message-rows.js（#1126 提取）——DOM/testid
              // 逐字节不变的纯搬移；key 律走 chiefStreamRowKey（有源
              // message id 的行用 id，note/error/streaming 无 id 用 index）。
              <ChiefStreamRow
                key={chiefStreamRowKey(item, i)}
                item={item}
                index={i}
                bound={chief.bound}
                agent={chief.agent}
                runningTool={chief.runningTool}
                user={user}
                copiedKey={copiedKey}
                onCopy={copyText}
                toolsOpen={toolsOpen}
                onToggleTools={toggleTools}
                onRewindRequest={(index, id) => setRewindConfirm({ index, id })}
                onAnswerQuestion={onAnswerQuestion}
                onCancelQuestion={onCancelQuestion}
              />
            ))}
          </MessageScrollerContent>
        </FadeScrollerViewport>
        {/* CDS PR-6：jump-to-latest 独立 120px 阈值（JumpToLatestButton；
                follow 仍 40px）。落位/显隐动效沿原语 Button 配方。 */}
        <JumpToLatestButton>
          <ArrowDown width={16} height={16} />
          <span className="sr-only">{t('滚动到最新')}</span>
        </JumpToLatestButton>
      </MessageScroller>

      {/* #948：strip 的流内垫规则自 attachment-strip.css 迁入（该文件
                退役）——composer 卡在流内，strip 垫 8px 骑在输入与工具栏之间。
                #950：旧 .chief-composer 皮肤等值 utility（#775：--edge-ring
                发丝环 + card-shadow 卡级抬升，双主题随 token）。类名
                chief-composer 以零规则钩子存活：#948 把外域规则内联进本 div
                后，余下消费者 = spec 容器 scope（chief-panel.spec 的
                composer bar 定位）；摘除归 #952 终账。 */}
      <div className="chief-composer [&>.attachment-strip]:mt-2 mx-4 my-2.5 rounded-(--radius-composer) border-0 bg-(--secondary) px-3 pt-3 pb-2.5 shadow-(--shadow-composer) transition-[box-shadow] duration-[220ms] ease-(--ease-out-expo) hover:shadow-(--shadow-composer-hover) focus-within:shadow-(--shadow-composer-focus)">
        {/* #624：占位双态随回合态（r5 §3.6，截图 113）——活动线程 activeRun
              在位（chief.running，mapChief 单点投影）= steer canon「执行过程中
              即可送达」，空闲 / 新主题 / 回合收尾 = 空闲 canon。两值经 t() 消费
              shared 单源常量，抽屉文件零 CJK 占位字面量（en 键由
              i18n-coverage COMPUTED_KEYS 钉住）；刷新节奏骑既有
              invalidateAll / conversation SSE 重取，无新增轮询。 */}
        <div className="relative">
          {/* #732：textarea 皮肤照 detail composer 同款 combobox 律——内联
                listbox 开窗时报 combobox + 指向高亮行（DOM 焦点恒在框内，
                listbox 行不可聚焦）；caret-only 移动重判 token（change 事件
                覆盖不到那些）；fixture 静态面 editable=off → wire 重判永不发动。
                包层 = listbox 的 absolute 锚（relative；detail composer
                .composer-input-wrap 同律）。
                #950 裸控件收编：Textarea 件 + XMON-102/#860 尺寸律 utility
                （3 行 60px 基座、内容增高至 120px 上限由 wire growCap 的
                inline height 承载、超限盒内滚动，布局不抖）；件的
                field-sizing/边框/焦点环就地并掉（旧面 outline:none——输入
                焦点环缺席是既有形态，环律由全局 base 层承接与否随件皮肤
                显式归零）。e2e 载体 = data-testid（#910 二级：role 随补全
                开合在 textbox/combobox 间翻转、placeholder 随回合态双值，
                语义 locator 不稳）。 */}
          <Textarea
            ref={attachComposer}
            data-testid="chief-composer-input"
            className="h-15 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent p-0 font-sans text-ui leading-5 text-(--foreground) md:text-ui tabular-nums shadow-none field-sizing-fixed placeholder:text-(--text-secondary) focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
            readOnly={onSend == null}
            value={wire.draft}
            onChange={wire.handleChange}
            onKeyDown={wire.handleKeyDown}
            // #732：剪贴板图片/文件走 #310 attachFile 链（纯文本粘贴永不
            // 进 preventDefault，detail composer 同律）。
            onPaste={handlePaste}
            onKeyUp={handleCaretMoved}
            onClick={handleCaretMoved}
            onSelect={handleCaretMoved}
            onCompositionEnd={handleCompositionEnd}
            onBlur={handleBlur}
            placeholder={t(
              chief.running === true ? CHIEF_INPUT_PLACEHOLDER_STEERING : CHIEF_INPUT_PLACEHOLDER,
            )}
            {...(inlineOpen
              ? {
                  role: 'combobox',
                  'aria-expanded': true,
                  'aria-controls': inlineListboxId,
                  'aria-autocomplete': 'list' as const,
                }
              : slashOpen
                ? {
                    role: 'combobox',
                    'aria-expanded': true,
                    'aria-controls': slashListboxId,
                    'aria-autocomplete': 'list' as const,
                  }
                : {})}
            {...(inlineOpen && inlineHighlight != null
              ? { 'aria-activedescendant': `${inlineListboxId}-opt-${inlineHighlight}` }
              : slashOpen && slashHighlight != null
                ? { 'aria-activedescendant': `${slashListboxId}-opt-${slashHighlight}` }
                : {})}
          />
          {/* #732：@ 内联 listbox（detail composer 同皮；mention-picker.css
                的 z-40 阶梯 = 宿主 drawer stacking context 内局部压住 composer）。 */}
          <MentionInline
            open={inlineOpen}
            rows={inlineRows}
            caret={inlineCaret}
            query={inlineQuery}
            highlight={inlineHighlight}
            onHover={setInlineHighlight}
            onPick={(row) => {
              if (row.kind === 'file') {
                insertFile(row.label);
              } else {
                // #848: every entity kind inserts through serializeMention.
                insertToken({
                  kind: row.kind,
                  id: row.id,
                  label: row.label,
                  ...(row.seq !== undefined ? { seq: row.seq } : {}),
                });
              }
            }}
            listboxRef={inlineListboxRef}
            listboxId={inlineListboxId}
          />
          {/* #841 `/` slash menu（detail composer 同皮同锚：包层
                .chief-composer-input-wrap 即 relative 锚，行不可聚焦、DOM
                焦点恒在框内；Click = Enter-with-highlight 语义）。 */}
          <SlashMenu
            open={slashOpen}
            sections={slashSections.map((s) => ({
              title: s.section === 'builtin' ? t('命令') : t('技能'),
              rows: s.rows,
            }))}
            caret={slashCaret}
            query={slashQuery}
            highlight={slashHighlight}
            onHover={setSlashHighlight}
            onPick={(row) => acceptSlashRow(row, 'enter')}
            listboxRef={slashListboxRef}
            listboxId={slashListboxId}
          />
        </div>
        {/* #757 附件 strip（detail composer 同件：在途占位 + 落定 chip，
              可点预览）。chief composer 卡是 in-flow 布局，strip 走流式、
              空时零节点。 */}
        <AttachmentStrip draft={wire.draft} pending={pendingAttachments} />
        {/* deliberate-native（#855）：隐藏的文件选择触发器
                  （display:none，编程式打开），可见皮肤在附件 Button 上；
                  Input 原语是可见输入框皮肤，此处无可收编之物。 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onPickFiles}
          // 客户端 mime 守门（与服务层 ALLOWED_MIME_* 镜像，detail
          // composer 同值）；note accept 只是 hint，最终由 server 强拒兜底。
          accept="text/*,image/*,application/json,application/pdf,application/xml"
        />
        <div className="mt-2.5 flex items-center gap-4">
          {/* #732（#146 隐藏裁决翻案）：附件 + 提及开闸渲染（detail composer
                同款交互面，无新后端面）。语音输入维持 wontfix 不渲染（#304 C5）。
                fixture 面：onAttachment 缺省 → 附件钮惰性 disabled（件配方
                opacity-50/pointer-events-none 即 canon）；mentionGroups
                空 → popover 零计数开面（wire EMPTY_GROUPS 律）。 */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('添加附件')}
            className={TOOL_BTN_CLS}
            disabled={attaching || onAttachment == null}
            onClick={openFilePicker}
          >
            <Paperclip width={16} height={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('提及')}
            className={TOOL_BTN_CLS}
            onClick={togglePicker}
          >
            <Grid2x2 width={16} height={16} />
          </Button>
          {/* XMON-23→#950：ghost/icon 原语；实底双态（seg-active 歇 /
                card-button 亮）utility 化随 draft 条件切（旧 .is-on 状态类
                退役——态正本在 wire.draft，无需 DOM 载体）。rounded-md =
                旧 .btn 的 8 圆角档随件；border-0 防原语 1px transparent 边 +
                bg-clip-padding 在实底外圈切出 1px 缝（像素对拍实测）；
                ArrowUp 16px = 原语 size-4 同值。 */}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('发送')}
            className={wire.draft !== '' ? `${SEND_BTN_CLS} ${SEND_ON_CLS}` : SEND_BTN_CLS}
            onClick={wire.send}
          >
            <ArrowUp width={16} height={16} />
          </Button>
        </div>
        {/* #732：提及 popover（detail composer 同皮；壳 FloatingShell 非模态
              Dialog，Esc 走 Base UI layer 栈只收顶层——drawer 侧的 #146 分层律
              不受扰）。 */}
        <MentionPicker
          open={pickerOpen}
          onClose={closePicker}
          groups={groups}
          onInsert={(tokens) => {
            insertTokens(tokens);
            closePicker();
          }}
        />
        {/* #841 `/help` panel（detail composer 同件：当前可用 builtins
              只读一览）。 */}
        <SlashHelp
          open={helpOpen}
          onClose={closeHelp}
          commands={helpRows}
          skillCount={helpSkillCount}
        />
      </div>
      {/* #615 返工：恢复钮确认层（破坏性：截断锚后消息并以锚重发）。
            fixture 面 id 缺省 = accept 律关窗零请求。 */}
      <DialogShell
        title={t('恢复到此处')}
        open={rewindConfirm !== null}
        onClose={() => setRewindConfirm(null)}
        size="s"
        footer={
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setRewindConfirm(null)}
            >
              {t('取消')}
            </Button>
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              onClick={() => {
                const anchor = rewindConfirm;
                setRewindConfirm(null);
                if (anchor?.id != null) onRewind?.(anchor.id);
              }}
            >
              {t('恢复到此处')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-foreground">
            {t('恢复到此处？该条之后的 {n} 条消息会移除，总管从这条重发开新回合。', {
              n: Math.max(0, (chief.stream?.length ?? 0) - (rewindConfirm?.index ?? 0) - 1),
            })}
          </p>
        </div>
      </DialogShell>
    </>
  );
}
