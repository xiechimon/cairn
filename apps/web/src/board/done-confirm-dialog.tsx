import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

export type DoneConfirmMode = 'outcome' | 'inflight';

interface DoneConfirmDialogProps {
  open?: boolean;
  mode?: DoneConfirmMode;
  confirming?: boolean;
  onClose: () => void;
  onConfirmDone: () => void;
  onConfirmCanceled?: () => void;
  onConfirmStopThenDone?: () => void;
}

export function DoneConfirmDialog({
  open,
  mode = 'outcome',
  confirming = false,
  onClose,
  onConfirmDone,
  onConfirmCanceled,
  onConfirmStopThenDone,
}: DoneConfirmDialogProps) {
  const { t } = useI18n();
  const inflight = mode === 'inflight';
  return (
    <DialogShell
      title={inflight ? t('先停止构建再标记完成？') : t('把任务标记为已完成？')}
      open={open}
      onClose={confirming ? () => {} : onClose}
      size="m"
      footer={
        <>
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            onClick={onClose}
            disabled={confirming}
          >
            {t('关闭')}
          </Button>
          {inflight ? (
            <Button
              className={DIALOG_PRIMARY_BUTTON}
              onClick={onConfirmStopThenDone}
              disabled={confirming}
            >
              {confirming ? t('正在停止…') : t('停止并完成')}
            </Button>
          ) : (
            <>
              {onConfirmCanceled != null && (
                <Button
                  variant="ghost"
                  className={DIALOG_TEXT_BUTTON}
                  onClick={onConfirmCanceled}
                  disabled={confirming}
                >
                  {t('已取消')}
                </Button>
              )}
              <Button
                className={DIALOG_PRIMARY_BUTTON}
                onClick={onConfirmDone}
                disabled={confirming}
              >
                {t('确认完成')}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="block">
        {inflight ? (
          <>
            <p className="m-0 mb-2 text-ui text-foreground">
              {t('必须先停止正在跑的构建，再标记完成。完成后 PR 不会自动合并。')}
            </p>
            <ul className="m-0 mb-2 list-disc pl-5 text-ui text-foreground">
              <li>{t('确认后会停止构建，再把任务标为已完成')}</li>
              <li>{t('已开出的 PR 保持原状，不会自动合并')}</li>
            </ul>
          </>
        ) : (
          <>
            <p className="m-0 mb-2 text-ui text-foreground">
              {t('选择结局。标记完成不算合并；已取消不算成功交付。')}
            </p>
            <ul className="m-0 mb-2 list-disc pl-5 text-ui text-foreground">
              <li>{t('确认完成：进入已完成列，计为成功')}</li>
              <li>{t('已取消：进入已完成列并标「已取消」，不计为成功')}</li>
              <li>{t('已开出的 PR 保持原状，不会自动合并')}</li>
            </ul>
          </>
        )}
        <p className="m-0 text-meta text-content-tertiary">
          {t('关闭则卡片留在原列。需要合入变更时，请改用卡片上的完成按钮。')}
        </p>
      </div>
    </DialogShell>
  );
}
