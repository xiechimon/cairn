import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface ResetConfirmDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
  stale?: boolean;
}

export function ResetConfirmDialog({
  open,
  onClose,
  onConfirm,
  confirming,
  stale,
}: ResetConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('把任务重置回待开始？')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            variant="destructive"
            className={DIALOG_PRIMARY_BUTTON}
            onClick={onConfirm}
            disabled={confirming === true}
          >
            {t('确认重置')}
          </Button>
        </>
      }
    >
      <div className="block">
        {stale === true && (
          <p className="m-0 mb-2 text-meta text-content-tertiary">
            {t('任务在你打开确认框后发生了变化，下面是最新状态，请重新确认。')}
          </p>
        )}
        <p className="m-0 mb-1.5 text-ui text-foreground">{t('以下内容将被清空，无法恢复：')}</p>
        <ul className="m-0 mb-2 list-disc pl-5 text-ui text-foreground">
          <li>{t('中断运行中的构建（在线的执行机即时中断；离线机器的残留进程够不着）')}</li>
          <li>{t('清空对话记录')}</li>
          <li>{t('清空方案版本')}</li>
          <li>{t('清空改动记录')}</li>
        </ul>
        <p className="m-0 text-meta text-content-tertiary">
          {t(
            '保留：标题、需求说明、标签与人员指派。运行历史保留，可供审计。执行机工作区文件不受影响。',
          )}
        </p>
      </div>
    </DialogShell>
  );
}
