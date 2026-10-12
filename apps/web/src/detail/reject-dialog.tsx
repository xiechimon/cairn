// 审核关口打回弹层（#701 B-C12）：更多菜单「请求修改」的显式打回入口——
// 审核闸的「人看」半边必须能说不。形态随 dialog 家族律（DialogShell 448 +
// footer ghost 取消 / default 确认，AcceptDialog 同款先例）；反馈必填——它是
// 重规划轮的工作指令，空稿不放行（restart「空消息不成发送」同律）。提交走
// 服务端动作面 POST /builds/{id}/steps {action:"revision"}（review→planning
// 边与 #330 自动回流共用）；被拒（409 竞态）弹层不关、原因显在输入行下方
// （XMON-89 教训：静默关掉 = 用户看到弹层关了然后无事发生）。

import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Label } from '../components/ui/label.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';

interface RejectDialogProps {
  /** #73 retained-mount open flag。 */
  open?: boolean;
  onClose: () => void;
  /** 确认 = revision 动作面（父持有 mutation）；缺省 = 静态面（关闭即止）。 */
  onConfirm?: (feedback: string) => void;
  /** 服务端拒绝原因：非空 = 弹层不关、显在输入行下方。 */
  rejectReason?: string | null;
}

export function RejectDialog({ open, onClose, onConfirm, rejectReason }: RejectDialogProps) {
  const { t } = useI18n();
  const [feedback, setFeedback] = useState('');
  // retained-mount 重开回空稿（ReviewDialog focus 同律）。
  useEffect(() => {
    if (open) setFeedback('');
  }, [open]);
  const trimmed = feedback.trim();
  const label = t('需要修改什么？打回后任务回到规划中，按反馈重新出方案。');
  return (
    // #951：dlg-reject / reject-confirm / reject-feedback-input 类名钩退役
    // （零规则死类；review-reject.spec 载体换 role=dialog 可及名 +
    // getByRole(button/textbox)，同 PR 重钉）。
    <DialogShell
      title={t('请求修改')}
      open={open}
      onClose={onClose}
      footer={
        // #1006 原型（#980 前提④）：registry DialogFooter band + Button
        // 默认档（取消 outline / 请求修改 default），13px/h-7 冻结几何退役。
        <>
          <Button variant="outline" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button disabled={trimmed === ''} onClick={() => onConfirm?.(trimmed)}>
            {t('请求修改')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {/* #1006 原型：标签走 registry Label 件（批次 0b 引入），--label-size
            手写标签律退役（前提④：排版收敛 registry 默认 text-sm/500）。 */}
        {/* CJK 标签行高修正（leading-none → 1.25，墨盒不贴行底被邻位
            focus 环压住）：就地 className，件保持 pristine（#980 S5）。 */}
        <Label className="leading-tight">{label}</Label>
        {/* #945（#851 裸控件账）：裸 textarea 收编 components/ui Textarea；
            #1006 原型：FOCUS_TEXTAREA 中和皮退役，件默认形态生效
            （field-sizing-content 自增高 + rounded-lg border-input）。 */}
        <Textarea
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          rows={3}
          placeholder={label}
        />
      </div>
      {rejectReason != null && (
        <p className="text-xs leading-4 text-(--destructive)" role="alert">
          {rejectReason}
        </p>
      )}
    </DialogShell>
  );
}
