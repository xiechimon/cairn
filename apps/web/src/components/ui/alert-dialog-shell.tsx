// AlertDialogShell 适配层（#425 B1）：仓内确认面的共用底座。原三处
// （delete-confirm / delete-project-confirm / new-task-discard）各自手搓
// OverlayMount + useEscClose，现统一走 Base UI AlertDialog。
//
// **与 #420 决议的一处显式接线**：Base UI 的 AlertDialog 默认「Esc 与外点
// 不关」（阻断语义），而仓内确认面的既有契约是**三路径可关**（X / Esc /
// 背板，picker 与 delete-confirm 系列 spec 逐条钉死）。故本层显式接管：
// Popup 上挂 Escape、Backdrop 上挂外点——语义仍是 alertdialog（role + 焦点
// 圈定 + 不可误触的默认），只是把"可关"这一条接回来。
//
// .delete-confirm 族 / .overlay-backdrop 类名原样输出（零规则的 e2e 句柄）；
// 原 .dlg-shell 的退场 visibility 桥随 ui/dialog.css 退役内联成 utility
// （#952，dialog-shell.tsx 的 SHELL_EXIT_BRIDGE_CLS 同款配方）。

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { useEscClose } from '../../overlay/use-esc.js';
import { Button } from './button.js';

interface AlertDialogShellProps {
  /** Head title — the caller's canon copy (任务: 确定删除该任务…). */
  title: string;
  /** Dialog aria-label (任务: 删除任务). */
  ariaLabel: string;
  /** #73: retained-mount open flag — the exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Panel 上的 per-face 修饰类（几何补丁，如 pb-4）. */
  className?: string;
  /** Panel width in px (448 = 家族律 #66). */
  width?: number;
}

export function AlertDialogShell({
  title,
  ariaLabel,
  open,
  onClose,
  children,
  className,
  width = 448,
}: AlertDialogShellProps) {
  const { t } = useI18n();
  // 接管 Esc（AlertDialog 默认不关）：仓内确认面契约的键盘路径。
  // #466：走 useEscClose 的 open 周期注册（onClose 走 ref）——消费点全传
  // 内联箭头，按渲染重挂会在重渲染窗口内丢 Esc（#462 症状 2 同根因）。
  useEscClose(onClose, open);

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop
          data-slot="alert-dialog-overlay"
          className="overlay-backdrop fixed inset-0 bg-black/60 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          // 接管外点（AlertDialog 默认不关）：背板点击 = 关
          onClick={onClose}
        />
        <AlertDialogPrimitive.Popup
          role="alertdialog"
          data-slot="alert-dialog-content"
          className={`delete-confirm [transition:visibility_0s_linear_var(--dur-overlay)] data-[ending-style]:invisible${className != null ? ` ${className}` : ''} fixed top-1/2 left-1/2 z-(--z-dialog) flex max-h-[calc(100vh-48px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-(--edge-radius) bg-popover text-sm text-popover-foreground shadow-(--dialog-shadow) ring-1 ring-foreground/10 outline-none duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95`}
          style={{ width }}
          aria-label={ariaLabel}
        >
          <div className="relative flex h-12 flex-none items-center border-b border-border px-4">
            <div className="delete-confirm-title text-sm font-medium text-foreground">{title}</div>
            <AlertDialogPrimitive.Close
              className="delete-confirm-close absolute right-3 flex size-6 items-center justify-center rounded-md text-muted-foreground"
              aria-label={t('关闭')}
              onClick={onClose}
            >
              <X width={16} height={16} />
            </AlertDialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/** 确认面底栏（取消 + 危险动作）：两个 confirm 面共用，类名别名透传。 */
export function AlertDialogActions({
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmClassName,
}: {
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmClassName?: string;
}) {
  return (
    <div className="flex flex-none items-center justify-end gap-2 px-4 py-3">
      <Button variant="ghost" className="delete-confirm-cancel" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        variant="destructive"
        size="default"
        className={confirmClassName ?? 'delete-confirm-delete'}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}
