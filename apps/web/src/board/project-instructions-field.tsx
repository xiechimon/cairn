import { PROJECT_INSTRUCTIONS_MAX, type ProjectRecord } from '@cairn/shared';
import { useState } from 'react';
import { usePatchProject } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

export function ProjectInstructionsField({
  project,
  teamId,
  testId,
}: {
  project: Pick<ProjectRecord, 'id' | 'instructions'>;
  teamId: string | undefined;
  testId?: string;
}) {
  const { t } = useI18n();
  const patchProject = usePatchProject(teamId);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = project.instructions ?? '';
  const value = draft ?? saved;
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t('项目说明')}
        data-testid={testId}
        className="min-h-28 w-full"
        maxLength={PROJECT_INSTRUCTIONS_MAX}
        placeholder={t('例如：仓库内容用英文；改动后跑 pnpm lint；不要 force push。')}
        value={value}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex items-center justify-end gap-3">
        <span className="text-meta tabular-nums text-content-tertiary">
          {`${value.length.toLocaleString('en')} / ${PROJECT_INSTRUCTIONS_MAX.toLocaleString('en')}`}
        </span>
        <Button
          className={DIALOG_PRIMARY_BUTTON}
          aria-label={t('保存项目说明')}
          disabled={patchProject.isPending || value === saved}
          onClick={() => {
            const next = value.trim();
            patchProject.mutate(
              { id: project.id, body: { instructions: next === '' ? null : next } },
              {
                onSuccess: () => setDraft((current) => (current === value ? null : current)),
                onError: (error) => toastError(t('项目说明保存失败，请重试。'), error),
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
