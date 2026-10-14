// New-task dialog (issue #66, r7 04/14; spec 15 #394 改造): 672×439 centered
// modal over the board. Head = project chip + centered 新建任务 + close;
// body = 单字段正文 textarea（无标题输入——保存时 server 落占位标题 = 正文
// 首行截断，执行 agent 接单后经 set_task_meta 回填正式标题，ADR 0002）；
// footer = composer-style toolbar + 保存 / 保存并开始（闸 = 正文非空）。
// #176: the project chip is a selector — click opens an anchored popover
// (#1008 起壳 = registry Popover, Esc 归 Base UI layer 栈, dhead chip
// popover precedent), rows = the project set (live = useProjects truth;
// fixture = scenario projectNames / canon default), selection backfills the
// chip and rides the submit's projectId（rememberProject 面另落一份
// localStorage 记忆，见下 XMON-87 段）。
// A3-overlays 收编：footer 双钮 = components/ui/Button（ghost / default，弹窗
// 语义 default 档 32px，r7 实测 30 归一到原语三档）。
//
// M7 #310 附件 wire（r9 §3.1）：
//   - spec 受控：live 创建面父持 state，附件 token 才能注入；fixture/静态
//     div 面父不传 spec/onSpecChange → 内部 useState fallback，零行为差
//   - 附件钮 = 原生文件多选触发器，选中文件 → onAttachment(files) 委托
// #311: spec textarea now owns state + the 提及 button opens the same
// MentionPicker the composer uses. Mention tokens land at the spec
// caret position via insertMentionText — the spec rides along to the
// createTodo body unchanged, and the rendering side (Segments) parses
// them back into chips when the description is shown later.
// #318 未保存闸 (r9 §3.4): 正文非空时,三条关闭路径(X / backdrop /
// Esc)先过「放弃新建任务？未保存的内容将丢失。」确认弹层(继续编辑 / 放弃
// 并关闭);净表单直关不闸。Esc 分层沿 #176 内层优先律(确认层 → 提及
// picker → 项目 popover → dialog;#656 起四层同栈 = Base UI layer 序,
// 最顶先收)。关闭即重置表单(retained-mount 重开 =
// 净面,闸判定不带脏残留)。#394 起 dirty = 正文单字段（标题/标签面移除）。
//
// XMON-95 ⌘↵：保存并开始 除点击外可由 ⌘↵（非 mac = Ctrl+↵）触发，和弦走
// overlays/hotkeys.ts 的 useChordHotkey（可复用注册位，本票是它的第一个面
// 内消费点），按钮上带常亮按键角标。守卫/闸/标识三处细节见各自行注。
// XMON-87 选择记忆：rememberProject 面（board / 侧栏全局面）把选中项目 id 落
// localStorage，刷新后 chip 回上次那行——此前是纯表单 state，刷新即掉回
// rows[0]（用户实测「选 Pacman → 刷新 → 回第一个」）。锚定面不记忆，理由见
// 该 prop 注记。
// XMON-87 续二：Tab 直接换项目（chip 上挂 Tab 悬浮提示 chip，#468 族）——循环
// 而不是开面（「直接切换」要的是按一下就换）；开态门与守卫见
// overlays/hotkeys.ts 的 useProjectCycleHotkey。

import type { ClipboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertDialog, AlertDialogContent } from '../components/ui/alert-dialog.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Kbd } from '../components/ui/kbd.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Textarea } from '../components/ui/textarea.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.js';
import { PROJECT_ID, PROJECT_NAME } from '../fixtures/fixtures.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChevronDown, Grid2x2, Paperclip, X } from '../icons/index.js';
import { isEditableTarget, useChordHotkey, useProjectCycleHotkey } from '../overlays/hotkeys.js';
import { safeLocalStorage } from '../safe-storage.js';
import {
  createPastedNameCounter,
  filesFromClipboardData,
  insertAttachmentTokens,
  type PastedNameCounter,
  preparePastedFiles,
} from './attachment-paste.js';
import { AttachmentStrip } from './attachment-strip.js';
import { type MentionGroups, MentionPicker } from './mention-picker.js';
import { insertMentionText, type MentionToken } from './mention-token.js';
import { applyOrderedListEnter } from './ordered-list.js';
import { usePendingAttachments } from './pending-attachments.js';

// ---- #948 per-face 清零：overlay.css 的本面规则 1:1 迁以下 utility 常量 ----
// 几何全部保 r7 04/14 实测值（672×439 壳经 DialogShell width/height 入参；
// head 44 / 行 32 / chip 30 / 工具钮 30 / 钮组 gap 13 等阶梯外一次性尺寸走
// arbitrary，§3.1(a)）。行钮 hover 底不写 utility：.new-task-project-row 与
// .new-task-close 在 motion.css 的 #73 家族名单里（accent-soft tint，
// unlayered 恒压 layered 工具类与件配方），家族律即本面 hover 正本。

/** head 项目 chip（原 .new-task-project）：透明无框触发钮，Button ghost
 *  七通道中和（#908 裁决 3）；svg 墨 tertiary（chevron 12px 属性原值）。 */
const PROJECT_CHIP_CLS =
  "new-task-project flex h-auto min-w-0 cursor-pointer items-center justify-start gap-2 border-none bg-transparent p-0 font-normal text-(--foreground) hover:bg-transparent hover:text-(--foreground) dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg]:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto";

/** 项目/机器 popover 面板 layout 槽（#1008：V2 弹层壳皮肤 / 描边 Arrow /
 *  absolute 定位 / z 档全退役——皮肤与动效归 PopoverContent 默认，定位归
 *  Positioner 参数，z 归件内 --z-dialog 单梯）：220 宽是内容 layout（行 =
 *  avatar+名+勾 的捕获节奏），行距归零（旧面行带紧贴）。别名类原样（e2e）。 */
