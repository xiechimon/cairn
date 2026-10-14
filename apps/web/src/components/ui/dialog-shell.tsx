// DialogShell 零皮肤适配层（#983 判决：改写为零皮肤适配层；地图 #980
// 前提②④）：对外 API 与旧壳逐参数兼容，常规面（17 挂载点）内部组合
// registry dialog.tsx 件——面板/背板/头/脚皮肤一律 registry 默认
// （DialogContent rounded-xl p-4 grid gap-4 ring-1 duration-100、
// DialogOverlay bg-black/10 + backdrop-blur-xs、DialogHeader/DialogTitle、
// DialogFooter border-t bg-muted/50 band），本层不再持任何皮肤串。
//
// 保住的行为契约（直通 Base UI props / layout 类承载）：
// - #193 三段律：DialogContent 吃 layout 类——封顶 max-h = 100vh - 48px +
//   grid-rows auto/minmax(0,1fr)/auto；dialog-head / dialog-body /
//   dialog-foot 三个结构 testid 原位在（几何断言需要结构盒，role-scope
//   隔离不出滚动容器，spec/22 §5.5 二级载体）。高表单挤不出提交钮；
// - #389 焦点回陷：finalFocus 直通 Popup（不经 Base UI 的 trigger 推定，
//   仓内触发钮多在 dialog 树外）；
// - #73 retained-mount：open flag 直通 Root，退场淡出活得过 close；
// - #318 dismiss 分层：onOpenChange reason 闸原样（escape-key 转交
//   onEscapeWhileNested、嵌套期 outside-press 不关）；
// - #68 家族关闭律：Esc / 背板外点 / X 三路同归 onClose（外点与 Esc 走
//   Base UI 原生 dismiss，X 走 DialogClose）；
// - width 入参 = layout 位（#983 判决：448/560/640 宽度归消费点布局）——
//   style width = min(100% - 2rem, Npx)，移动端收口与 registry
//   max-w-[calc(100%-2rem)] 配方等值；z 档 registry z-50 与 --z-dialog
//   同值（tokens.css #688 阶梯 50），常规面不再传 zIndex。
//
// viewportRoot / bare 两模式保留旧直连机制**原样不动**：它们是 #983 判决
// 点名的「适配层只语义映射」判据压力点（search-panel / new-task-dialog，
// 面归 L5 车道），去留（留在适配层 vs 降级为消费点自组合 registry
// Dialog）在 L5 原型实审裁决；本层不预判。zIndex / backdropClassName /
// onBackdropClick 入参仅这两模式消费。
//
// i18n：关闭钮 aria-label 走 t('关闭')（registry 内建 close 的 sr-only
// 文案是英文硬编码，语义映射归适配层）；形态与内建钮逐类同形
// （ghost icon-sm，absolute top-2 right-2）。

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { Button } from './button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog.js';

/** 退场 visibility 桥（§5.4 机制内联，原 .dlg-shell 配方）：零视觉的
 *  visibility 延迟过渡撑住 Base UI 的卸载窗，让面板 animate-out 播完再卸。
 *  仅 viewportRoot/bare 旧机制路径消费；常规面走 registry duration-100
 *  默认退场（#991 Q9：动效 = base-nova 形态一部分）。 */
const SHELL_EXIT_BRIDGE_CLS =
  '[transition:visibility_0s_linear_var(--dur-overlay)] data-[ending-style]:invisible';

/** 视口根容器的机制（§5.4 机制内联，原 .dlg-viewport 配方）：铺满视口但不吃
 *  点击（外点落回 scrim），子级经 `> *` 收回点击；visibility 桥走 --dur-fast
 *  档（视口根面板的进场是 100ms 的 VIEWPORT_POP_ANIM）。 */
const VIEWPORT_MECHANISM_CLS =
  'fixed inset-0 pointer-events-none [&>*]:pointer-events-auto [transition:visibility_0s_linear_var(--dur-fast)] data-[ending-style]:invisible';

/** 视口根面（viewportRoot）面板的进场（V2 覆写，base-ui-theme §1.2：
 *  scale .98 + fade、100ms ease-out）。挂在**面板**上、经视口根 Popup 的
 *  具名 group 读 Base UI 开态——视口根 Popup 是铺满视口的包装层，transform
 *  上它会把面板（fixed 子级）的 containing block 拽走（#656）。 */
export const VIEWPORT_POP_ANIM =
  'duration-100 ease-out group-data-open/dlgvp:animate-in group-data-open/dlgvp:fade-in-0 group-data-open/dlgvp:zoom-in-98';

