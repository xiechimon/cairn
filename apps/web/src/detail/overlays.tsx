// Centered modal overlays of the detail route (issue #75, r8 56/74/75):
// the 开始任务 rerun dialog and the 复用方案 sub-panel (back arrow +
// centered prompt + 查看方案/直接执行).
// #640（r14 §5.7 前置裁决落地，用户 2026-10-02）：开始任务不再给选择——
// 本 dialog 只剩 failed 重跑面：重跑（= 编排回合）+ — 仅当失败轮持有方案
// 文档（r8 §3.4）— 复用方案 第三钮。fixture 面保持静态：无 onRerun/onReuse
// 时钮无 wire。
//
// #1006 原型（#980 前提②④；#983「居中 fixed 模态族 → Dialog」同族判例）：
// #75 自建的 Overlay/PanelHead 手写壳（裸 div scrim + window Esc 监听，无
// 焦点圈定/滚动锁/退场动效）退役，组合 registry dialog.tsx 件——
// Dialog/DialogContent/DialogHeader/DialogTitle/DialogFooter 默认形态，
// 三路可关（X / Esc / 背板外点，#168 家族关闭律）归 Base UI 原生 dismiss。
// .overlay* 别名类随形透传（e2e 句柄，spec/22 §5.0 残留律——
// rerun-close-family / todo-detail-page ESC 布线按它定位；重钉归施工段）。
// OVERLAY_BTN/OVERLAY_GHOST 冻结几何（30 高/13px）退役，钮走 registry
// Button variant 档。

import { Button } from '../components/ui/button.js';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, X } from '../icons/index.js';

/** 家族面板 layout 位（#983 判决：宽度归消费点布局类）：448 = dialog
 *  家族律 #68；移动收口与 registry max-w 配方等值。 */
const PANEL_LAYOUT = 'overlay overlay-panel w-[448px] max-w-[calc(100%-2rem)] sm:max-w-[448px]';

/** #168: the rerun/reuse pair joins the dialog family close law — Esc,
 *  backdrop click, and the X head button all carry the same `onClose`
 *  (dismiss the whole overlay); `back` stays the explicit step-back
 *  affordance. Mount/unmount is conditional at the call site. Base UI 原生
 *  dismiss 三路同归 onOpenChange(false)。 */
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
      <DialogContent showCloseButton={false} className={PANEL_LAYOUT}>
        <DialogHeader className="flex-row items-center gap-1">
          {/* back/close = registry ghost icon-sm 默认档（老 20×20/24×24 冻结
              几何与七通道中和退役）；.overlay-back/.overlay-close 别名透传。
              back 不是 close：#168 语义 = 显式回退到 rerun 面（弹层仍在），
              走 onBack 而非 DialogClose。 */}
          {back === true && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="overlay-back -ml-1"
              aria-label={t('返回')}
              onClick={onBack}
            >
              <ChevronLeft width={16} height={16} />
            </Button>
          )}
          <DialogTitle className="overlay-title">{title}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0">{children}</div>
        {footer != null && <DialogFooter className="overlay-actions">{footer}</DialogFooter>}
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="overlay-close absolute top-2 right-2"
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
          <Button variant={reuse ? 'outline' : 'default'} onClick={onRerun}>
            {t('重跑')}
          </Button>
          {reuse && <Button onClick={onReuse}>{t('复用方案')}</Button>}
        </>
      }
    >
      <div className="pt-[18px] pb-0.5 text-center text-sm leading-[18px] text-(--text-secondary)">
        {t('这张任务将交给总管重新编排。')}
      </div>
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
          <Button variant="outline" onClick={onView}>
            {t('查看方案')}
          </Button>
          <Button onClick={onDirect}>{t('直接执行')}</Button>
        </>
      }
    >
      <div className="px-4 pt-[30px] pb-1 text-center text-sm leading-5 text-(--text-secondary)">
        {t('选择接下来如何使用这个方案')}
      </div>
    </OverlayDialog>
  );
}