const PROJECT_MENU_CLS = 'new-task-project-menu w-[220px] gap-0';

/** popover 选项行（原 .new-task-project-row）：32px 行、8px 圆角；hover
 *  tint 归 motion.css #73 家族律（此处不写 hover bg，件配方被家族压掉）。 */
const OPTION_ROW_CLS =
  'new-task-project-row flex h-8 w-full cursor-pointer items-center justify-start gap-2 rounded-[8px] border-none bg-transparent pr-1 pl-0 text-left text-xs leading-4 font-normal text-(--foreground) aria-expanded:bg-transparent active:not-aria-[haspopup]:translate-y-0 disabled:pointer-events-auto';

/** 未保存闸确认层（#318 r9 §3.4）layout 槽（#1008：居中 fixed / 圆角 /
 *  底色投影 / --z-confirm 档全退役——registry AlertDialogContent 默认承载
 *  居中与皮肤，z-50 = --z-dialog 值，数值上仍压 DialogShell 低档面板）：
 *  448 宽是捕获设计的内容 layout。别名 new-task-discard 原样（e2e）。 */
const DISCARD_PANEL_CLS = 'new-task-discard w-[448px] max-w-[448px] sm:max-w-[448px]';

/** Spec textarea template lines, verbatim r2 §5.2 / r7 04 placeholder
 *  block — dict keys so the en fallback carries them too. */
const SPEC_TEMPLATE_LINES = [
  '我想要的结果：',
  '现在的情况：',
  '需要保留或避免：',
  '我会这样确认完成：',
  '我希望收到：',
];

/** #176 选择器行:live = ProjectRecord 最小投影(id/name);fixture =
 *  scenario projectNames。 */
interface ProjectOption {
  id: string;
  name: string;
}

/** XMON-87 选择记忆位(localStorage 键;e2e 镜像 newtask-project-persist.spec.ts)。
 *  单租户单机、无账号维度——与 pacman.sidebar-collapsed /
 *  pacman.dirBrowser.lastDir 同律。 */
export const NEW_TASK_PROJECT_STORAGE_KEY = 'pacman.newTaskProjectId';

/** 读记忆位:隐私模式等抛 = 无记忆(dir-browser W13 同律)。#1091:参数可空——
 *  调用点必须传 safeLocalStorage():裸 `localStorage` 实参在 Storage 不可用
 *  环境于求值时就抛 SecurityError,进不了函数体的 try/catch。 */
