// Global hotkey wiring (issues #389, #442, #468, XMON-95): C opens the
// new-task dialog from any route (open-only, matching the row click
// semantics). ⌘J (Ctrl+J off macOS) toggles the chief drawer. That chord,
// Escape layer dismissal, and the drawer open/close commands live in
// gesture-machine.ts (#1267). The FAB click stays open-only. ⌘↵ (Ctrl+↵
// off macOS) fires the new-task dialog's 保存并开始 (XMON-95). Each
// remaining consumer hook registers one window keydown listener (the ⌘K
// useSearchState precedent). The chord path mirrors the ⌘K registration
// form: cmd and ctrl both accepted, main key compared case-insensitively.
// Guards keep native semantics intact: editable targets (input/textarea/
// select/contenteditable) swallow both keys — typing must never wake a
// surface. ⌘J's guard narrows that law to OUTSIDE the chief drawer: the
// open lands focus in the composer (a textarea), and a guard that swallows
// the chord inside the drawer it owns would make the toggle unable to
// close itself. Buttons and links still carry no native ⌘J semantics, so a
// focused control must not block the chord. XMON-87 adds the family's only
// binding that consumes a native browser key: Tab switches the new-task
// dialog's project from its two driving seats (the chip and the composer),
// with Shift+Tab left native as the keyboard way out of that seat.
//
// Two registration shapes, one chord implementation (XMON-95): the global
// keys are always live, while a *surface-scoped* chord (⌘↵ owns an open
// dialog) passes its surface's open flag as `enabled` — a listener left on
// the window while its surface is shut would fire into a form nobody can
// see. Both ride useChordHotkey; the guard is the per-surface half, and
// isEditableTarget is exported so a consuming face can narrow it to its own
// interior rather than re-deriving the editable selector.
//
// #645 puts the retired N (XMON-37) back as a *drawer-scoped bare key*: the
// chief drawer head's + (new thread) fires on N while the drawer is open.
// It rides useHotkey with the same enabled gate the scoped chords use —
// drawer shut, the listener is off the window and the global retirement
// holds. Its guard is the plain editable law, NOT ⌘J's drawer-interior
// exemption: N is an action key, and the open autofocuses the composer, so
// with the composer focused n types and the fire waits for a non-editable
// focus (a key the typist owns must never yank the view out from under it).

import { useEffect, useRef } from 'react';

/** 输入态：两键共用的守卫（票面「input/textarea/contenteditable 不触发」；
 *  select 同律——原生 typeahead 吃字符键，不可劫持）。导出给面级守卫复用
 *  ——消费点按「本面自己的可编辑内部」收窄这条律（XMON-95）。 */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

export const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && target.closest(EDITABLE) !== null;

/** ⌘J 专属守卫（#468 toggle 律）：输入态吞键收窄到 drawer 之外。drawer
 *  打开时 autofocus 落 composer（textarea），若守卫在 drawer 内部照吞，
 *  和弦就关不上自己打开的面。drawer 外的输入态（⌘K 搜索框等）维持原律
 *  ——hotkeys.spec 钉住「搜索框里 ⌘J 不得开 drawer」。类名出处 =
 *  chief-drawer.tsx 的 aside 根。 */
export const isEditableOutsideChiefDrawer = (target: EventTarget | null): boolean =>
  isEditableTarget(target) &&
  !(target instanceof HTMLElement && target.closest('.chief-drawer') !== null);

/** Tab 换项目（XMON-87 续二）的「驾驶位」：项目 chip 与 composer textarea。
 *  Tab 只在这两处被吃下换项目——其余控件（提及 / 保存 / 关闭）保留原生走位，
 *  纯键盘用户照旧能靠 Tab / Shift+Tab 走到每一个控件。
 *  类名出处 = new-task-dialog.tsx 的 chip 与 textarea。 */
const TAB_CYCLE_SEATS = ['.new-task-project', '.new-task-spec'];

const isTabCycleSeat = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  TAB_CYCLE_SEATS.some((selector) => target.closest(selector) !== null);

function useHotkey(
  key: string,
  guard: (target: EventTarget | null) => boolean,
  onOpen: () => void,
  enabled = true,
) {
  // #466 律（useChordHotkey 同形）：接线按 (key, enabled) 周期注册一次，永不
  // 按渲染注册——最新 guard/onOpen 走 ref。被动 effect 的清理与重挂之间隔着
  // 一整个调度周期，按渲染重挂会在这段缝里丢掉按键。
  const guardRef = useRef(guard);
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    guardRef.current = guard;
    onOpenRef.current = onOpen;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== key) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (guardRef.current(event.target)) return;
      // preventDefault only when we fire — guarded targets keep their native
      // default untouched.
      event.preventDefault();
      onOpenRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

