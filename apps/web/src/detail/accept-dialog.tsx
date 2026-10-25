// 验收确认 dialog (issue #68, r7 34): 448×143 centered over the board (and
// the detail header 完成 button) — `完成任务` header, the merge checkbox
// checked by default (`将改动合并到默认分支`), footer 取消 + 完成. Fixture
// phase: 完成 closes the dialog, no state transition yet (M5 cuts the
// fixture cord).
//
// 勾选语义（#1236，参照产品 r1 §153：leave the box unchecked to complete the
// todo and keep the branch as it is）：勾选 = 发起合并（live 面 merge 202
// delegated，机器合并步收尾才落 done）；不勾 = 仅完成不合并（todo 级改相，
// 分支/PR 保持原状——#901 板面 done 落位闸同一语义）。onConfirm 携带勾选位，
// 写面分流归调用点（详情页 / 看板各一处）。

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
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** live 面：完成 = 按勾选位分流（merge 参数 = 勾选位）；缺省 = fixture
   *  行为（关闭即止）。live 调用点必须给函数——缺位时确认钮回落 onClose，
   *  弹层静默关闭且零请求（#1236 主症状）。 */
  onConfirm?: (merge: boolean) => void;
  /** 确认在飞（请求已发出未回执）：完成钮禁用，双击不双发合并步。 */
  confirming?: boolean;
  /** failed 卡（#702 恢复面）：done 只能经合并步落地（failed→done 不是相位
   *  机边），勾选框锁死在勾选态——不给出「不合并完成」的假选项，原因行写明。 */
  mergeLocked?: boolean;
  /** XMON-89 前置检查：执行 Agent 缺这几项授权（detail/merge-gate.ts 的
   *  missingMergeTools）。非空 = 完成禁用 + 写明缺哪项——点得动才谈得上
   *  「点了没反应」，禁掉它并把原因写在旁边是同一件事的两半。 */
  missingTools?: string[];
  /** XMON-89 服务端拒绝文案：非空 = 弹层不关、把这句话显在勾选行下方。
   *  改之前两处 merge 都是裸 mutate() + 立即关弹层，403 被静默吞掉——用户
   *  看到弹层关了、然后无事发生。 */
  rejectReason?: string | null;
  /** #1313：已上报 diff 有没有文件。null / 缺省 = 未知，合并勾选照旧。
   *  false = 空提交（文件集为空），不展示合并行，完成不走 merge，缺合并
   *  授权也不禁用。failed 锁定（mergeLocked）优先：空 diff 也不给出跳过
   *  合并的出口。 */
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
  // retained-mount 弹层的状态跨开窗残留：勾选位是真语义开关（#1236），上一张
  // 卡取消掉的不勾选不得带进下一张——每次开窗回默认勾选。
  useEffect(() => {
    if (open === true) setMerge(true);
  }, [open]);
  const locked = mergeLocked === true;
  // 空提交收口不提供合并。failed 卡的锁定优先于空 diff：done 仍只能经合并。
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
      {/* XMON-72：复选行收口 components/ui/checkbox 原语（registry 同源件，
          行盒由消费点 label 承载——整行可点走 label 激活转发）。 */}
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
        // failed 卡锁定行：与缺项行同档 tertiary 说明位（「禁掉它并把原因写
        // 在旁边是同一件事的两半」，XMON-89 律）。
        <p className="mt-2 text-meta text-(--text-tertiary)">
          {t('失败任务只能经合并完成，不能跳过合并。')}
        </p>
      )}
      {blocked && (
        // XMON-89 缺项行：禁用态由 default disabled 档承载，本行只说「缺什么」。
        <p className="mt-2 text-meta text-(--text-tertiary)">
          {t('缺少「{tools}」授权，无法合并。请在该 Agent 的权限里开启。', {
            tools: (missingTools ?? []).join('、'),
          })}
        </p>
      )}
      {rejectReason != null && (
        // XMON-89 server 拒绝行：destructive 与其余面级错误文案同色；
        // role=alert 是 e2e/读屏一级载体（#910 裁定 1）。
        <p className="mt-2 text-meta text-(--destructive)" role="alert">
          {rejectReason}
        </p>
      )}
    </DialogShell>
  );
}