interface DialogShellProps {
  /** Left header title; absent when `headerCenter` renders instead. */
  title?: string;
  /** Centered header content (segmented tabs, r7 31). */
  headerCenter?: ReactNode;
  /** #73 retained-mount open flag; the exit fade outlives the close. */
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** #193: pinned below the body scroll region — submit/cancel rides here so
   *  a tall form scrolls the fields, never the buttons. 常规面渲染进
   *  registry DialogFooter（band 皮肤件自带）——消费点给裸内容即可，
   *  自携 padding 包装会与 band 的 p-4 叠垫。 */
  footer?: ReactNode;
  /** #309: face class on the panel — per-face utility recipes and the e2e
   *  handle discipline without touching the family base. */
  className?: string;
  /** Panel width in px (defaults to 448 = family law #68); M7 #312 review
   *  dialog uses 560. 常规面 = layout 位（min() 收口，见头注）。 */
  width?: number;
  /** bare：面板内容由消费者全权渲染（自带头/体/底），适配层只出壳机制与
   *  皮肤——new-task-dialog 的面板几何（672×439 + 自定义头）自成一体。
   *  L5 实审压力点，旧机制原样（见头注）。 */
  bare?: boolean;
  /** 面板高度 in px（bare 面用；家族缺省按内容自适应）。 */
  height?: number;
  /** 面板 z-index——仅 viewportRoot/bare 旧机制路径消费（常规面 =
   *  registry z-50 ≡ --z-dialog 档，#688 阶梯）。 */
  zIndex?: number | string;
  /** 背板点击的自定义处置——仅 viewportRoot/bare 旧机制路径消费（常规面
   *  外点走 Base UI 原生 dismiss → onClose）。 */
  onBackdropClick?: () => void;
  /** 内层浮层开着时的 Esc 处置（等价旧壳手写的分层 Esc）。**必须由壳代收**：
   *  Base UI 处理 Esc 时会拦下事件，仓内内层的 window 监听收不到。传了本
   *  回调即表示「现在有内层开着」——壳不关自己，转交本回调（由消费者决定
   *  关哪层）。 */
  onEscapeWhileNested?: () => void;
  /** #453 视口根变体：壳不出面板几何，children 自带 fixed 几何。**开它是
   *  内容全权**：`width` / `height` / `footer` / `headerCenter` / `bare`
   *  一并失效。L5 实审压力点，旧机制原样（见头注）。 */
  viewportRoot?: boolean;
  /** Backdrop 位类名入参（只作用于视口根态）。 */
  backdropClassName?: string;
}

/** 触发位记忆（#389 回陷契约）：关闭态持续记住"最后一个对话框之外的活动元素"，
 *  关闭时归还。开态不记（那时的 activeElement 已在层内）；也不经 Base UI 的
 *  trigger 推定——仓内触发钮多在 dialog 树外。
 *  #1037 修采样机制：旧实现靠「每次渲染读一遍 activeElement」，而「点击触发钮
 *  开层」路径上 mousedown 落焦到 open=true 提交之间通常没有任何渲染——origin
 *  停在挂载时的 body，Esc 后焦点掉回 body（schedules 顶栏钮实测）；此前通过的
 *  面（sidebar 新建任务）只是恰好有焦点/悬停引发的中间渲染，是巧合不是机制。
 *  改走 focusin 事件跟踪：关闭态的每次焦点移动都被记录，与渲染时序解耦。
 *  body 不记——它不是可归还的触发位（元素移除后焦点回落 body 不得覆盖真值）。 */
function useReturnFocus(open: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const record = () => {
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        el !== document.body &&
        el.closest('[data-slot="dialog-content"]') == null
      ) {
        origin.current = el;
      }
    };
    record();
    document.addEventListener('focusin', record);
    return () => document.removeEventListener('focusin', record);
  }, [open]);
  const restore = useCallback(() => {
    origin.current?.focus();
  }, []);
  return { restore };
}

