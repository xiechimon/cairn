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

export function RerunDialog({
  reuse,
  onClose,
  onRerun,
  onReuse,
}: {
  reuse: boolean;
  onClose: () => void;
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

export function ReusePanel({
  onClose,
  onBack,
  onView,
  onDirect,
}: {
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