/** useHotkey 的修饰键同族通路：cmd/ctrl + 主键触发（⌘K 搜索注册处的形态
 *  参照——双平台收、主键大小写不敏感，key 传小写）。onFire 语义由消费点
 *  定（⌘J = toggle，⌘↵ = 提交）。OS 按住连发（event.repeat）必须忽略
 *  ——toggle 会在连发下开↔关振荡，提交会在连发下落一串任务。
 *
 *  导出即复用面（XMON-95）：任何面要挂一条修饰键和弦，传 key + 本面的
 *  guard + onFire 即可，不必重写注册/守卫/preventDefault 三段。**面内和
 *  弦**（只在某个打开着的面上生效）把该面的 open 标志传进 enabled——面关
 *  着时监听器根本不在 window 上（opened-gate；缺省的常驻语义留给全局热
 *  键，如 C/⌘K/⌘J）。enabled 形参沿用 useEscClose 的 (handler, enabled)
 *  惯用位。 */
export function useChordHotkey(
  key: string,
  guard: (target: EventTarget | null) => boolean,
  onFire: () => void,
  enabled = true,
) {
  // #466 律（useEscClose 同法）：接线按 (key, enabled) 周期注册一次，永不
  // 按渲染注册——最新 guard/onFire 走 ref。被动 effect 的清理与重挂之间隔
  // 着一整个调度周期，按渲染重挂会在这段缝里丢掉按键；XMON-95 的消费点每
  // 敲一个字就重渲染一次，这个缝是必然而非偶发。
  const guardRef = useRef(guard);
  const onFireRef = useRef(onFire);
  useEffect(() => {
    guardRef.current = guard;
    onFireRef.current = onFire;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.repeat) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== key) return;
      if (guardRef.current(event.target)) return;
      // Consume the default wherever the press reaches the page, so a
      // browser action bound to the same chord (Firefox mac's downloads
      // library) cannot fire alongside the drawer.
      event.preventDefault();
      onFireRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, enabled]);
}

/** C → 新建任务 dialog（AppSidebar 全局面；行点击与热键共用一个 opener）。
 *  字符键而非和弦：与 ⌘K 搜索、⌘J 总管三键同在守卫族下——输入态吞键，
 *  其余场合裸按即开。 */
export function useNewTaskHotkey(onOpen: () => void): void {
  useHotkey('c', isEditableTarget, onOpen);
}

/** N → 总管新主题（#645）：抽屉头部 + 的裸键同族，作用域 = 抽屉开态（enabled
 *  门，useProjectCycleHotkey 的 active 先例——面关着监听器根本不在 window
 *  上，XMON-37 的全局退役律照旧成立）。守卫 = _plain_ 输入态律，不带 ⌘J 的
 *  drawer 内豁免：N 是动作键不是和弦，开抽屉的 autofocus 落 composer，聚焦
 *  时 n 归打字员，触发等一个非可编辑焦点。 */
export function useChiefNewThreadHotkey(active: boolean, onNewThread: () => void): void {
  useHotkey('n', isEditableTarget, onNewThread, active);
}

/** Tab → 新建任务 dialog 换项目（XMON-87 续二；chip 上挂 Tab 提示 chip）。
 *  与 C / ⌘J 两条裸键同族，但它是唯一一条吃掉浏览器原生语义的绑定：Tab
 *  换项目之后就不再走位了。三处收窄，缺一不可——
 *  - 只在驾驶位（chip / composer textarea）吃：别处的 Tab 原样走位；
 *  - 带修饰键的不吃：⌘Tab（切窗）、Ctrl+Tab（切标签页）、Alt+Tab 是系统的；
 *  - Shift+Tab 留给原生反向走位：Tab 既然被「换项目」占用，它就是纯键盘用户
 *    离开驾驶位的出口，一并不吃等于把这面变成鼠标专属。
 *  active = 面的开态门（dialog 关着、或项目不足两行时不注册——单项目循环是
 *  空转，吃下 Tab 只会白挡走位）。 */
export function useProjectCycleHotkey(active: boolean, onCycle: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!isTabCycleSeat(event.target)) return;
      event.preventDefault();
      onCycle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onCycle]);
}

export function useQuickEntryHotkey(onOpen: () => void): void {
  const onOpenRef = useRef(onOpen);
  useEffect(() => {
    onOpenRef.current = onOpen;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      onOpenRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
