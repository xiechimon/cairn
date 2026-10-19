// 任务重置确认 dialog（#755，todos.dev 看板指南「已开始的卡片拖回待开始会
// 重置任务：中断构建并清空对话、方案和改动记录」）：accept/stop-confirm
// 同族——头 + 清空清单 + 保留清单 + footer 取消/确认重置。取消 = 零提交
// （board.tsx 落位路由在 opened 前不写任何乐观值）；stale = 构建在 dialog
// 打开后推进了，弹层不关、清单按现记录刷新、顶部显变化提示重新确认。

import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface ResetConfirmDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** 确认在飞（重置请求已发出）：确认钮禁用，弹层不关。 */
  confirming?: boolean;
  /** 构建在 dialog 打开后推进了：清单已按现记录刷新，顶部显变化提示。 */
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
      // 挂账已清（#1004 → #1006 段 2）：registry dialog-shell 已进本分支，
      // 消费点自携垫剥除、裸内容进 DialogFooter，ACCEPT_* import 撤除。
      // 确认重置 = 销毁性动作（中断构建 + 清空对话/方案/改动，不可恢复）
      // → destructive 档（R3 停止钮同判：registry 语义皮肤 = 语义映射）。
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
      {/* #951（overlays.css 清零）：#755 重置面律等值迁 utility——accept 同族
          行容器是横向 flex（checkbox 行形态），重置面内容纵 stacked：block +
          17/16 垫（原 .dlg-reset .dlg-accept 覆写）；文字四档 12/16 tertiary
          （stale/kept）、13/18 primary（lead）、13/20 disc 清单。dlg-reset /
          dlg-reset-confirm 类名钩退役（board-dnd 载体换 role=dialog 可及名，
          同 PR 重钉；confirm 钩全仓零规则零 pin）。 */}
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
