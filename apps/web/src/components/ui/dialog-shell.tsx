// DialogShell：Paper 对话框适配层（apps/web/DESIGN.md「弹窗与菜单」），组合
// registry dialog.tsx 件（DialogContent / DialogTitle / DialogDescription /
// DialogClose），皮肤住本层与 token，dialog.tsx 保持 pristine（S5）。
//
// Paper 面：sheet 纸面（--dialog-surface）、16px 角、1px 环 + 软投影
// （--dialog-shadow）；背板是 styles/app.css 的 [data-slot=dialog-overlay]
// 浅墨 dim（--dialog-backdrop，无 blur）。三档宽 S 400 / M 480 / L 640
// （--dialog-w-*，min(100% - 2rem, …) 收口移动端）。头 = 16px 衬线标题 +
// 可选 12px 副行 + 28px ghost 关闭钮；体是唯一滚动盒（min-h-0）；脚 =
// 左侧 12px 提示（hint，可缺省）+ 右侧操作，无底色带。
//
// 保住的行为契约：
// - #193 三段律：grid-rows auto / minmax(0,1fr) / auto，max-h = 100vh - 64px，
//   高表单滚字段不挤按钮；dialog-head / dialog-body / dialog-foot 结构
//   testid 原位（几何断言载体，spec/22 §5.5 二级）；
// - #1244 环房：体自带左右 20px 内边距，w-full 控件的 4px 焦点环落在滚动
//   盒内，不被裁；
// - #389 焦点回陷：finalFocus 直通 Popup；
// - #73 retained-mount：open flag 直通 Root；
// - #318 dismiss 分层：onOpenChange reason 闸（escape-key 转交
//   onEscapeWhileNested、嵌套期 outside-press 不关）；
// - #68 家族关闭律：Esc / 背板外点 / X 三路同归 onClose。
//
// viewportRoot / bare 两模式保留旧直连机制（search-panel / new-task-dialog
// 自带几何）；zIndex / onBackdropClick / width / height 只这两模式消费。

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { cn } from 'cn';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { Button } from './button.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog.js';

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

/** Paper 对话框面：sheet 纸面 + 16px 角 + --dialog-shadow（1px 环 + 软投影，
 *  ring-0 撤掉 registry 的 foreground/10 环）。 */
export const DIALOG_FACE =
  'rounded-(--edge-radius) bg-dialog-surface shadow-(--dialog-shadow) ring-0';

/** 三档宽（DESIGN.md 弹窗与菜单）：S = 密钥 / 删除确认 / 短表单，M = 技能与
 *  多数新建表单，L = 多步流程（添加机器、模型服务选择器）。 */
export type DialogSize = 's' | 'm' | 'l';

export function dialogWidth(size: DialogSize): string {
  return `min(100% - 2rem, var(--dialog-w-${size}))`;
}

/** 面板：Paper 面 + 三段 grid + 视口封顶。 */
export const DIALOG_PANEL_CLS = `grid max-h-[calc(100vh-64px)] max-w-none gap-0 overflow-hidden p-0 text-ui text-popover-foreground sm:max-w-none ${DIALOG_FACE}`;

/** 头：标题列，顶 18 / 左 20 / 底 4；右侧 52 让给角上的关闭钮。 */
export const DIALOG_HEAD_CLS = 'flex items-start gap-3 pt-4.5 pr-13 pb-1 pl-5';

export const DIALOG_TITLE_CLS =
  'font-heading text-heading leading-[1.4] font-medium text-foreground';

export const DIALOG_SUBTITLE_CLS = 'mt-0.5 text-meta text-content-tertiary';

/** 28px ghost 关闭钮，钉在面板右上角，ink-3 图标、hover 出浅底。DOM 里排在
 *  最后：Base UI 的初始焦点取第一个可聚焦元素，表单弹窗要落在首个字段上。 */
export const DIALOG_CLOSE_CLS =
  'absolute top-4 right-4 text-content-tertiary hover:text-foreground';

/** 体：唯一滚动盒。左右 20 内边距同时是焦点环的房间。 */
export const DIALOG_BODY_CLS = 'min-h-0 overflow-y-auto px-5 pt-3 pb-4';

/** 脚：提示靠左、操作靠右，无底色带。 */
export const DIALOG_FOOT_CLS = 'flex items-center gap-3 px-5 pt-3 pb-4';

export const DIALOG_HINT_CLS =
  'flex min-w-0 items-center gap-1.5 text-meta text-content-tertiary [&_svg]:size-3 [&_svg]:flex-none';

