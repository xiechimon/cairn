// Delete project confirm (#207 删除区复活, r2 24d): DeleteConfirm 家族同形
// — 448 居中弹层、head + divider、项目名摘要、右对齐 取消/删除(danger) —
// 加键入项目名确认行:输入与项目名精确匹配才解禁删除钮(误删闸门,票面
// 「确认输入不匹配禁用」)。级联语义不在本层——server services/projects.ts
// 单源(#189);本层只管确认形状与闸门。
// #425 B1：壳与底栏换 components/ui/alert-dialog-shell（同 delete-confirm；
// 两面共享 .delete-confirm-* css 面，收编同构）。

import { useEffect, useState } from 'react';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

interface DeleteProjectConfirmProps {
  /** 确认输入需精确匹配的项目名。 */
  projectName: string;
  /** #73: retained-mount open flag — the exit fade outlives the close. */
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteProjectConfirm({
  projectName,
  open,
  onClose,
  onConfirm,
}: DeleteProjectConfirmProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState('');
  // 每次重开回到空输入:关闭期 typed 随 retained mount 存活,不重置会让
  // 重开的弹层带着上一次的输入(闸门形同虚设)。
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const prompt = t('输入 {name} 以确认删除', { name: projectName });
  return (
    <AlertDialogShell
      title={t('确定删除该项目？此操作不可撤销。')}
      ariaLabel={t('删除项目')}
      open={open}
      onClose={onClose}
      // #948 per-face 清零：旧 .delete-confirm--project 的 height:auto 在壳
      // utility 面（无固定高）上是 no-op，只余 16px 底垫 → pb-4。
      className="pb-4"
    >
      <div className="delete-confirm-summary mx-4 mt-4 flex h-4 items-center gap-2 overflow-hidden text-ui leading-4 whitespace-nowrap text-foreground">
        {projectName}
      </div>
      <div className="mx-4 mt-3 text-meta text-content-secondary">{prompt}</div>
      {/* #948：确认输入 = components/ui Input 件默认几何（h-8 32px 正本控件
          高，spec/22 §2.6-1；旧 per-face 30px 死值不留），描边/底色 1:1 迁
          --border-default / transparent。 */}
      <Input
        className="mx-4 mt-2 w-[calc(100%-32px)] border-(--border) text-ui text-foreground md:text-ui"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        aria-label={prompt}
        autoComplete="off"
        spellCheck={false}
      />
      <AlertDialogActions
        cancelLabel={t('取消')}
        confirmLabel={t('删除')}
        onCancel={onClose}
        onConfirm={onConfirm}
        confirmDisabled={typed !== projectName}
      />
    </AlertDialogShell>
  );
}
