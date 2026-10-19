// Centered modal overlays of the detail route (issue #75, r8 56/74/75):
// the 开始任务 rerun dialog and the 复用方案 sub-panel (back arrow +
// centered prompt + 查看方案/直接执行).
// #640（r14 §5.7 前置裁决落地，用户 2026-10-02）：开始任务不再给选择——
// 本 dialog 只剩 failed 重跑面：重跑（= 编排回合）+ — 仅当失败轮持有方案
// 文档（r8 §3.4）— 复用方案 第三钮。fixture 面保持静态：无 onRerun/onReuse
// 时钮无 wire。
//
// 组合 registry dialog.tsx 件 + Paper 面（dialog-shell 的 DIALOG_* 件，
// S 档），三路可关（X / Esc / 背板外点，#168 家族关闭律）归 Base UI 原生
// dismiss。.overlay* 别名类随形透传（e2e 句柄）。

import { Button } from '../components/ui/button.js';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '../components/ui/dialog.js';
import {
  DIALOG_BODY_CLS,
  DIALOG_CLOSE_CLS,
  DIALOG_HEAD_CLS,
  DIALOG_PANEL_CLS,
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DIALOG_TITLE_CLS,
  DialogFootRow,
  dialogWidth,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, X } from '../icons/index.js';

/** #168: the rerun/reuse pair joins the dialog family close law — Esc,
 *  backdrop click, and the X head button all carry the same `onClose`
 *  (dismiss the whole overlay); `back` stays the explicit step-back
 *  affordance. Mount/unmount is conditional at the call site. Paper S 档
 *  面（dialog-shell 的 DIALOG_* 件）；back 钮住头里，走 onBack 而非
 *  DialogClose。.overlay* 别名透传（e2e 句柄）。 */
function OverlayDialog({
  onClose,
  title,
  back,
  onBack,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  back?: boolean;
  onBack?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      modal
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        style={{ width: dialogWidth('s') }}
        data-size="s"
        className={`overlay overlay-panel grid-rows-[auto_minmax(0,1fr)_auto] ${DIALOG_PANEL_CLS}`}
      >
        <div data-testid="dialog-head" className={`${DIALOG_HEAD_CLS} items-center`}>
          {back === true && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="overlay-back -ml-1.5 flex-none text-content-tertiary"
              aria-label={t('返回')}
              onClick={onBack}
            >
              <ChevronLeft width={16} height={16} />
            </Button>
          )}
          <DialogTitle className={`overlay-title min-w-0 flex-1 ${DIALOG_TITLE_CLS}`}>
            {title}
          </DialogTitle>
        </div>
        <div data-testid="dialog-body" className={DIALOG_BODY_CLS}>
          {children}
        </div>
        {footer != null && (
          <div className="overlay-actions">
            <DialogFootRow>{footer}</DialogFootRow>
          </div>
        )}
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={`overlay-close ${DIALOG_CLOSE_CLS}`}
              aria-label={t('关闭')}
            />
          }
        >
          <X width={16} height={16} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/** 开始任务 dialog —— #640 起只剩 failed 重跑面（待开始相位的开始入口
 *  不经 dialog，直发总管编排回合）：一行说明 + 重跑（= 编排回合）；
 *  `reuse`（失败轮持有方案文档，r8 §3.4）加 复用方案 主钮并把重跑降为
 *  outline 次钮（老 ghost+描边形的 registry variant 对应）。 */
export function RerunDialog({
  reuse,
  onClose,
  onRerun,
  onReuse,
}: {
  reuse: boolean;
  /** #168: family close law — X / Esc / backdrop all dismiss. */
  onClose: () => void;
  /** live 面：重跑 = POST /todos/:id/orchestrate（总管编排回合）；缺省 =
   *  fixture 静态面（钮无 wire）。 */
  onRerun?: () => void;
  onReuse?: () => void;
}) {
  const { t } = useI18n();
  return (
    <OverlayDialog
      onClose={onClose}
      title={t('开始任务')}
      footer={
        <>
          <Button
            variant={reuse ? 'ghost' : 'default'}
            className={reuse ? DIALOG_TEXT_BUTTON : DIALOG_PRIMARY_BUTTON}
            onClick={onRerun}
          >
            {t('重跑')}
          </Button>
          {reuse && (
            <Button className={DIALOG_PRIMARY_BUTTON} onClick={onReuse}>
              {t('复用方案')}
            </Button>
          )}
        </>
      }
    >
      <div className="text-ui text-content-secondary">{t('这张任务将交给总管重新编排。')}</div>
    </OverlayDialog>
  );
}

/** 复用方案 sub-panel (r8 75): independent dialog face, back arrow returns
 *  to the rerun dialog. */
export function ReusePanel({
  onClose,
  onBack,
  onView,
  onDirect,
}: {
  /** #168: family close law — X / Esc / backdrop all dismiss; `back` stays
   *  the explicit step-back to the rerun face. */
  onClose: () => void;
  onBack?: () => void;
  onView?: () => void;
  onDirect?: () => void;
}) {
  const { t } = useI18n();
  return (
    <OverlayDialog
      onClose={onClose}
      title={t('复用方案')}
      back
      onBack={onBack}
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onView}>
            {t('查看方案')}
          </Button>
          <Button className={DIALOG_PRIMARY_BUTTON} onClick={onDirect}>
            {t('直接执行')}
          </Button>
        </>
      }
    >
      <div className="text-ui text-content-secondary">{t('选择接下来如何使用这个方案')}</div>
    </OverlayDialog>
  );
}
