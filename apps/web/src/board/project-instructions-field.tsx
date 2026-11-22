import { PROJECT_GOAL_MAX, PROJECT_INSTRUCTIONS_MAX, type ProjectRecord } from '@cairn/shared';
import { useState } from 'react';
import { usePatchProject } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

const FIELDS = {
  instructions: {
    max: PROJECT_INSTRUCTIONS_MAX,
    label: '项目说明',
    placeholder: '例如：仓库内容用英文；改动后运行 pnpm lint；不要 force push。',
    saveLabel: '保存项目说明',
    failed: '项目说明保存失败，请重试。',
  },
  description: {
    max: PROJECT_GOAL_MAX,
    label: '想做什么',
    placeholder: '可选。写下这个项目的目标，Coordinator 拆任务时会参考。',
    saveLabel: '保存想做什么',
    failed: '保存失败，请重试。',
  },
} as const;

export function ProjectInstructionsField({
  project,
  teamId,
  testId,
  field = 'instructions',
}: {
  project: Pick<ProjectRecord, 'id' | 'instructions' | 'description'>;
  teamId: string | undefined;
  testId?: string;
  field?: keyof typeof FIELDS;
}) {
  const { t } = useI18n();
  const patchProject = usePatchProject(teamId);
  const [draft, setDraft] = useState<string | null>(null);
  const copy = FIELDS[field];
  const saved = project[field] ?? '';
  const value = draft ?? saved;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t(copy.label)}
        data-testid={testId}
        className="min-h-28 w-full"
        maxLength={copy.max}
        placeholder={t(copy.placeholder)}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-meta tabular-nums text-content-tertiary">
          {`${value.length.toLocaleString('en')} / ${copy.max.toLocaleString('en')}`}
        </span>
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          aria-label={t(copy.saveLabel)}
          disabled={patchProject.isPending || value === saved}
          onClick={() => {
            const next = value.trim();
            patchProject.mutate(
              { id: project.id, body: { [field]: next === '' ? null : next } },
              {
                onSuccess: () => setDraft((current) => (current === value ? null : current)),
                onError: (error) => toastError(t(copy.failed), error),
              },
            );
          }}
        >
          {t('保存')}
        </Button>
      </div>
    </div>
  );
}
