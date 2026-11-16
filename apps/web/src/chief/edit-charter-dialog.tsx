import { BRIEF_MARKER_BEGIN, BRIEF_MARKER_END, PROJECT_INSTRUCTIONS_MAX } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';

interface EditCharterDialogProps {
  open?: boolean;
  onClose: () => void;
  charter?: string;
  onSave?: (charter: string) => void;
}

export function EditCharterDialog({ open, onClose, charter, onSave }: EditCharterDialogProps) {
  const { t } = useI18n();
  const [text, setText] = useState(charter ?? '');
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (open) {
      setText(charter ?? '');
      setRefused(false);
    }
  }, [open, charter]);
  const marker = [BRIEF_MARKER_BEGIN, BRIEF_MARKER_END].find((line) => text.includes(line));
  const problem =
    marker != null
      ? t('章程里不能有这一行：{marker}。这是 Cairn 自己用的分隔标记，删掉它再保存。', { marker })
      : text.length > PROJECT_INSTRUCTIONS_MAX
        ? t('章程最多 {max} 个字，现在有 {n} 个字。删短一些再保存。', {
            max: PROJECT_INSTRUCTIONS_MAX.toLocaleString('en'),
            n: text.length.toLocaleString('en'),
          })
        : null;
  const save = () => {
    if (problem != null) {
      setRefused(true);
      return;
    }
    if (onSave != null) onSave(text);
    else {
      blockDemoWrite();
      onClose();
    }
  };
  return (
    <DialogShell
      title={t('编辑章程')}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        <>
          <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onClose}>
            {t('取消')}
          </Button>
          <Button className={DIALOG_PRIMARY_BUTTON} onClick={save}>
            {t('保存章程')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea
          className="max-h-80 min-h-30 overflow-y-auto text-ui md:text-ui"
          value={text}
          aria-invalid={refused && problem != null}
          aria-describedby={refused && problem != null ? 'charter-problem' : undefined}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…')}
        />
        <div className="flex items-start justify-between gap-3">
          {refused && problem != null ? (
            <span id="charter-problem" role="alert" className="text-meta text-destructive">
              {problem}
            </span>
          ) : (
            <span />
          )}
          <span className="flex-none text-meta tabular-nums text-content-tertiary">
            {`${text.length.toLocaleString('en')} / ${PROJECT_INSTRUCTIONS_MAX.toLocaleString('en')}`}
          </span>
        </div>
      </div>
    </DialogShell>
  );
}