/** 分栏脚：左提示（可缺省）+ 右操作组。AlertDialogShell 与 DialogShell 共用。 */
export function DialogFootRow({ hint, children }: { hint?: ReactNode; children?: ReactNode }) {
  return (
    <div data-testid="dialog-foot" className={DIALOG_FOOT_CLS}>
      {hint != null && <div className={DIALOG_HINT_CLS}>{hint}</div>}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** 对话框主操作：Button default 档（墨底、32px）+ 8px 圆角；危险确认换
 *  destructive 档保危险 token。一个对话框只有一个。 */
export const DIALOG_PRIMARY_BUTTON = 'rounded-md text-ui';

/** 对话框次操作：文字按钮（Button ghost 档），hover 出浅底。 */
export const DIALOG_TEXT_BUTTON = 'gap-1.5 px-3 text-ui font-normal text-content-secondary';

/** 选择器 / ⌘K 的选中行：白卡 + 发丝环 + 极轻卡片投影，不铺 hover 色、不带
 *  赭红。 */
export const PICKER_ROW_SELECTED =
  'bg-card shadow-xs ring-1 ring-border hover:bg-card dark:hover:bg-card';

interface DialogShellProps {
  /** Header title; absent when `headerCenter` renders instead. */
  title?: string;
  /** Optional 12px sub-line under the title. */
  subtitle?: ReactNode;
  /** Centered header content (segmented tabs, r7 31). */
  headerCenter?: ReactNode;
  /** #73 retained-mount open flag; the exit fade outlives the close. */
  open?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions, right-aligned under the body scroll region (#193). */
  footer?: ReactNode;
  /** Muted 12px hint or status left of the actions (docs link, ⌘↵ hint,
   *  waiting status). Renders the footer row even without actions. */
  hint?: ReactNode;
  /** Per-face class on the panel. */
  className?: string;
  /** S 400 / M 480 / L 640 (bare panels too, unless `width` is set). */
  size?: DialogSize;
  /** bare: the consumer renders the whole panel (own head / body / foot). */
  bare?: boolean;
  /** Panel width in px — bare only. */
  width?: number;
  /** Panel height in px — bare only. */
  height?: number;
  /** Panel z-index — viewportRoot / bare only. */
  zIndex?: number | string;
  /** Custom backdrop click — viewportRoot / bare only. */
  onBackdropClick?: () => void;
  /** Esc while an inner layer is open: the shell does not close itself and
   *  hands the key to this callback. Base UI stops the Escape event, so an
   *  inner window listener never sees it. */
  onEscapeWhileNested?: () => void;
  /** #453 viewport-root variant: children carry their own fixed geometry. */
  viewportRoot?: boolean;
  /** Backdrop class (viewportRoot only). */
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
  subtitle,
  headerCenter,
  open = true,
  onClose,
  children,
  footer,
  hint,
  className,
  size = 'm',
  width,
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
      : 'fixed inset-0 flex items-center justify-center duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0';
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
                : `${SHELL_EXIT_BRIDGE_CLS}${className != null ? ` ${className}` : ''} fixed top-1/2 left-1/2 flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden ${DIALOG_FACE} text-ui text-popover-foreground outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`
            }
            style={
              viewportRoot
                ? { zIndex }
                : {
                    width: width ?? dialogWidth(size),
                    zIndex,
                    ...(height == null ? {} : { height }),
                  }
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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} modal>
      <DialogContent
        finalFocus={restore}
        showCloseButton={false}
        aria-label={title}
        data-size={size}
        style={{ width: dialogWidth(size) }}
        className={cn(
          DIALOG_PANEL_CLS,
          footer != null || hint != null
            ? 'grid-rows-[auto_minmax(0,1fr)_auto]'
            : 'grid-rows-[auto_minmax(0,1fr)]',
          className,
        )}
      >
        <div
          data-testid="dialog-head"
          className={cn(DIALOG_HEAD_CLS, headerCenter != null && 'items-center pl-13')}
        >
          {headerCenter != null ? (
            <div className="flex min-w-0 flex-1 justify-center">{headerCenter}</div>
          ) : (
            <div className="min-w-0 flex-1">
              {title != null && <DialogTitle className={DIALOG_TITLE_CLS}>{title}</DialogTitle>}
              {subtitle != null && (
                <DialogDescription className={DIALOG_SUBTITLE_CLS}>{subtitle}</DialogDescription>
              )}
            </div>
          )}
        </div>
        <div data-testid="dialog-body" className={DIALOG_BODY_CLS}>
          {children}
        </div>
        {(footer != null || hint != null) && <DialogFootRow hint={hint}>{footer}</DialogFootRow>}
        <DialogClose
          render={<Button variant="ghost" size="icon-sm" className={DIALOG_CLOSE_CLS} />}
          aria-label={t('关闭')}
        >
          <X width={16} height={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
