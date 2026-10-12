// 手动关边确认 dialog（#901 起闸，#1247 收窄为待处理三相恒闸）：confirm/
// review/failed 卡拖向 已完成 = 手动关边，要求显式确认——复用 #755 reset 闸
// 形态（DialogShell + 头 + 说明清单 + footer 取消/确认）。取消 = 零提交
// （board.tsx 落位路由在 opened 前不写任何乐观值）；确认 = #1247 专属写面
// POST /api/todos/:id/complete（fixture 面 completeTodoLocal 本地投影）——
// 先中断该任务在飞的构建（含正在运行的合并步），再直写 done。警示三条按
// 票面点名：中断在飞构建、立即标记完成、PR 不自动合并。异步确认面同
// reset 闸：confirming 位在飞时禁用钮（complete 是中断面，回包即真值，
// 不做乐观落位）。

import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface DoneConfirmDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** #1247：确认 = 异步中断面（POST complete：中断在飞构建 + 直写 done），
   *  在飞时禁用确认钮、弹层不关（reset 闸 confirming 同形）。 */
  onConfirm: () => void;
  /** 确认在飞（complete 请求已发出）：确认钮禁用，弹层不关。 */
  confirming?: boolean;
}

export function DoneConfirmDialog({
  open,
  onClose,
  onConfirm,
  confirming,
}: DoneConfirmDialogProps) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('把任务标记为已完成？')}
      open={open}
      onClose={onClose}
      // 挂账已清（#1004 → #1006 段 2）：registry dialog-shell 已进本分支，
      // 消费点自携垫剥除、裸内容进 DialogFooter；钮走家族律 registry 档
      // （取消 outline / 确认 default）。
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button onClick={onConfirm} disabled={confirming === true}>
            {t('确认完成')}
          </Button>
        </>
      }
    >
      {/* 几何/字档 = reset-confirm-dialog 同族（#951 overlays.css 清零后的
          utility 形态）：内容纵 stacked，13/18 primary 主句、13/20 disc
          清单、12/16 tertiary 尾注。外垫随壳 DialogContent p-4。 */}
      <div className="block">
        <p className="m-0 mb-1.5 text-[13px] leading-[18px] text-(--text-primary)">
          {t('手动把这张卡关进已完成：')}
        </p>
        <ul className="m-0 mb-1.5 list-disc pl-[18px] text-[13px] leading-5 text-(--text-primary)">
          <li>{t('在飞的构建会被中断（含正在运行的合并步）')}</li>
          <li>{t('任务立即标记为已完成')}</li>
          <li>{t('已开出的 PR 不会被自动合并，保持原状')}</li>
        </ul>
        <p className="m-0 text-xs leading-4 text-(--text-tertiary)">{t('本次操作会记入任务时间线。')}</p>
      </div>
    </DialogShell>
  );
}
