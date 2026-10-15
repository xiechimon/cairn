// 已完成确认 dialog（#901，#1247）：
// - 待处理卡（confirm / review / failed）→ Done / Canceled / 关闭
// - 在飞卡（queued / planning / building）→ 先停构建再标完成 / 关闭
// 关闭 = 零提交。确认完成不走 AcceptDialog 合并步。
// dismiss 用「关闭」不用「取消」：outcome 结局钮「已取消」含子串「取消」，
// Playwright 按名取钮会双命中（strict mode）。

import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

export type DoneConfirmMode = 'outcome' | 'inflight';

interface DoneConfirmDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  /** outcome = Done/Canceled；inflight = stop-then-done only. */
  mode?: DoneConfirmMode;
  /** 确认进行中（stop-and-done 委托态）。 */
  confirming?: boolean;
  onClose: () => void;
  /** 标记为已完成（成功结局）。 */
  onConfirmDone: () => void;
  /** 已取消 / 不做了（closed）。inflight 模式不展示。 */
  onConfirmCanceled?: () => void;
  /** 先停构建再标完成。仅 inflight 模式。 */
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
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            {t('关闭')}
          </Button>
          {inflight ? (
            <Button onClick={onConfirmStopThenDone} disabled={confirming}>
              {confirming ? t('正在停止…') : t('停止并完成')}
            </Button>
          ) : (
            <>
              {onConfirmCanceled != null && (
                <Button variant="outline" onClick={onConfirmCanceled} disabled={confirming}>
                  {t('已取消')}
                </Button>
              )}
              <Button onClick={onConfirmDone} disabled={confirming}>
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
            <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-(--text-primary)">
              {t('必须先停止正在跑的构建，再标记完成。完成后 PR 不会自动合并。')}
            </p>
            <ul className="m-0 mb-1.5 list-disc pl-[18px] text-[13px] leading-5 text-(--text-primary)">
              <li>{t('确认后会停止构建，再把任务标为已完成')}</li>
              <li>{t('已开出的 PR 保持原状，不会自动合并')}</li>
            </ul>
          </>
        ) : (
          <>
            <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-(--text-primary)">
              {t('选择结局。标记完成不算合并；已取消不算成功交付。')}
            </p>
            <ul className="m-0 mb-1.5 list-disc pl-[18px] text-[13px] leading-5 text-(--text-primary)">
              <li>{t('确认完成：进入已完成列，计为成功')}</li>
              <li>{t('已取消：进入已完成列并标「已取消」，不计为成功')}</li>
              <li>{t('已开出的 PR 保持原状，不会自动合并')}</li>
            </ul>
          </>
        )}
        <p className="m-0 text-xs leading-4 text-(--text-tertiary)">
          {t('关闭则卡片留在原列。需要合入变更时，请改用卡片上的完成按钮。')}
        </p>
      </div>
    </DialogShell>
  );
}