export function DialogShell({
  title,
  headerCenter,
  open = true,
  onClose,
  children,
  footer,
  className,
  width = 448,
  height,
  bare = false,
  zIndex = 'var(--z-dialog)',
  onBackdropClick,
  onEscapeWhileNested,
  viewportRoot = false,
  backdropClassName,
}: DialogShellProps) {
  const { t } = useI18n();
  const { restore } = useReturnFocus(open);

  // #318 dismiss 分层闸（两路径共用）：内层浮层开着时，壳不吃 Esc / 外点
  // （让内层自己收）。
  const handleOpenChange = (next: boolean, details?: { reason?: string }) => {
    if (next) return;
    if (details?.reason === 'escape-key' && onEscapeWhileNested != null) {
      onEscapeWhileNested();
      return;
    }
    if (onEscapeWhileNested != null && details?.reason === 'outside-press') {
      return;
    }
    onClose();
  };

  // ── viewportRoot / bare：旧直连机制原样保留（L5 实审压力点，见头注）──
  if (viewportRoot || bare) {
    // 背板 = 面板减一档（#688 阶梯）：数字档直接减，令牌档走 calc——z-index
    // 是 <integer> 槽，calc 整数运算合法且 computed value 归一成数字。
    const backdropZ = typeof zIndex === 'number' ? zIndex - 1 : `calc(${zIndex} - 1)`;
    // 只视口根态吃 backdropClassName：bare 态的类串保持逐字不动。
    const backdropClass = viewportRoot
      ? `fixed inset-0${backdropClassName == null ? '' : ` ${backdropClassName}`}`
      : 'fixed inset-0 flex items-center justify-center bg-black/60 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0';
    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} modal>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop
            data-slot="dialog-overlay"
            style={{ zIndex: backdropZ }}
            className={backdropClass}
            onClick={onBackdropClick ?? onClose}
          />
          <DialogPrimitive.Popup
            data-slot="dialog-content"
            // #389：关闭后归还触发位（Base UI 的 finalFocus），不经 trigger 推定
            finalFocus={restore}
            className={
              viewportRoot
                ? // 具名 group：视口根面板经 group-data-open/closed/dlgvp 读本 Popup
                  // 的开闭态（VIEWPORT_POP_ANIM）；transform 不上包装层（#656）。
                  `${VIEWPORT_MECHANISM_CLS} group/dlgvp${className != null ? ` ${className}` : ''}`
                : `${SHELL_EXIT_BRIDGE_CLS}${className != null ? ` ${className}` : ''} fixed top-1/2 left-1/2 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`
            }
            style={
              viewportRoot ? { zIndex } : { width, zIndex, ...(height == null ? {} : { height }) }
            }
            // 视口根态：容器是纯管道，dialog 语义由面内自己的 role 承载——
            // 容器不抢名，面内的 role/aria-label 就是这一层的 a11y 身份。
            // 默认态的 'dialog' 是复述（Base UI 的默认值就是它），不是冗余：
            // mergeProps 用 for...in 覆盖外部 props，`role={undefined}` 会把
            // store 的默认值一并抹掉，两态必须各给一个实值。
            role={viewportRoot ? 'presentation' : 'dialog'}
            aria-label={viewportRoot ? undefined : title}
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  // ── 常规面：组合 registry dialog.tsx（零皮肤，#983 判决）──
  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        // #389：关闭后归还触发位（finalFocus 经 DialogContent 直通 Popup）。
        finalFocus={restore}
        showCloseButton={false}
        aria-label={title}
        style={{ width: `min(100% - 2rem, ${width}px)` }}
        className={cn(
          // layout 位：#193 封顶 + 三段 grid（body 是真滚动容器）；宽度经
          // style min() 收口，故解除 registry 的 max-w 两档。
          'max-h-[calc(100vh-48px)] max-w-none sm:max-w-none',
          footer != null ? 'grid-rows-[auto_minmax(0,1fr)_auto]' : 'grid-rows-[auto_minmax(0,1fr)]',
          className,
        )}
      >
        <DialogHeader
          data-testid="dialog-head"
          className={headerCenter != null ? 'items-center' : undefined}
        >
          {headerCenter != null ? (
            headerCenter
          ) : title != null ? (
            <DialogTitle>{title}</DialogTitle>
          ) : null}
        </DialogHeader>
        {/* ring 房：body 是滚动容器（overflow-y-auto ⇒ 两轴都裁），w-full
            控件的 focus 环（#1244：2px outline + offset 2 = 外沿 4px）会贴到
            裁切缘被左右各切一刀。负边距把滚动区外扩到 DialogContent 的 p-4
            垫层（裁切缘 = 对话框内缘），px-4 把内容顶回原位：内容几何零漂移，
            环不再被裁。 */}
        <div data-testid="dialog-body" className="-mx-4 min-h-0 overflow-y-auto px-4">
          {children}
        </div>
        {footer != null && <DialogFooter data-testid="dialog-foot">{footer}</DialogFooter>}
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
          aria-label={t('关闭')}
        >
          <X width={16} height={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
