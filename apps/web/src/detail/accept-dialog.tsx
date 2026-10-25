import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface AcceptDialogProps {
  open?: boolean;
  onClose: () => void;
  onConfirm?: (merge: boolean) => void;
  confirming?: boolean;
  mergeLocked?: boolean;
  missingTools?: string[];
  rejectReason?: string | null;
  substantiveChanges?: boolean | null;
  infoOutput?: boolean;
}

export function AcceptDialog({
  open,
  onClose,
  onConfirm,
  confirming,
  mergeLocked,
  missingTools,
  rejectReason,
  substantiveChanges,
  infoOutput,
}: AcceptDialogProps) {
  const { t } = useI18n();
  const [merge, setMerge] = useState(true);
  useEffect(() => {
    if (open === true) setMerge(true);
  }, [open]);
  const locked = mergeLocked === true;
  const skipMerge = infoOutput === true || (substantiveChanges === false && !locked);
  const blocked = !skipMerge && (missingTools?.length ?? 0) > 0;
  const mergeChecked = locked || merge;
  return (
    <DialogShell
      title={t('完成任务')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            disabled={blocked || confirming === true}
            onClick={() => {
              if (onConfirm) onConfirm(skipMerge ? false : mergeChecked);
              else onClose();
            }}
          >
            {t('完成')}
          </Button>
        </>
      }
    >
      {skipMerge ? (
        <p className="text-meta text-(--text-tertiary)">
          {infoOutput === true
            ? t('信息卡的产出是报告附件，不进合并。')
            : t('本轮没有文件改动，完成不会合并分支。')}
        </p>
      ) : (
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={mergeChecked}
              onCheckedChange={(next) => {
                if (!locked) setMerge(next === true);
              }}
              disabled={locked}
              aria-label={t('将改动合并到默认分支')}
            />
            <span className="text-ui text-foreground">{t('将改动合并到默认分支')}</span>
          </label>
        </div>
      )}
      {locked && !skipMerge && (
        <p className="mt-2 text-meta text-(--text-tertiary)">
          {t('失败任务只能经合并完成，不能跳过合并。')}
        </p>
      )}
      {blocked && (
        <p className="mt-2 text-meta text-(--text-tertiary)">
          {t('缺少「{tools}」授权，无法合并。请在该 Agent 的权限里开启。', {
            tools: (missingTools ?? []).join('、'),
          })}
        </p>
      )}
      {rejectReason != null && (
        <p className="mt-2 text-meta text-(--destructive)" role="alert">
          {rejectReason}
        </p>
      )}
    </DialogShell>
  );
}
