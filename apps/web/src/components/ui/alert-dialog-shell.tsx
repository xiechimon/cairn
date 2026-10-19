// AlertDialogShell 适配层（#425 B1）：仓内确认面的共用底座，走 Base UI
// AlertDialog；面、头、体、脚与 DialogShell 同一套 Paper 件（dialog-shell.tsx
// 的 DIALOG_* 类与 DialogFootRow），缺省 S 档 400 宽。
//
// **与 #420 决议的一处显式接线**：Base UI 的 AlertDialog 默认「Esc 与外点
// 不关」（阻断语义），而仓内确认面的既有契约是**三路径可关**（X / Esc /
// 背板，picker 与 delete-confirm 系列 spec 逐条钉死）。故本层显式接管：
// Popup 上挂 Escape、Backdrop 上挂外点——语义仍是 alertdialog（role + 焦点
// 圈定 + 不可误触的默认），只是把"可关"这一条接回来。
//
// .delete-confirm 族 / .overlay-backdrop 类名原样输出（零规则的 e2e 句柄）；
// 背板皮肤 = styles/app.css 的 [data-slot=alert-dialog-overlay] 浅墨 dim。

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { X } from '../../icons/index.js';
import { useEscClose } from '../../overlay/use-esc.js';
import { Button } from './button.js';
import {
  DIALOG_BODY_CLS,
  DIALOG_CLOSE_CLS,
  DIALOG_HEAD_CLS,
  DIALOG_PANEL_CLS,
  DIALOG_PRIMARY_BUTTON,
  DIALOG_SUBTITLE_CLS,
  DIALOG_TEXT_BUTTON,
  DIALOG_TITLE_CLS,
  DialogFootRow,
  type DialogSize,
  dialogWidth,
} from './dialog-shell.js';

interface AlertDialogShellProps {
  /** Head title — the caller's canon copy (任务: 确定删除该任务…). */
  title: string;
  /** Optional 12px sub-line under the title. */
  subtitle?: ReactNode;
  /** Dialog aria-label (任务: 删除任务). */
  ariaLabel: string;
  /** #73: retained-mount open flag — the exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  /** Body content. */
  children: ReactNode;
  /** Footer actions (usually AlertDialogActions), right-aligned. */
  footer: ReactNode;
  /** Muted 12px hint left of the actions. */
  hint?: ReactNode;
  className?: string;
  size?: DialogSize;
}

export function AlertDialogShell({
  title,
  subtitle,
  ariaLabel,
  open,
  onClose,
  children,
  footer,
  hint,
  className,
  size = 's',
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
          className="overlay-backdrop fixed inset-0 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          // 接管外点（AlertDialog 默认不关）：背板点击 = 关
          onClick={onClose}
        />
        <AlertDialogPrimitive.Popup
          role="alertdialog"
          data-slot="alert-dialog-content"
          data-size={size}
          className={cn(
            'delete-confirm fixed top-1/2 left-1/2 z-(--z-dialog) grid-rows-[auto_minmax(0,1fr)_auto] -translate-x-1/2 -translate-y-1/2 outline-none [transition:visibility_0s_linear_var(--dur-overlay)] duration-200 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-[ending-style]:invisible',
            DIALOG_PANEL_CLS,
            className,
          )}
          style={{ width: dialogWidth(size) }}
          aria-label={ariaLabel}
        >
          <div data-testid="dialog-head" className={DIALOG_HEAD_CLS}>
            <div className="min-w-0 flex-1">
              {/* 纯 div：Base UI 的 Title 会挂 aria-labelledby，压过调用方给的
                  ariaLabel（确认面的可及名是「删除任务」而不是标题全句）。 */}
              <div className={cn('delete-confirm-title', DIALOG_TITLE_CLS)}>{title}</div>
              {subtitle != null && (
                <AlertDialogPrimitive.Description className={DIALOG_SUBTITLE_CLS}>
                  {subtitle}
                </AlertDialogPrimitive.Description>
              )}
            </div>
          </div>
          <div data-testid="dialog-body" className={DIALOG_BODY_CLS}>
            {children}
          </div>
          <DialogFootRow hint={hint}>{footer}</DialogFootRow>
          <AlertDialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('delete-confirm-close', DIALOG_CLOSE_CLS)}
              />
            }
            aria-label={t('关闭')}
            onClick={onClose}
          >
            <X width={16} height={16} />
          </AlertDialogPrimitive.Close>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

/** 确认面操作组（取消 + 危险动作），放进 AlertDialogShell 的 footer。 */
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
    <>
      <Button
        variant="ghost"
        className={`delete-confirm-cancel ${DIALOG_TEXT_BUTTON}`}
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        variant="destructive"
        size="default"
        className={`${confirmClassName ?? 'delete-confirm-delete'} ${DIALOG_PRIMARY_BUTTON}`}
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </>
  );
}
