import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';
import { acceptState } from './accept-state.js';

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
  agentId?: string | null;
  pr?: { url: string; number: number | null } | null;
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
  agentId,
  pr,
}: AcceptDialogProps) {
  const { t } = useI18n();
  const [merge, setMerge] = useState(true);
  useEffect(() => {
    if (open === true) setMerge(true);
  }, [open]);
  const state = acceptState(
    {
      infoOutput: infoOutput === true,
      substantiveChanges,
      locked: mergeLocked === true,
      missingTools: missingTools ?? [],
    },
    merge,
  );
  const locked = mergeLocked === true;
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
            disabled={state.confirmDisabled || confirming === true}
            onClick={() => {
              if (onConfirm) onConfirm(state.merge);
              else onClose();
            }}
          >
            {t('完成')}
          </Button>
        </>
      }
    >
      {state.skipMerge ? (
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
              checked={state.mergeChecked}
              onCheckedChange={(next) => {
                if (!state.mergeDisabled) setMerge(next === true);
              }}
              disabled={state.mergeDisabled}
              aria-label={t('将改动合并到默认分支')}
            />
            <span className="text-ui text-foreground">{t('将改动合并到默认分支')}</span>
          </label>
        </div>
      )}
      {locked && !state.skipMerge && (
        <p className="mt-2 text-meta text-(--text-tertiary)">
          {t('失败任务只能经合并完成，不能跳过合并。')}
        </p>
      )}
      {state.permissionMissing && (
        <div data-testid="accept-permission-missing" className="mt-2 flex flex-col gap-1.5">
          <p className="m-0 text-meta text-(--text-tertiary)">
            {locked
              ? t('缺少「{tools}」授权，无法合并。请在该 Agent 的权限里开启。', {
                  tools: (missingTools ?? []).map((tool) => t(tool)).join(t('、')),
                })
              : t('缺少「{tools}」授权，这次不能合并。现在完成，改动保留在会话分支。', {
                  tools: (missingTools ?? []).map((tool) => t(tool)).join(t('、')),
                })}
          </p>
          <div className="flex items-center gap-3 text-meta">
            {pr != null && (
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                data-testid="accept-pr-link"
                className="text-foreground underline underline-offset-2"
              >
                {pr.number !== null ? t('PR #{n}', { n: pr.number }) : t('查看 PR')}
              </a>
            )}
            {agentId != null && (
              <Link
                to={`${AGENTS_HREF}/${agentId}`}
                onClick={onClose}
                data-testid="accept-grant-link"
                className="text-foreground underline underline-offset-2"
              >
                {t('去开授权')}
              </Link>
            )}
          </div>
        </div>
      )}
      {rejectReason != null && (
        <p className="mt-2 text-meta text-(--destructive)" role="alert">
          {rejectReason}
        </p>
      )}
    </DialogShell>
  );
}