function readRememberedProject(storage: Storage | null): string | null {
  try {
    return storage?.getItem(NEW_TASK_PROJECT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeRememberedProject(storage: Storage | null, projectId: string): void {
  try {
    storage?.setItem(NEW_TASK_PROJECT_STORAGE_KEY, projectId);
  } catch {
    // 写不进 = 不记住,选择本身不受损(W13 同律)
  }
}

/** 读记忆位:隐私模式等抛 = 无记忆(readRememberedProject 同律,含 #1091 的
 *  实参纪律:调用点传 safeLocalStorage())。 */

/** 写记忆位:null(选「自动」) = 清。写不进 = 不记住,选择本身不受损(W13 同律)。 */

/** fixture 面项目集兜底:scenarios 不带 projectNames 时退 canon 单默认
 *  项目(r3-lifecycle,#176 票面「至少默认项目」)。 */
const DEFAULT_PROJECT: ProjectOption = { id: PROJECT_ID, name: PROJECT_NAME };

/** XMON-95 面级守卫：输入态吞键收窄到本面板之外（⌘J 的 drawer-interior
 *  律平移，hotkeys.ts 注记）。面板打开时 autofocus 落正文 textarea——守卫
 *  若在面板内照吞，和弦永远打不到「保存并开始」。类名出处 = 下方 DialogShell
 *  的 className（.dlg 面板根）。提及 picker 是面板外的兄弟层，其输入框照
 *  吞：在提及面里按 ⌘↵ 不该提交（Enter 在那里是选中语义）。 */
const isEditableOutsideDialog = (target: EventTarget | null): boolean =>
  isEditableTarget(target) &&
  !(target instanceof HTMLElement && target.closest('.new-task-dialog') !== null);

/** XMON-95 界面标识：通用快捷键和弦在这块面板上的字面量。沿用 sidebar
 *  badge 先例（⌘K / C）——不做平台探测、不进 i18n 词典；非 mac 实际绑定
 *  Ctrl+↵ 同族（hotkeys 注册处双平台收）。 */
const START_SHORTCUT_LABEL = '⌘↵';

export interface NewTaskDialogProps {
  /** #73: retained-mount open flag — the exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  /** spec 15 #394:提交 = 正文 + 选中项目 id（无标题/标签——标题 server 派生
   *  占位、agent 回填；标签固定词表由 agent 归类）。
   *  #311：spec 参数携带 mention token 内容——父级负责透传到
   *  createTodo body。 */
  onSave: (spec: string, projectId?: string) => void;
  /** M5 live 面：保存并开始 = 创建 + POST builds（r2 §4.2 双钮语义）；
   * 缺省 = fixture 行为（同 保存）。#682 机器参数同 保存 面。 */
  onSaveAndStart?: (spec: string, projectId?: string) => void;
  /** M5 live：项目集真值(选择器行数据源);缺省 = fixture canon 单默认
   * 项目(live = projectsQ 投影,fixture = scenario projectNames)。 */
  projects?: ProjectOption[];
  /** #682：机器集真值（选择器行数据源）；缺省 = 空集（chip 只显「自动」，
   * 选择器只有自动一行——单机/未加载的降级面）。 */
  /** M7 #310 受控 spec：live 创建面父持 state,附件 token 才能注入;fixture
   * 面不传 → 内部 useState fallback。 */
  spec?: string;
  onSpecChange?: (next: string) => void;
  /** M7 #310 附件（#729 契约收窄）：附件钮选件 / 剪贴板粘贴 →
   * onAttachment(files)，父负责 grant + upload，返回成功文件的 token；
   * 注入 spec（行原子、粘贴落 caret 位）由本文件的 runAttachment 统一做。
   * 父组件在 live 创建面下应同时传 spec/onSpecChange 才能接住注入。 */
  onAttachment?: (files: File[]) => string[] | Promise<string[]>;

  /** #311: mention picker groups（5 类别）。父级从 live hooks 或
   *  fixture 派生；缺省 = 空集合（picker 首层 0 计数）。 */
  mentionGroups?: MentionGroups;

  /** XMON-87 选择记忆:true = 选中行跨刷新存活(挂载读一次、选行写回)。
   *  缺省 false = 纯表单 state。锚定面(#404 project 页)走缺省——那面的
   *  未动选择恒等于 rows[0] = 本页路由项目(#305 律),全局记忆会把它顶掉。 */
  rememberProject?: boolean;
}

export function NewTaskDialog({
  open,
  onClose,
  onSave,
  onSaveAndStart,
  projects,
  spec: specProp,
  onSpecChange,
  onAttachment,

  mentionGroups,
  rememberProject = false,
}: NewTaskDialogProps) {
  const { t } = useI18n();
  // M7 #310 受控 spec：fallback 模式（fixture 静态 div）内部 useState，
  // 父组件未传 spec/onSpecChange 时走 fallback,行为字节不变。
  const [internalSpec, setInternalSpec] = useState('');
  const specControlled = specProp !== undefined && onSpecChange !== undefined;
  const spec = specControlled ? (specProp as string) : internalSpec;
  const setSpec: React.Dispatch<React.SetStateAction<string>> = specControlled
    ? (next) =>
        (onSpecChange as (s: string) => void)(typeof next === 'function' ? next(spec) : next)
    : setInternalSpec;
  // #311 mention picker
  const [pickerOpen, setPickerOpen] = useState(false);
  // #318 未保存闸确认层开态
  const [discardOpen, setDiscardOpen] = useState(false);
  // #176 选择器 state:popover 开态 + 选中行。null = 未动,展示/提交取
  // 首行;live 空项目集时 selected 退 undefined(chip 走 canon 名)。
  // XMON-87 记忆面:初值 = 上次选中的项目 id。存的值不在行集里(被删/无权限)
  // = find 打空、selected 落回首行——不报错不白屏,记忆位留着不动(行集可能
  // 只是还没加载,按缺省清记忆会误伤真值)。
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(() =>
    rememberProject ? readRememberedProject(safeLocalStorage()) : null,
  );
  // #1060 手势消费闸（CI 偶发双关的根因位）：非模态 registry Popover 的外点
  // 自收与 dialog 自己的关闭判定（React 背板 onClick 链、Base UI native
  // outside-press dismiss → onClose）消费同一次 click；判定读到的是内层关前
  // 还是关后的 state，取决于 React flush 与监听器注册序——调度竞态，两关全落
  // 时一次外点把两层一起关（newtask-project-select「outside click closes the
  // popover layer only」的偶发红即此）。ref 在同一次原生事件分发内同步写入，
  // 免疫 flush 时序：内层 popover 因 outside-press 自收时置闸，requestClose
  // 汇流点见闸即收束本次手势（关闸判定必须过 ref 而非 state，state 正是竞态
  // 的当事方）。清闸交给下一手势的 pointerdown / keydown（capture 相先于新
  // 手势的任何关闭判定）——不用 0ms 定时器：touch 的 sloppy 档下自收与后续
  // click 之间隔着宏任务，定时器会提前放闸。
  const gestureConsumedRef = useRef(false);
  const markGestureConsumed = () => {
    if (gestureConsumedRef.current) return;
    gestureConsumedRef.current = true;
    const clear = () => {
      gestureConsumedRef.current = false;
      document.removeEventListener('pointerdown', clear, true);
      document.removeEventListener('keydown', clear, true);
    };
    document.addEventListener('pointerdown', clear, true);
    document.addEventListener('keydown', clear, true);
  };
  // M7 #310 附件：file picker ref + 上传中 disable 纸夹扣
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attaching, setAttaching] = useState(false);
  // #757 在途占位（composer-wire 同构：track/untrack 精确到本 run 的 uid，
  // 重叠上传互不清除）。
  const {
    pending: pendingAttachments,
    track: trackPending,
    untrack: untrackPending,
  } = usePendingAttachments();
  // #729：粘贴编号 counter（每 draft 递增，CC [Image #N] 精神）+ 在途上传
  // 计数（阻保存/⌘↵，state 异步、ref 同步）+ spec 镜像（上传完成时注入
  // 以最新已提交值为底——render 闭包里的 spec 会吞掉上传期间的打字）+
  // 待恢复 caret 位。与 overlay/composer-wire.ts 的同名机制同构，共享的
  // 行原子插入函数保证两面不漂移（票面失败方式 9）。
  const pastedNameCounterRef = useRef<PastedNameCounter | null>(null);
  if (pastedNameCounterRef.current === null) {
    pastedNameCounterRef.current = createPastedNameCounter();
  }
  const attachInFlightRef = useRef(0);
  const pendingCaretRef = useRef<number | null>(null);
  const specMirrorRef = useRef(spec);
  specMirrorRef.current = spec;
  const rows = projects ?? [DEFAULT_PROJECT];
  const selected = rows.find((row) => row.id === projectId) ?? rows[0];
  const projectName = selected?.name ?? PROJECT_NAME;
  // #318: 附件 token 注入 spec 后由 spec 非空承载 dirty,不另计。

  const dirty = spec.trim() !== '';
  // #389 硬化（叠加在 #394 的 effect 归还之上）：用户发起的关闭路径同步
  // 归还——effect 归还在负载下可滞后于紧随的断言读（overlay-focus 批跑
  // 实测 race）。脏表单只开确认层（dialog 不关，焦点不还）。
  const returnFocusToInvoker = () => {
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    if (el && el !== document.body && document.contains(el)) el.focus();
  };
  // #1060 闸位镜像：requestClose 可能经 Base UI store 持有的**旧世代闭包**被
  // 调（Root 的 onOpenChange prop 同步同样落后于弹层可见），闭包里读 state 会
  // 拿到旧值——ref 穿透闭包世代：旧闭包也读到当代表。渲染期幂等写（同一渲染
  // 世代写同一值；弹层 DOM 可见 ⇒ 该世代的写已发生）。
  const gateRef = useRef({
    discardOpen: false,
    pickerOpen: false,
    projectOpen: false,
    dirty: false,
  });
  gateRef.current = { discardOpen, pickerOpen, projectOpen, dirty };
  const requestClose = () => {
    // #1060 双闸（汇流点）：dialog 的一切关闭意图——Base UI native dismiss
    // （经 DialogShell onClose）、背板 onClick、X 钮、保存/放弃之外的落穿——
    // 统一汇流到本函数，闸设在汇流点一处生效。
    // 闸一（ref，同步）：内层已接线并自收（outside-press 等）时置位——ref 在
    // 同一次原生事件分发内写入，免疫 React flush 时序（内层开态 state 可能已
    // 在闸判读前翻假）。清闸在下一手势（见 markGestureConsumed）。
    if (gestureConsumedRef.current) return;
    // 闸二（内层开态镜像，补 Base UI 的接线窗）：dismiss 监听、层栈树节点、
    // Root 的 prop 同步全挂在被动 effect 上，而弹层 DOM 在 commit 即可见——
    // 快速点击（合成输入/高负载，插桩重放实测 60 轮中 13 次）可落进这扇窗：内层来不及
    // 自收，dialog 误判自己是最上层直接收下本次关闭。此时镜像里的内层开态仍
    // 为真，代内层执行「只关最上层」：确认层 → 提及 picker → 项目 popover →
    // 机器 popover（旧 #318 分层链的语义，位置从背板链上移到全部关闭路径的
    // 汇流点）。每个收束分支同时置闸一——同一次手势会二次进闸（native
    // dismiss 与背板 onClick 都汇流到此，插桩重放实测相隔 ~3.5ms），第二次进来
    // 时 React 可能已 flush 掉内层开态，镜像拦不住，须由同步 ref 收束。
    const gate = gateRef.current;
    if (gate.discardOpen) {
      markGestureConsumed();
      closeDiscard();
      return;
    }
    if (gate.pickerOpen) {
      markGestureConsumed();
      setPickerOpen(false);
      return;
    }
    if (gate.projectOpen) {
      markGestureConsumed();
      setProjectOpen(false);
      return;
    }
    if (gate.dirty) {
      // 未保存闸开确认层同样消费本次手势（二次进闸不得把刚开的确认层又收掉）。
      markGestureConsumed();
      setDiscardOpen(true);
      return;
    }
    returnFocusToInvoker();
    onClose();
  };
  // 分层关闭(内层优先,合并 #311 picker + #318 闸):各内层常态由自己的
  // registry 壳收 Esc / 外点——AlertDialog / Dialog / Popover 同在 Base UI
  // layer 栈,escapeKey isTopmost 自己收;requestClose 的双闸(#1060)在全部
  // 关闭意图的汇流点兜底同一套层级——关闸语义不止 Esc 一路,漏到 dialog 层
  // 的关闭意图一律先喂最上层内层。
  // retained mount:dialog 关闭一并收 popover(重开不得带回开态) + 确认层
  // + picker,并重置表单(重开不得带回开态/脏字——闸判定以净面起步)
  useEffect(() => {
    if (!open) {
      setProjectOpen(false);
      setDiscardOpen(false);
      setPickerOpen(false);
      setSpec('');
    }
  }, [open]);
  // retained mount：关闭退场后子树卸载,重开 = 重新挂载。autofocus 挂 ref
  // callback（挂载瞬间触发,绕过壳层的 effect 时序——首开时
  // 对话框 effect 早于子树挂载,effect 里聚焦会打空）。useCallback 稳定
  // 引用 = 输入期重渲染不重复触发（同元素同 ref 不重逢）。
  const specRef = useRef<HTMLTextAreaElement | null>(null);
  const focusSpecRef = useCallback((el: HTMLTextAreaElement | null) => {
    specRef.current = el;
    el?.focus();
  }, []);
  // 焦点归还（#388 族律）：开时记下触发元素,关时归还——正文 textarea 随
  // 退场卸载,不归还会掉回 body（键盘用户丢失上下文;overlay-focus e2e 的
  // Esc 后环断言依赖焦点回到触发钮）。
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    returnFocusToInvoker();
  }, [open]);
  // #723 真回归修：闸层拥有键盘时焦点显式落闸内。#1008 起壳 = registry
  // AlertDialog（缺省 initialFocus 入层，但落点不保证是 keep 钮），本 effect
  // 继续显式钉 keep 钮（hotkeys / dead-buttons 双面钉 toBeFocused）。父
  // effect 后于壳子树 effect 落子，开层提交后钮必已挂载。关层（继续编辑
  // 三路）焦点回 composer，还旧终态；drop 路关整 dialog，走 dialog 自身
  // 归还，不经此。
  const keepBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (discardOpen) keepBtnRef.current?.focus();
  }, [discardOpen]);
  const closeDiscard = () => {
    setDiscardOpen(false);
    specRef.current?.focus();
  };

  // XMON-87 续二:Tab 直接换项目(chip 上挂 Tab 提示 chip)。循环而不是开面
  // ——「直接切换」要的是按一下就换了,不是先弹列表再选;列表那条路(点 chip)
  // 原样留着。焦点不动:Tab 是打字途中的手势,搬焦点就把打字打断了。
  // 开态门三条:面板开着、至少两行、未保存闸确认层没起来。
  //  - 关着:hook 不注册,Tab 交还浏览器(同 ⌘↵ 的 opened-gate)。
  //  - 单项目:循环是空转,吃下 Tab 只会白挡走位,同样交还浏览器。
  //  - 确认层起来(open 仍为真,它是 dialog 之外的兄弟层 #318):这一层没有
  //    焦点陷阱,焦点仍停在 composer 这个「驾驶位」上。此时若不缺席,Tab 会被
  //    吃下换成项目,键盘用户就再也走不到「继续编辑 / 放弃并关闭」两个钮——
  //    键盘陷阱。README 的「仍能走到每一个控件」正是靠这一条成立。
  const cycleProject = useCallback(() => {
    if (rows.length < 2) return;
    const index = rows.findIndex((row) => row.id === selected?.id);
    const next = rows[(index + 1) % rows.length];
    if (next === undefined) return;
    setProjectId(next.id);
    if (rememberProject) writeRememberedProject(safeLocalStorage(), next.id);
  }, [rows, selected?.id, rememberProject]);
  useProjectCycleHotkey(open && !discardOpen && rows.length > 1, cycleProject);

  /** 上传委托运行器（#729：选件与粘贴共用）：attaching 计数跟踪（重叠
   *  上传保持保存闸关闭到最后一个落地）、返回 token 行原子注入 spec
   *  （caret=null = 尾追，#310 原形态）、React 提交后恢复 caret——仅当
   *  textarea 仍持有焦点，文件选择器往返不抢焦点。#757：本 run 的文件先进
   *  pending（占位卡片），落定/失败即清（与 attaching 计数同 finally）。 */
  const runAttachment = (files: File[], caret: number | null, also?: () => void) => {
    if (!onAttachment) {
      also?.();
      return;
    }
    attachInFlightRef.current += 1;
    setAttaching(true);
    const pendingUids = trackPending(files);
    void Promise.resolve(onAttachment(files))
      .then((tokens) => {
        if (tokens.length === 0) return;
        const inserted = insertAttachmentTokens(specMirrorRef.current, tokens, caret);
        pendingCaretRef.current = inserted.caret;
        setSpec(inserted.value);
        requestAnimationFrame(() => {
          const ta = specRef.current;
          const next = pendingCaretRef.current;
          pendingCaretRef.current = null;
          if (ta != null && next != null && document.activeElement === ta) {
            ta.setSelectionRange(next, next);
          }
        });
      })
      .catch((err) => {
        // 单文件失败已由父面 toast；委托整体 reject 是 bug——记日志，
        // 不静默吞（#729 失败方式 4）。
        console.error('attachment delegate failed', err);
      })
      .finally(() => {
        untrackPending(pendingUids);
        attachInFlightRef.current = Math.max(0, attachInFlightRef.current - 1);
        if (attachInFlightRef.current === 0) setAttaching(false);
        also?.();
      });
  };

  // M7 #310 附件选择回调：files → runAttachment（尾追注入）；reset value
  // 允许同文件再选（change 事件不重发同源）
  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    runAttachment(files, null);
  };

  // #729 剪贴板粘贴：文件走同一条 attachFile 链（父面 grant+upload），
  // token 行原子落 caret 位；混合剪贴板文件优先、文本忽略；纯文本粘贴
  // 事件不被触碰（preventDefault 只在见到文件后发生），行为零变化。
  const handleSpecPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttachment) return;
    const files = filesFromClipboardData(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    const counter = pastedNameCounterRef.current as PastedNameCounter;
    // 每 draft 编号：空 spec 且无在途上传时重置回 1；在途守门防快速
    // 连贴撞号（失败方式 6）。
    counter.begin(specMirrorRef.current.trim() === '');
    const caret = event.currentTarget.selectionStart ?? specMirrorRef.current.length;
    runAttachment(preparePastedFiles(files, counter), caret, () => counter.end());
  };

  // #814 有序列表自动续行：正文 textarea 的 plain Enter（无修饰键、
  // 非 IME 组合中）落在 `1. ` 行上时续编号/空项退 list，其余一律原生
  // 换行。修饰键 Enter（⌘↵ 保存并开始走 useChordHotkey 面）与 Shift+Enter
  // 永远不进这一支——它们保持各自的既有语义。
  const handleSpecKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.nativeEvent.isComposing) return;
    const ta = event.currentTarget;
    const continued = applyOrderedListEnter(ta.value, ta.selectionStart ?? ta.value.length);
    if (continued === null) return;
    event.preventDefault();
    setSpec(continued.value);
    const nextCaret = continued.caret;
    requestAnimationFrame(() => {
      if (document.activeElement === ta) ta.setSelectionRange(nextCaret, nextCaret);
    });
  };

  // spec 15 #394: 提交 = 正文 + 项目 id。
  // #729 失败方式 3：附件上传在途时阻提交——spec 不得带着还没上传完的
  // 附件离场（draft 保全，token 落地后提交照常）。
  const save = () => {
    if (attachInFlightRef.current > 0) return;
    onSave(spec, selected?.id);
  };

  // XMON-95：保存并开始 = 按钮点击与 ⌘↵ 共用的同一提交位。闸写在闭包里而
  // 非只靠按钮 disabled——键盘路径不经过 disabled 的点击拦截，漏这一句 ⌘↵
  // 会在空正文上落一个空任务。在途上传闸同律进闭包（#729）。
  const saveAndStart = () => {
    if (attachInFlightRef.current > 0) return;
    if (spec.trim() === '') return;
    if (onSaveAndStart) onSaveAndStart(spec, selected?.id);
    else save();
  };
  // enabled = open ∩ ¬discardOpen（useChordHotkey 的 opened-gate）。两条都
  // 缺不得：
  //  - open：面板关着时监听器不在 window 上，否则关掉的对话框仍会吃全站 ⌘↵。
  //  - ¬discardOpen：未保存闸确认层是 dialog **之外**的兄弟层（#318），它起来
  //    时 open 仍是 true，闸只认 open 的话 ⌘↵ 会在「要不要放弃？」这一问之下
  //    把任务**保存并开始**（真起一次 agent 跑）——用户按下时以为自己在回答
  //    那一问。确认层的两个按钮都不是可编辑目标，守卫也拦不住，只能由 enabled
  //    这一层缺席。
  useChordHotkey('enter', isEditableOutsideDialog, saveAndStart, open && !discardOpen);

  // #318 放弃并关闭:清表单 + 关 dialog(父收 open,重置 effect 兜底同律)
  const discardAndClose = () => {
    setDiscardOpen(false);
    setSpec('');
    onClose();
  };

  // Mention insert: route through insertMentionText so the picker
  // and the inline @ listbox share the spacing + caret rules (#728:
  // trailing space included). Multi-select inserts compose in ONE
  // functional update at the evolving caret — a per-token loop would
  // read the same stale `spec` closure per call and keep only the last
  // token (same fix as the composer wire's insertTokens).
  const insertTokens = (tokens: MentionToken[]) => {
    if (tokens.length === 0) return;
    const ta = specRef.current;
    if (ta == null) {
      setSpec((current) => {
        let value = current;
        for (const token of tokens) value = insertMentionText(value, token, null).value;
        return value;
      });
      return;
    }
    const start = ta.selectionStart ?? spec.length;
    const pending = { caret: start };
    setSpec((current) => {
      let value = current;
      let at = start;
      for (const token of tokens) {
        const result = insertMentionText(value, token, at);
        value = result.value;
        pending.caret = result.caret;
        at = result.caret;
      }
      return value;
    });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(pending.caret, pending.caret);
    });
  };

  const groups = mentionGroups ?? {
    todo: [],
    skill: [],
    agent: [],
    project: [],
    machine: [],
  };

  return (
    <>
      <DialogShell
        bare
        open={open}
        onClose={requestClose}
        // #1060：背板不再自持分支链——外点与 Esc / X 一样汇流 requestClose
        // （DialogShell 缺省 onClick=onClose），内层优先由汇流点双闸承载。
        // #318/#1008 分层 Esc：五个内层（picker / 项目 popover / 机器 popover /
        // discard 闸）全部走 registry 壳（Dialog / Popover / AlertDialog，
        // Base UI layer 栈 escapeKey isTopmost 自己收）。#1060 返工：层栈的
        // 接线窗（dismiss 监听/树节点挂被动 effect，落后于弹层 DOM 可见）会让
        // dialog 偶发误判自己是最上层——分层兜底从背板分支链上移到
        // requestClose 汇流点（双闸，见该处注记），覆盖全部关闭路径。
        // #682 机器 popover 是
        // 同族 chip 面（双开由开面互斥先行收掉，见两 chip Trigger 的
        // onClick）。#688 阶梯 --z-panel-low：本面板吃低档恒压常驻侧板
        // （--z-docked），抽屉开着时本面排上方；内层 registry 壳自带
        // z-50/--z-dialog 档，数值恒压本低档面板（e2e/z-ladder.spec 钉扎，
        // 阶梯 token 接法 = #983 横切待裁决面）。
        zIndex="var(--z-panel-low)"
        className="new-task-dialog"
        // #910 一级载体：bare 面缺省无可及名，title 只进 aria-label（不可见）——
        // getByRole('dialog', { name: '新建任务' }) 即本 dialog 的语义锚。
        title={t('新建任务')}
        width={672}
        height={439}
      >
        {/* #910 二级载体（结构钩子，无 role 可表达）：new-task-head /
            new-task-tools / new-task-project-chip / new-task-machine-dot /
            new-task-spec——dead-buttons #574 的 head↔close 几何对与工具簇
            计数、newtask 组的面板锚都吃这些 testid（#943 的 online-dot /
            column-count 同律）。 */}
        <div
          className="relative flex h-11 flex-none items-center border-b border-(--border) bg-(--popover) pr-1 pl-3"
          data-testid="new-task-head"
        >
          {/* #682 第三轮（用户三审）：标题行回归抓拍形态——项目 chip + 居中
              标题 + 关闭，机器选择搬去底栏选项区（执行选择与「保存并开始」
              同族）。项目名 max-width 截断（长名不压居中标题）。 */}
          <span className="relative flex items-center">
            {/* #176/#1008:anchored popover 家族律——#983 判决族拆退役，壳 =
                registry Popover（Esc 归 Base UI 嵌套 layer 栈不变；定位从
                wrap container + absolute CSS 迁 Positioner 参数 side=bottom
                align=start sideOffset=8 = 原「left-0 top calc(100%+8px)」）。
                空集不开面(live 无项目时提交走建默认项目路径)。选中回填
                chip,提交携带 projectId。#666 律:chip 是 toggle 面——
                initialFocus=false 焦点留触发位、toggle/aria-expanded 归
                Trigger 原语（旧双写 state 竞态根因消失）;外点关走原生
                outside-press（ClickCatcher 退役,穿透与否 = #983 遗留待
                原型实审裁决项）。Tab 提示 chip 换官网 Tooltip+Kbd 组合
                （#983 kbd-hint 判决;TooltipTrigger→PopoverTrigger→Button
                三层 render 复合,同一只 chip 钮）。 */}
            <Popover
              open={projectOpen && rows.length > 0}
              onOpenChange={(next: boolean, details) => {
                // #1060：外点自收先于 dialog 侧的一切关闭判定（元素级原生
                // 监听在委托根之前），置手势消费闸——同一次点击里汇流点不再落穿。
                if (!next && details.reason === 'outside-press') markGestureConsumed();
                setProjectOpen(next);
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          type="button"
                          className={PROJECT_CHIP_CLS}
                          data-testid="new-task-project-chip"
                          aria-haspopup="listbox"
                        />
                      }
                    />
                  }
                >
                  <span className="size-5 rounded-[6px] bg-(--project-avatar-bg) text-[11px] leading-5 text-center uppercase text-(--project-avatar-fg)">
                    {projectName.charAt(0).toLowerCase()}
                  </span>
                  <span className="new-task-project-name min-w-0 max-w-[220px] truncate text-[13px] leading-4 text-(--foreground)">
                    {projectName}
                  </span>
                  <ChevronDown width={12} height={12} />
                </TooltipTrigger>
                {/* XMON-87 续二:Tab 提示(#468 族);label 字面量沿 ⌘K/⌘J
                    先例,不做平台探测。side=right sideOffset=8 = 旧 chip
                    「图标右侧 8px、垂直居中」落位。 */}
                <TooltipContent side="right" sideOffset={8}>
                  <Kbd>Tab</Kbd>
                </TooltipContent>
              </Tooltip>
              <PopoverContent
                side="bottom"
                align="start"
                sideOffset={8}
                initialFocus={false}
                role="listbox"
                aria-label={t('项目')}
                className={PROJECT_MENU_CLS}
              >
                {rows.map((row) => (
                  <Button
                    key={row.id}
                    variant="ghost"
                    type="button"
                    className={OPTION_ROW_CLS}
                    role="option"
                    aria-selected={row.id === selected?.id}
                    onClick={() => {
                      setProjectId(row.id);
                      if (rememberProject) writeRememberedProject(safeLocalStorage(), row.id);
                      setProjectOpen(false);
                    }}
                  >
                    <span className="size-4 flex-none rounded-[5px] bg-(--project-avatar-bg) text-[9px] leading-4 text-center uppercase text-(--project-avatar-fg)">
                      {row.name.charAt(0).toLowerCase()}
                    </span>
                    <span className="new-task-project-row-name text-xs leading-4 text-(--foreground)">
                      {row.name}
                    </span>
                    {row.id === selected?.id && (
                      <span className="ml-auto flex text-(--card-button)">
                        <Check width={14} height={14} />
                      </span>
                    )}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </span>
          <div className="pointer-events-none absolute inset-x-0 text-center text-[13px] leading-4 font-medium text-(--foreground)">
            {t('新建任务')}
          </div>
          {/* A4-deep 收编：icon 变体皮肤；#948：28×28 + margin-left:auto 几何
              迁 utility（size-7 压件 icon 档 size-8——dead-buttons #574 回归
              钉 28×28 + 贴 head 右缘 4px）；hover 底走 motion.css #73 家族律
              （.new-task-close 在名单内，unlayered 恒压件配方）。#318 未保存
              闸:dialog 关闭走 requestClose(dirty 时先弹确认层)。 */}
          <Button
            variant="ghost"
            size="icon"
            className="new-task-close ml-auto size-7"
            aria-label={t('关闭')}
            onClick={requestClose}
          >
            <X />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col bg-(--card) px-4 pt-4 [&>.attachment-strip]:flex-none [&>.attachment-strip]:pb-2">
          {/* spec 15 #394：单字段正文——标题输入位移除,占位提示 = 五行模板族
              （首行即任务一句话,占位标题派生取它）。
              #948：裸 textarea 收编 Textarea 件（§5.3），件配方逐位中和回
              本面实测形——无边框无底无内垫的满幅编辑器（flex-1 min-h-0、
              field-sizing-fixed 挡件的自增长、focus 环清零：本面焦点常驻
              （开门 autofocus 落位），环是噪声；#814 tabular-nums 保编号
              列对齐。类名留 DOM（attachment-strip / composer-paste / hotkeys
              三 spec 的原生 textarea 断言与 fill 靶）。 */}
          <Textarea
            ref={focusSpecRef}
            data-testid="new-task-spec"
            className="new-task-spec min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-5 tabular-nums text-(--foreground) field-sizing-fixed placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent md:text-sm"
            placeholder={SPEC_TEMPLATE_LINES.map((line) => t(line)).join('\n')}
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={handleSpecKeyDown}
            // #729: clipboard images/files ride the #310 attachFile chain;
            // a text-only paste never reaches the handler's preventDefault.
            onPaste={handleSpecPaste}
          />
          {/* M7 #310 附件：原生文件多选触发器；选中文件 → onAttachment(files)
              委托父处理 grant+upload+setSpec 拼 token；accept 与 server
              ALLOWED_MIME_* 镜像（OS 文件选择器仍可越界,最终 server 强拒兜底） */}
          {/* deliberate-native（#855）：隐藏的文件选择触发器（display:none，
              编程式打开），可见皮肤在附件 Button 上；Input 原语是可见输入框
              皮肤，此处无可收编之物。 */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={onPickFiles}
            accept="text/*,image/*,application/json,application/pdf,application/xml"
          />
          {/* #757 附件 strip：在途占位 + 落定 chip（可点预览）。body 是 flex
              列，strip 挂正文与 footer 之间、空时零节点。 */}
          <AttachmentStrip draft={spec} pending={pendingAttachments} />
        </div>
        <div className="flex-none border-t border-(--border) bg-(--secondary) pt-[11px] pr-3 pb-3 pl-4">
          <div className="flex h-[30px] items-center">
            {/* A4-deep 收编：icon 变体皮肤；#948：30×30 几何迁 size-[30px]
                （原 .new-task-tools button 元素选择器，阶梯外一次性尺寸）。 */}
            <div className="flex items-center gap-1.5" data-testid="new-task-tools">
              {/* #304 C5 裁决:语音输入功能不做(local-first 无语音面)——
                  语音钮移除不渲染,不留死钮;添加附件/提及走 A4 Button 原语。 */}
              <Button
                variant="ghost"
                size="icon"
                className="size-[30px]"
                aria-label={t('添加附件')}
                disabled={attaching || !onAttachment}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-[30px]"
                aria-label={t('提及')}
                onClick={() => setPickerOpen((value) => !value)}
              >
                <Grid2x2 />
              </Button>
            </div>
            <div>
              {/* e2e 别名叠加：integration/test/m5-web-e2e.test.ts 钉
                  .new-task-start（overlays lane 误删致 CI 红，此处恢复；
                  类名与规则无关，纯选择器锚点） */}
              <Button
                variant="ghost"
                size="default"
                className="new-task-save"
                disabled={spec.trim() === ''}
                onClick={save}
              >
                {t('保存')}
              </Button>
              <Button
                size="default"
                className="new-task-start"
                disabled={spec.trim() === ''}
                onClick={saveAndStart}
              >
                {t('保存并开始')}
                {/* XMON-95 界面标识：常亮按键角标（kbd-hint 的 hover chip 是
                    另一面，这里要「看得到」，故静息可见）。落在 kbd.tsx 原语
                    上（COMPONENTS.md「文档正文里的按键角标用 kbd.tsx」），只把
                    registry 的尺寸/配色档逐项改写到本面：本钮是 default 档（实底 + 主题字），故边界/墨走
currentColor 系而非 border-border/muted-foreground。
                    aria-hidden：角标是视觉提示，按钮的可及名仍是文字本身。 */}
                <Kbd
                  aria-hidden="true"
                  className="ml-1.5 h-auto min-w-0 rounded-[3px] border border-current/35 bg-transparent px-[3px] py-px text-[11px] leading-4 font-normal text-current/90"
                >
                  {START_SHORTCUT_LABEL}
                </Kbd>
              </Button>
            </div>
          </div>
        </div>
      </DialogShell>
      {/* #318 未保存闸确认层(r9 §3.4 copy 逐字)。#1008（#983 判决：居中
          fixed 模态族 → Dialog，discard 走 AlertDialog）：壳 = registry
          AlertDialog（sibling root 不变），role=alertdialog / aria-modal /
          Esc 分层（Base UI layer 栈最顶先收）/ 外点关（modal 背板不穿透，
          旧 ClickCatcher 同语义）全归原语；手写 fade 200ms + slow 退场桥
          退役（#991 Q9 registry 动效默认赢）。焦点入层走件缺省（旧实测：
          焦点留 dialog 会让 Esc 被外层吃掉、确认层关不掉），keepBtnRef
          显式送焦照旧（hotkeys / dead-buttons 双面钉 keep 钮 toBeFocused）。
          #247 Tab 可达性不受损(焦点入层后 Tab 即达两个动作钮),Tab 循环/
          ⌘↵ 的 discardOpen 缺席门原样。 */}
      <AlertDialog
        open={discardOpen}
        onOpenChange={(next: boolean) => {
          if (!next) {
            // #1060：确认层自收（Esc/外点）同样消费本次手势——外层 dialog
            // 不得在同一次手势里跟着关（闸语义见 requestClose）。「放弃并
            // 关闭」走 discardAndClose 直连 onClose，不经本闸。
            markGestureConsumed();
            closeDiscard();
          }
        }}
      >
        <AlertDialogContent
          className={DISCARD_PANEL_CLS}
          aria-label={t('放弃新建任务？未保存的内容将丢失。')}
        >
          <div className="text-sm leading-5 font-medium text-(--foreground)">
            {t('放弃新建任务？未保存的内容将丢失。')}
          </div>
          <div className="flex h-[30px] items-center justify-end gap-2.5">
            {/* 原 .new-task-discard-keep：透明无框 12px 钮（ghost 七通道中和）。
                墨色换 muted-foreground：旧 --text-dim 亮模 on --dialog-bg 实测
                2.89:1，连正典给 dim 槽自留的 3:1 地板都不过（#943
                notify-banner 同病同治），按 #908 裁决 2 换消费面槽引用，
                token 值不动（contrast-948.md）。 */}
            <Button
              variant="ghost"
              size="default"
              className="new-task-discard-keep h-auto cursor-pointer justify-start gap-0 border-none bg-transparent p-0 text-xs leading-4 font-normal text-muted-foreground active:not-aria-[haspopup]:translate-y-0 hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent aria-expanded:bg-transparent aria-expanded:text-muted-foreground [&_svg:not([class*='size-'])]:size-auto"
              ref={keepBtnRef}
              onClick={closeDiscard}
            >
              {t('继续编辑')}
            </Button>
            <Button variant="destructive" size="default" onClick={discardAndClose}>
              {t('放弃并关闭')}
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {/* #311 mention picker(sibling layer)。Esc/backdrop 顺序见上分层注记。 */}
      <MentionPicker
        open={pickerOpen}
        onClose={() => {
          // #1060：内层自收 = 本次手势已被消费（闸语义见 requestClose）。
          markGestureConsumed();
          setPickerOpen(false);
        }}
        groups={groups}
        onInsert={(tokens) => {
          insertTokens(tokens);
          setPickerOpen(false);
        }}
      />
    </>
  );
}
