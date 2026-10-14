// 已完成确认 dialog（#901，#1247）：待处理卡（confirm / review / failed）
// 拖向已完成先确认，不看 hasChanges。复用 #755 reset 闸形态（DialogShell +
// 头 + 说明清单 + footer 取消/确认）。取消 = 零提交（board.tsx 落位路由在
// opened 前不写任何乐观值）；确认 = 既有 handlePhaseDrop 提交路（fixture
// 本地集 / live 乐观 PATCH）。这条 PATCH 不调用 cancelBuild，也不走
// AcceptDialog 的合并步。

import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface DoneConfirmDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** 确认 = 既有 handlePhaseDrop 乐观提交路（同步落位 + 后台 PATCH），无
   *  在飞态可禁——与 reset 闸的异步确认面不同，不设 confirming 位。 */
  onConfirm: () => void;
}

export function DoneConfirmDialog({ open, onClose, onConfirm }: DoneConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('把任务标记为已完成？')}
      open={open}
      onClose={onClose}
      // 挂账已清（#1004 → #1006 段 2）：registry dialog-shell 已进本分支，
      // 消费点自携垫剥除、裸内容进 DialogFooter，ACCEPT_* import 撤除；
      // 钮走家族律 registry 档（取消 outline / 确认 default）。
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button onClick={onConfirm}>{t('确认完成')}</Button>
        </>
      }
    >
      {/* 几何/字档 = reset-confirm-dialog 同族（#951 overlays.css 清零后的
          utility 形态）：内容纵 stacked，13/18 primary 主句、13/20 disc
          清单、12/16 tertiary 尾注。外垫随壳 DialogContent p-4。 */}
      <div className="block">
        <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-(--text-primary)">
          {t('将中断在飞构建并标记完成。PR 不会自动合并。')}
        </p>
        <ul className="m-0 mb-1.5 list-disc pl-[18px] text-[13px] leading-5 text-(--text-primary)">
          <li>{t('在飞构建会停下，任务进入已完成列')}</li>
          <li>{t('已开出的 PR 保持原状，不会自动合并')}</li>
        </ul>
        <p className="m-0 text-xs leading-4 text-(--text-tertiary)">
          {t('取消则卡片留在原列。需要合入变更时，请改用卡片上的完成按钮。')}
        </p>
      </div>
    </DialogShell>
  );
}
