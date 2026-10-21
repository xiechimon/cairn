// 停止确认 dialog（M7 #308，r9 §2.3/§3.3）：accept dialog 同族——
// 「停止当前这一轮？」头 + 默认勾选的丢弃复选行（「丢弃本轮修改——方案和
// 代码回到上一个版本」，勾选 = daemon 侧 rewind worktree 到步起点
// checkpoint）+ footer 取消/停止。仅 live 面接线（fixture 捕获面无后端，
// 停止钮不挂 handler，DOM 字节不变）。
// #1446 queued 档：等机器的步还没跑过，没有「本轮修改」可丢——换「停止排队？」
// 头 + 一句去向说明，不出复选行。

import { useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { useI18n } from '../i18n/provider.js';

interface StopConfirmDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** 停止确认：discard = 复选位终值（POST /api/builds/{id}/stop body）。 */
  onConfirm: (discard: boolean) => void;
  /** #1446：停的是 queued 卡（步还在等机器）。 */
  queued?: boolean;
}

export function StopConfirmDialog({ open, onClose, onConfirm, queued }: StopConfirmDialogProps) {
  const { t } = useI18n();
  // 默认勾选（r9 §2.3 实测：checkbox 选中态 = indigo 底 + 白勾）。
  const [discard, setDiscard] = useState(true);
  return (
    <DialogShell
      title={queued === true ? t('停止排队？') : t('停止当前这一轮？')}
      open={open}
      onClose={onClose}
      size="s"
      footer={
        // 「停止」是销毁本轮修改的破坏性动作 → destructive 档。
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button
            variant="destructive"
            className={DIALOG_PRIMARY_BUTTON}
            onClick={() => onConfirm(discard)}
          >
            {t('停止')}
          </Button>
        </>
      }
    >
      {queued === true ? (
        <p className="m-0 text-ui text-foreground">{t('任务回到待开始，之后可以再开始。')}</p>
      ) : (
        <div className="flex items-center gap-2">
          {/* XMON-72：与 accept-dialog 同族，收口 components/ui/checkbox 原语
            （registry 同源件，行盒由消费点 label 承载）。 */}
          {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
          <label className="inline-flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={discard}
              onCheckedChange={setDiscard}
              aria-label={t('丢弃本轮修改——方案和代码回到上一个版本')}
            />
            <span className="text-ui text-foreground">
              {t('丢弃本轮修改——方案和代码回到上一个版本')}
            </span>
          </label>
        </div>
      )}
    </DialogShell>
  );
}
